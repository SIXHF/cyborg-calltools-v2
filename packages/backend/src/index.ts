import { type ServerWebSocket } from 'bun';
import { ClientMessage, type ServerMessage } from '@calltools/shared';
import { authenticate, resumeSession, createSession, destroySession, getSession } from './auth/session';
import { checkRateLimit } from './ws/middleware';
import { routeMessage } from './ws/router';
import { auditLog } from './audit/logger';
import { initAmiClient } from './ami/client';
import { initDatabase } from './db/mysql';

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

const server = Bun.serve({
  port: WS_PORT,
  hostname: WS_HOST,

  fetch(req, server) {
    const origin = req.headers.get('origin') ?? '';
    if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
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
    maxPayloadLength: 2 * 1024 * 1024, // 2MB default
    idleTimeout: 120, // seconds

    open(ws: ServerWebSocket<WsData>) {
      // Connection opened, waiting for auth
    },

    async message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
      const text = typeof raw === 'string' ? raw : raw.toString();

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

        const session = createSession(authResult.user!, clientIp, ws);
        ws.data.token = session.token;

        send(ws, {
          type: 'auth_ok',
          token: session.token,
          username: session.username,
          role: session.role,
          version: VERSION,
          permissions: session.permissions as unknown as Record<string, boolean>,
          sipUsers: session.sipUsers ?? [],
        });

        auditLog(session.username, session.role, clientIp, 'login');
        return;
      }

      // Handle resume
      if (msg.cmd === 'resume') {
        const session = resumeSession(msg.token, clientIp);
        if (!session) {
          send(ws, { type: 'resume_failed', reason: 'Session expired or invalid.' });
          return;
        }

        if (!trackConnection(session.username, ws)) {
          send(ws, { type: 'resume_failed', reason: 'Too many concurrent connections.' });
          return;
        }

        ws.data.token = session.token;
        send(ws, {
          type: 'resume_ok',
          username: session.username,
          role: session.role,
        });

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
        }
      }
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
  } catch (err) {
    console.error('[CallTools V2] AMI connection failed:', err);
  }

  console.log(`[CallTools V2] WebSocket server listening on ws://${WS_HOST}:${WS_PORT}`);
}

init();
