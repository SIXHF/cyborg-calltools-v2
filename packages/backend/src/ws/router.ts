import type { ServerWebSocket } from 'bun';
import type { ServerMessage, ClientMessageType } from '@calltools/shared';
import { auditLog } from '../audit/logger';
import { destroySession } from '../auth/session';
import { checkRateLimit } from './middleware';

type SendFn = (ws: ServerWebSocket<any>, msg: ServerMessage) => void;

interface SessionInfo {
  token: string;
  username: string;
  role: string;
  sipUser?: string;
  sipUsers?: string[];
  permissions: Record<string, boolean>;
  ip: string;
}

/**
 * Route authenticated messages to their handlers.
 * Each handler is responsible for permission checks and audit logging.
 */
export async function routeMessage(
  ws: ServerWebSocket<any>,
  session: SessionInfo,
  msg: ClientMessageType,
  send: SendFn
): Promise<void> {
  const cmd = msg.cmd;

  // Rate limit all commands (except logout) per user
  if (cmd !== 'logout') {
    const rl = checkRateLimit(`cmd:${session.username}`, 60, 10_000);
    if (!rl.allowed) {
      send(ws, { type: 'error', message: 'Too many requests. Slow down.', code: 'RATE_LIMITED' });
      return;
    }
  }

  switch (cmd) {
    case 'logout':
      destroySession(session.token);
      auditLog(session.username, session.role, session.ip, 'logout');
      ws.close(1000, 'Logged out');
      break;

    case 'start_listening':
      await handleStartListening(ws, session, msg, send);
      break;

    case 'stop_listening':
      await handleStopListening(ws, session, msg, send);
      break;

    case 'start_transcript':
      await handleStartTranscript(ws, session, msg, send);
      break;

    case 'stop_transcript':
      await handleStopTranscript(ws, session, msg, send);
      break;

    case 'set_callerid':
      await handleSetCallerId(ws, session, msg, send);
      break;

    case 'originate_call':
      await handleOriginateCall(ws, session, msg, send);
      break;

    case 'cnam_lookup':
      await handleCnamLookup(ws, session, msg, send);
      break;

    case 'get_cdr':
      await handleGetCdr(ws, session, msg, send);
      break;

    case 'get_stats':
      await handleGetStats(ws, session, msg, send);
      break;

    case 'upload_audio':
      await handleUploadAudio(ws, session, msg, send);
      break;

    case 'play_audio':
      await handlePlayAudio(ws, session, msg, send);
      break;

    // Admin commands
    case 'admin_set_permissions':
    case 'admin_force_logout':
    case 'admin_broadcast':
    case 'admin_clear_rate_limit':
    case 'admin_approve_audio':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        auditLog(session.username, session.role, session.ip, 'admin_denied', cmd);
        return;
      }
      await handleAdminCommand(ws, session, msg, send);
      break;

    default:
      send(ws, { type: 'error', message: `Unknown command: ${cmd}`, code: 'UNKNOWN_CMD' });
  }
}

// ── Handler stubs (to be implemented with full logic) ──────────────

async function handleStartListening(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.dtmf) {
    send(ws, { type: 'error', message: 'DTMF monitoring not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'dtmf');
    return;
  }
  auditLog(session.username, session.role, session.ip, 'start_listening', msg.channel);
  // TODO: Subscribe to AMI events for this channel
  send(ws, { type: 'dtmf_start', channel: msg.channel, sipUser: session.sipUser ?? session.username });
}

async function handleStopListening(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  auditLog(session.username, session.role, session.ip, 'stop_listening', msg.channel);
  send(ws, { type: 'dtmf_done', channel: msg.channel });
}

async function handleStartTranscript(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.transcript) {
    send(ws, { type: 'error', message: 'Transcription not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'transcript');
    return;
  }
  auditLog(session.username, session.role, session.ip, 'start_transcript', msg.channel);
  send(ws, { type: 'transcript_start', channel: msg.channel });
}

async function handleStopTranscript(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  auditLog(session.username, session.role, session.ip, 'stop_transcript', msg.channel);
  send(ws, { type: 'transcript_done', channel: msg.channel });
}

async function handleSetCallerId(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.caller_id) {
    send(ws, { type: 'callerid_blocked', sipUser: msg.sipUser, reason: 'Caller ID changes not permitted.' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'caller_id');
    return;
  }
  auditLog(session.username, session.role, session.ip, 'set_callerid', msg.sipUser, msg.callerid);
  // TODO: Update caller ID in database
  send(ws, { type: 'callerid_updated', sipUser: msg.sipUser, callerid: msg.callerid });
}

async function handleOriginateCall(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  const rl = checkRateLimit(`call:${session.username}`, 1, 5_000);
  if (!rl.allowed) {
    send(ws, { type: 'error', message: 'Please wait before making another call.', code: 'RATE_LIMITED' });
    return;
  }
  auditLog(session.username, session.role, session.ip, 'originate_call', msg.sipUser, msg.destination);
  // TODO: Send AMI Originate action
  send(ws, { type: 'call_originated', sipUser: msg.sipUser, destination: msg.destination });
}

async function handleCnamLookup(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.cnam_lookup) {
    send(ws, { type: 'error', message: 'CNAM lookup not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'cnam_lookup');
    return;
  }
  // TODO: Call Telnyx API
  send(ws, { type: 'cnam_result', number: msg.number, name: 'Unknown' });
}

async function handleGetCdr(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.cdr) {
    send(ws, { type: 'error', message: 'CDR access not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'cdr');
    return;
  }
  // TODO: Query CDR from database
  send(ws, { type: 'cdr_result', records: [], total: 0 });
}

async function handleGetStats(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  // TODO: Compile stats
  send(ws, { type: 'stats_result', data: {} });
}

async function handleUploadAudio(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.audio_player) {
    send(ws, { type: 'error', message: 'Audio upload not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'audio_player');
    return;
  }
  auditLog(session.username, session.role, session.ip, 'upload_audio', msg.filename);
  // TODO: Save audio file, add to pending approvals
}

async function handlePlayAudio(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.audio_player) {
    send(ws, { type: 'error', message: 'Audio playback not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'audio_player');
    return;
  }
  // TODO: Stream audio via AMI
}

async function handleAdminCommand(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  auditLog(session.username, session.role, session.ip, `admin_${msg.cmd.replace('admin_', '')}`, JSON.stringify(msg));
  // TODO: Implement admin handlers
  send(ws, { type: 'error', message: 'Admin command handler not yet implemented.', code: 'NOT_IMPLEMENTED' });
}
