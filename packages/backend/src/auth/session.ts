import type { ServerWebSocket } from 'bun';
import type { AuthState, Permissions, UserRole } from '@calltools/shared';
import { verifyPassword } from './verify';
import { loadPermissions, resolvePermissions } from './permissions';
import { dbQuery } from '../db/mysql';

const SESSION_RESUME_TTL = Number(process.env.SESSION_RESUME_TTL ?? 300) * 1000;

interface Session {
  token: string;
  username: string;
  role: UserRole;
  userId?: number;
  sipUser?: string;
  sipUsers?: string[];
  sipGroups?: Array<{ account: string; sipUsers: string[] }>;
  permissions: Record<string, boolean>;
  ip: string;
  connectedAt: number;
  disconnectedAt?: number;
  ws?: ServerWebSocket<unknown>;
}

const activeSessions = new Map<string, Session>();
const disconnectedSessions = new Map<string, Session>();
const invalidatedTokens = new Set<string>();

interface SipGroup {
  account: string;
  sipUsers: string[];
}

interface AuthResult {
  success: boolean;
  user?: { username: string; role: UserRole; userId?: number; sipUser?: string; sipUsers?: string[]; sipGroups?: SipGroup[] };
  error?: string;
}

/**
 * Authenticate a user against the Magnus Billing database.
 * Checks SIP users first, then pkg_user accounts.
 */
export async function authenticate(username: string, password: string, clientIp: string): Promise<AuthResult> {
  // Validate input
  if (!/^[a-zA-Z0-9_\-\.@]+$/.test(username) || username.length > 64) {
    return { success: false, error: 'Invalid username format.' };
  }

  // Try SIP user authentication
  const sipRows = await dbQuery<{ id: number; name: string; secret: string; id_user: number }>(
    'SELECT id, name, secret, id_user FROM pkg_sip WHERE name = ? LIMIT 1',
    [username]
  );

  if (sipRows.length > 0) {
    const sip = sipRows[0];
    const valid = await verifyPassword(password, sip.secret);
    if (!valid) return { success: false, error: 'Invalid credentials.' };

    // Resolve parent account name for access control
    const parentRows = await dbQuery<{ username: string }>(
      'SELECT username FROM pkg_user WHERE id = ? LIMIT 1',
      [sip.id_user]
    );
    const parentUsername = parentRows.length > 0 ? parentRows[0].username : username;

    // Check if parent account is allowed
    const allowed = await isAccountAllowed(parentUsername, clientIp, 'sip_user');
    if (!allowed.ok) return { success: false, error: allowed.reason };

    return {
      success: true,
      user: { username: sip.name, role: 'sip_user', userId: sip.id_user, sipUser: sip.name },
    };
  }

  // Try pkg_user authentication
  const userRows = await dbQuery<{ id: number; username: string; password: string; id_group: number }>(
    'SELECT id, username, password, id_group FROM pkg_user WHERE username = ? AND active = 1 LIMIT 1',
    [username]
  );

  if (userRows.length === 0) {
    return { success: false, error: 'Invalid credentials.' };
  }

  const user = userRows[0];
  const valid = await verifyPassword(password, user.password);
  if (!valid) return { success: false, error: 'Invalid credentials.' };

  const role: UserRole = user.id_group === 1 ? 'admin' : 'user';

  // Check if account is allowed
  const allowed = await isAccountAllowed(username, clientIp, role);
  if (!allowed.ok) return { success: false, error: allowed.reason };

  // Get SIP users: admin sees ALL, user sees only their own
  const sipUsers = role === 'admin'
    ? await dbQuery<{ name: string }>('SELECT name FROM pkg_sip ORDER BY name')
    : await dbQuery<{ name: string }>('SELECT name FROM pkg_sip WHERE id_user = ?', [user.id]);

  // Build sipGroups (SIP users grouped by parent account)
  const groupRows = role === 'admin'
    ? await dbQuery<{ username: string; name: string }>(
        'SELECT u.username, s.name FROM pkg_sip s JOIN pkg_user u ON s.id_user = u.id ORDER BY u.username, s.name'
      )
    : await dbQuery<{ username: string; name: string }>(
        'SELECT u.username, s.name FROM pkg_sip s JOIN pkg_user u ON s.id_user = u.id WHERE s.id_user = ? ORDER BY u.username, s.name',
        [user.id]
      );

  const groupMap = new Map<string, string[]>();
  for (const row of groupRows) {
    const list = groupMap.get(row.username) ?? [];
    list.push(row.name);
    groupMap.set(row.username, list);
  }
  const sipGroups: SipGroup[] = Array.from(groupMap.entries()).map(([account, sips]) => ({ account, sipUsers: sips }));

  return {
    success: true,
    user: {
      username: user.username,
      role,
      userId: user.id,
      sipUsers: sipUsers.map(s => s.name),
      sipGroups,
    },
  };
}

