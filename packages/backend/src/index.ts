import { type ServerWebSocket } from 'bun';
import { ClientMessage, type ServerMessage } from '@calltools/shared';
import { authenticate, resumeSession, createSession, destroySession, getSession, disconnectSession } from './auth/session';
import { checkRateLimit } from './ws/middleware';
import { routeMessage, setBroadcastFunction } from './ws/router';
import { cleanupMonitor } from './ws/handlers/dtmf';
import { cleanupAudioState } from './ws/handlers/audio';
import { auditLog } from './audit/logger';
import { initAmiClient } from './ami/client';
import { initDatabase } from './db/mysql';
import {
  startChannelPolling,
  onChannelsRefreshed,
  getActiveChannels,
  getUserChannels,
  enrichWithTrunkInfo,
  formatChannelsForClient,
  type RawChannel,
} from './ami/channels';
import { enrichChannels } from './services/enrichment';
import { checkTranscriptionChannels } from './services/transcription';

const VERSION = '2.0.0-beta.1';

const WS_PORT = Number(process.env.WS_PORT ?? 8766);
const WS_HOST = process.env.WS_HOST ?? '0.0.0.0';
const ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS ?? 'https://sip.osetec.net').split(',');
const MAX_CONNECTIONS_PER_USER = Number(process.env.MAX_CONNECTIONS_PER_USER ?? 3);

/** Track active WebSocket connections */
interface WsData {
  token?: string;
  ip: string;
  connectedAt: number;
}

const connectionsByUser = new Map<string, Set<ServerWebSocket<WsData>>>();

