import type { ServerWebSocket } from 'bun';
import type { ServerMessage, ClientMessageType } from '@calltools/shared';
import { auditLog } from '../audit/logger';
import { destroySession } from '../auth/session';
import { checkRateLimit } from './middleware';
import {
  getActiveChannels,
  getUserChannels,
  enrichWithTrunkInfo,
  formatChannelsForClient,
} from '../ami/channels';
import { handleSetCallerId } from './handlers/callerid';
import { handleOriginateCall } from './handlers/originate';
import { handleGetCdr } from './handlers/cdr';
import { handleGetBalance, handleGetRefillHistory } from './handlers/billing';
import { handleCnamLookup } from './handlers/cnam';
import {
  handleGetStats,
  handleGetPermissions,
  handleSetPermissions,
  handleGetSessions,
  handleForceLogout,
  handleBroadcast,
  handleGetUsersOverview,
} from './handlers/admin';

type SendFn = (ws: ServerWebSocket<any>, msg: ServerMessage) => void;

interface SessionInfo {
  token: string;
  username: string;
  role: string;
  sipUser?: string;
  sipUsers?: string[];
  permissions: Record<string, boolean>;
  ip: string;
  userId?: number;
}

/** Callback for broadcasting to all clients */
let broadcastFn: ((msg: any) => void) | null = null;
export function setBroadcastFunction(fn: (msg: any) => void) {
  broadcastFn = fn;
}

/**
 * Route authenticated messages to their handlers.
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

    case 'get_channels':
      await handleGetChannels(ws, session, msg, send);
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
      await handleSetCallerId(ws, session, msg as any, send);
      break;

    case 'originate_call':
      await handleOriginateCall(ws, session, msg as any, send);
      break;

    case 'cnam_lookup':
      await handleCnamLookup(ws, session, msg as any, send);
      break;

    case 'get_cdr':
      await handleGetCdr(ws, session, msg as any, send);
      break;

    case 'get_balance':
      if (!session.permissions.billing) {
        send(ws, { type: 'error', message: 'Billing access not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetBalance(ws, session, msg as any, send);
      break;

    case 'get_refill_history':
      if (!session.permissions.billing) {
        send(ws, { type: 'error', message: 'Billing access not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetRefillHistory(ws, session, msg as any, send);
      break;

    case 'get_stats':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetStats(ws, session, msg as any, send);
      break;

    case 'get_users_overview':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetUsersOverview(ws, session, msg as any, send);
      break;

    case 'get_permissions':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetPermissions(ws, session, msg as any, send);
      break;

    case 'get_sessions':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetSessions(ws, session, msg as any, send);
      break;

    case 'upload_audio':
      await handleUploadAudio(ws, session, msg, send);
      break;

    case 'play_audio':
      await handlePlayAudio(ws, session, msg, send);
      break;

    // Admin commands
    case 'admin_set_permissions':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        auditLog(session.username, session.role, session.ip, 'admin_denied', cmd);
        return;
      }
      await handleSetPermissions(ws, session, msg as any, send);
      break;

    case 'admin_force_logout':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleForceLogout(ws, session, msg as any, send);
      break;

    case 'admin_broadcast':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleBroadcast(ws, session, msg as any, send, broadcastFn ?? undefined);
      break;

    case 'admin_clear_rate_limit':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      send(ws, { type: 'error', message: 'Rate limit clearing not yet implemented.', code: 'NOT_IMPLEMENTED' });
      break;

    case 'admin_approve_audio':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      send(ws, { type: 'error', message: 'Audio approval not yet implemented.', code: 'NOT_IMPLEMENTED' });
      break;

    default:
      send(ws, { type: 'error', message: `Unknown command: ${cmd}`, code: 'UNKNOWN_CMD' });
  }
}

// ── Inline handlers ────────────────────────────────────────────────

async function handleGetChannels(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  const allChannels = await getActiveChannels();
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  const targetSip = msg.targetSip || undefined;

  if (targetSip && session.role !== 'admin') {
    if (!sipUsers.includes(targetSip)) {
      send(ws, { type: 'error', message: 'Target SIP user not in your scope.', code: 'FORBIDDEN' });
      return;
    }
  }

  const userChannels = await getUserChannels(allChannels, session.role, sipUsers, targetSip);
  if (session.role === 'admin') {
    enrichWithTrunkInfo(userChannels, allChannels);
  }

  const formatted = formatChannelsForClient(userChannels, allChannels);
  send(ws, { type: 'channel_update', channels: formatted });
}

async function handleStartListening(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.dtmf) {
    send(ws, { type: 'error', message: 'DTMF monitoring not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'dtmf');
    return;
  }
  auditLog(session.username, session.role, session.ip, 'start_listening', msg.channel);
  // TODO: Subscribe to AMI DTMF events for this channel's bridge
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

async function handleUploadAudio(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.audio_player) {
    send(ws, { type: 'error', message: 'Audio upload not permitted.', code: 'FORBIDDEN' });
    return;
  }
  auditLog(session.username, session.role, session.ip, 'upload_audio', msg.filename);
  // TODO: Save audio file, add to pending approvals
  send(ws, { type: 'error', message: 'Audio upload not yet implemented.', code: 'NOT_IMPLEMENTED' });
}

async function handlePlayAudio(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.audio_player) {
    send(ws, { type: 'error', message: 'Audio playback not permitted.', code: 'FORBIDDEN' });
    return;
  }
  // TODO: Stream audio via AMI
  send(ws, { type: 'error', message: 'Audio playback not yet implemented.', code: 'NOT_IMPLEMENTED' });
}