async function isAccountAllowed(username: string, ip: string, role: UserRole): Promise<{ ok: boolean; reason?: string }> {
  const perms = await loadPermissions();

  // Admins are always allowed
  if (role === 'admin') return { ok: true };

  // Check allowed_accounts list (empty array = all allowed, only non-empty restricts)
  if (perms.allowed_accounts?.length > 0 && !perms.allowed_accounts.includes(username)) {
    return { ok: false, reason: 'Account not enabled for CallTools.' };
  }

  // Check IP restrictions
  const ipRestrictions = role === 'sip_user'
    ? perms.ip_restrictions?.sip_users?.[username]
    : perms.ip_restrictions?.users?.[username];

  if (ipRestrictions && ipRestrictions.length > 0 && !ipRestrictions.includes(ip)) {
    return { ok: false, reason: 'IP address not authorized.' };
  }

  return { ok: true };
}

export async function createSession(
  user: NonNullable<AuthResult['user']>,
  ip: string,
  ws: ServerWebSocket<unknown>
): Promise<Session> {
  const token = generateToken();

  // Resolve permissions from config file
  const permissions = await resolvePermissions(
    user.role,
    user.sipUser ?? user.sipUsers?.[0],
    user.userId?.toString()
  );

  const session: Session = {
    token,
    username: user.username,
    role: user.role,
    userId: user.userId,
    sipUser: user.sipUser,
    sipUsers: user.sipUsers,
    sipGroups: user.sipGroups,
    permissions,
    ip,
    connectedAt: Date.now(),
    ws,
  };

  activeSessions.set(token, session);
  return session;
}

export function resumeSession(token: string, clientIp: string, ws?: ServerWebSocket<unknown>): Session | null {
  if (invalidatedTokens.has(token)) return null;

  const session = disconnectedSessions.get(token);
  if (!session) return null;

  // Check TTL
  if (session.disconnectedAt && Date.now() - session.disconnectedAt > SESSION_RESUME_TTL) {
    disconnectedSessions.delete(token);
    return null;
  }

  // Check IP pinning
  if (session.ip !== clientIp) return null;

  // Move back to active and re-attach WebSocket
  disconnectedSessions.delete(token);
  session.disconnectedAt = undefined;
  if (ws) session.ws = ws;
  activeSessions.set(token, session);

  return session;
}

export function getSession(token: string): Session | null {
  return activeSessions.get(token) ?? null;
}

export function destroySession(token: string): void {
  activeSessions.delete(token);
  disconnectedSessions.delete(token);
  invalidatedTokens.add(token);
}

export function disconnectSession(token: string): void {
  const session = activeSessions.get(token);
  if (!session) return;

  session.disconnectedAt = Date.now();
  session.ws = undefined;
  activeSessions.delete(token);
  disconnectedSessions.set(token, session);
}

export function getActiveSessions(): Session[] {
  return Array.from(activeSessions.values());
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