function send(ws: ServerWebSocket<WsData>, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

function getClientIp(ws: ServerWebSocket<WsData>, req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ws.data.ip;
}

function trackConnection(username: string, ws: ServerWebSocket<WsData>): boolean {
  const conns = connectionsByUser.get(username) ?? new Set();
  if (conns.size >= MAX_CONNECTIONS_PER_USER) return false;
  conns.add(ws);
  connectionsByUser.set(username, conns);
  return true;
}

function untrackConnection(ws: ServerWebSocket<WsData>) {
  for (const [username, conns] of connectionsByUser) {
    conns.delete(ws);
    if (conns.size === 0) connectionsByUser.delete(username);
  }
}

/**
 * Broadcast any message to all authenticated clients.
 */
function broadcastToAll(msg: ServerMessage) {
  for (const [_, conns] of connectionsByUser) {
    for (const ws of conns) {
      if (ws.data.token) {
        try { send(ws, msg); } catch {}
      }
    }
  }
}

// Wire up broadcast function for admin broadcast command
setBroadcastFunction(broadcastToAll);

/**
 * Broadcast channel updates to all authenticated clients.
 * Each client gets channels filtered by their role/permissions.
 */
async function broadcastChannels(allChannels: RawChannel[]) {
  // Auto-stop transcriptions for channels that no longer exist (hangup detection)
  const activeChannelNames = new Set(allChannels.map((ch: any) => ch.channel || ch.name || ''));
  checkTranscriptionChannels(activeChannelNames);

  for (const [username, conns] of connectionsByUser) {
    for (const ws of conns) {
      if (!ws.data.token) continue;
      const session = getSession(ws.data.token);
      if (!session) continue;

      try {
        const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
        const userChannels = await getUserChannels(allChannels, session.role, sipUsers);

        // Admin gets trunk info enrichment
        if (session.role === 'admin') {
          enrichWithTrunkInfo(userChannels, allChannels);
        }

        const formatted = formatChannelsForClient(userChannels, allChannels);
        send(ws, { type: 'channel_update', channels: formatted });

        // Fire async CNAM + fraud + cost enrichment (non-blocking)
        if (formatted.length > 0) {
          const canCnam = session.role === 'admin' || session.permissions.cnam_lookup !== false;
          const canFraud = session.role === 'admin';
          const canCost = session.role === 'admin' || session.permissions.call_cost === true;
          enrichChannels(ws, send, formatted, canCnam, canFraud, canCost, allChannels as any).catch(() => {});
        }
      } catch (err) {
        console.error(`[WS] Failed to broadcast channels to ${username}:`, err);
      }
    }
  }
}

const server = Bun.serve({
  port: WS_PORT,
  hostname: WS_HOST,

  fetch(req, server) {
    const origin = req.headers.get('origin') ?? '';
    // Allow empty origin (proxied requests) and check whitelist
    if (origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    const upgraded = server.upgrade(req, {
      data: {
        ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim()
          ?? req.headers.get('x-real-ip')
          ?? '0.0.0.0',
        connectedAt: Date.now(),
      } satisfies WsData,
    });

    if (!upgraded) {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    return undefined;
  },

  websocket: {
    maxPayloadLength: 16 * 1024 * 1024, // 16MB to accommodate base64 audio uploads (10MB raw ~13.3MB encoded)
    idleTimeout: 120, // seconds

    open(ws: ServerWebSocket<WsData>) {
      console.log(`[WS] Connection opened from ${ws.data.ip}`);
    },

    async message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
      const text = typeof raw === 'string' ? raw : raw.toString();
      console.log(`[WS] Message from ${ws.data.ip}: ${text.slice(0, 200)}`);

      // Parse JSON
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON', code: 'INVALID_JSON' });
        return;
      }

      // Handle ping
      if (typeof data === 'object' && data !== null && 'cmd' in data && (data as { cmd: string }).cmd === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }

      // Validate message schema
      const parsed = ClientMessage.safeParse(data);
      if (!parsed.success) {
        send(ws, {
          type: 'error',
          message: `Invalid message: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
          code: 'INVALID_MESSAGE',
        });
        return;
      }

      const msg = parsed.data;
      const clientIp = ws.data.ip;

      // Handle login
      if (msg.cmd === 'login') {
        const rateLimitResult = checkRateLimit(`${clientIp}:${msg.username}`, 5, 60_000);
        if (!rateLimitResult.allowed) {
          send(ws, { type: 'auth_error', message: `Rate limited. Try again in ${rateLimitResult.retryAfter}s.` });
          auditLog('system', 'system', clientIp, 'login_rate_limited', msg.username);
          return;
        }

        const authResult = await authenticate(msg.username, msg.password, clientIp);
        if (!authResult.success) {
          send(ws, { type: 'auth_error', message: authResult.error ?? 'Invalid credentials' });
          auditLog(msg.username, 'unknown', clientIp, 'login_denied', undefined, authResult.error);
          return;
        }

        if (!trackConnection(authResult.user!.username, ws)) {
          send(ws, { type: 'auth_error', message: 'Too many concurrent connections.' });
          auditLog(msg.username, authResult.user!.role, clientIp, 'login_denied', undefined, 'max_connections');
          return;
        }

        const session = await createSession(authResult.user!, clientIp, ws);
        ws.data.token = session.token;

        // Fetch current callerid for the user's primary SIP extension
        let currentCallerid = '';
        const primarySip = session.sipUser ?? session.sipUsers?.[0];
        if (primarySip) {
          try {
            const cidRows = await import('./db/mysql').then(m => m.dbQuery<any>('SELECT callerid FROM pkg_sip WHERE name = ? LIMIT 1', [primarySip]));
            currentCallerid = cidRows[0]?.callerid || '';
          } catch {}
        }

        send(ws, {
          type: 'auth_ok',
          token: session.token,
          username: session.username,
          role: session.role,
          version: VERSION,
          permissions: session.permissions as unknown as Record<string, boolean>,
          sipUsers: session.sipUsers ?? [],
          sipGroups: authResult.user!.sipGroups,
        });

        auditLog(session.username, session.role, clientIp, 'login');
        return;
      }

      // Handle resume
      if (msg.cmd === 'resume') {
        const session = resumeSession(msg.token, clientIp, ws);
        if (!session) {
          send(ws, { type: 'resume_failed', reason: 'Session expired or invalid.' });
          return;
        }

        if (!trackConnection(session.username, ws)) {
          send(ws, { type: 'resume_failed', reason: 'Too many concurrent connections.' });
          return;
        }

        ws.data.token = session.token;
        // Send full auth state on resume (V1 parity)
        send(ws, {
          type: 'auth_ok',
          token: session.token,
          username: session.username,
          role: session.role,
          version: VERSION,
          permissions: session.permissions as unknown as Record<string, boolean>,
          sipUsers: session.sipUsers ?? [],
          sipGroups: session.sipGroups ?? [],
        } as any);

        auditLog(session.username, session.role, clientIp, 'session_resume');
        return;
      }

      // All other commands require auth
      if (!ws.data.token) {
        send(ws, { type: 'error', message: 'Not authenticated.', code: 'NOT_AUTHENTICATED' });
        return;
      }

      const session = getSession(ws.data.token);
      if (!session) {
        send(ws, { type: 'error', message: 'Session expired.', code: 'SESSION_EXPIRED' });
        ws.data.token = undefined;
        return;
      }

      // Route to appropriate handler
      await routeMessage(ws, session, msg, send);
    },

    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.token) {
        const session = getSession(ws.data.token);
        if (session) {
          auditLog(session.username, session.role, ws.data.ip, 'disconnect');
          // Move session to disconnected state for resume (5-min TTL)
          disconnectSession(ws.data.token);
        }
        cleanupMonitor(ws.data.token); // Clean up DTMF monitor (V1 line 2682)
      }
      cleanupAudioState(ws); // Clean up audio playback state
      untrackConnection(ws);
    },
  },
});

// Initialize services
async function init() {
  console.log(`[CallTools V2] Starting v${VERSION}...`);

  try {
    await initDatabase();
    console.log('[CallTools V2] Database connected.');
  } catch (err) {
    console.error('[CallTools V2] Database connection failed:', err);
  }

  try {
    await initAmiClient();
    console.log('[CallTools V2] AMI connected.');

    // Start channel polling and broadcasting
    onChannelsRefreshed(broadcastChannels);
    startChannelPolling(3000);
    console.log('[CallTools V2] Channel polling started.');
  } catch (err) {
    console.error('[CallTools V2] AMI connection failed:', err);
  }

  console.log(`[CallTools V2] WebSocket server listening on ws://${WS_HOST}:${WS_PORT}`);
}

init();
