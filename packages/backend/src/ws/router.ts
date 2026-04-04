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
import { handleSetCallerId, handleGetCallerId } from './handlers/callerid';
import { resolvePermissions } from '../auth/permissions';
import { dbQuery } from '../db/mysql';
import { handleOriginateCall } from './handlers/originate';
import { handleTransferCall } from './handlers/transfer';
import { handleGetCdr, handleGetSipUsage } from './handlers/cdr';
import { handleGetBalance, handleGetRefillHistory } from './handlers/billing';
import { handleCnamLookup } from './handlers/cnam';
import { handleStartListening as handleDtmfStart, handleStopListening as handleDtmfStop } from './handlers/dtmf';
import { handleCreatePayment } from './handlers/payment';
import { handleListAudio, handleUploadAudio, handlePlayAudio, handleStopAudio, handleDeleteAudio, cleanupAudioState } from './handlers/audio';
import { enrichChannels } from '../services/enrichment';
import {
  handleGetStats,
  handleGetPermissions,
  handleSetPermissions,
  handleGetSessions,
  handleForceLogout,
  handleBroadcast,
  handleGetUsersOverview,
  handleGetAuditLog,
  handleAddCredit,
  handleSetGlobalSettings,
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
      if (!session.permissions.dtmf) {
        send(ws, { type: 'error', message: 'DTMF monitoring not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleDtmfStart(ws, session, msg as any, send);
      break;

    case 'stop_listening':
      await handleDtmfStop(ws, session, msg as any, send);
      break;

    case 'start_transcript':
      await handleStartTranscript(ws, session, msg, send);
      break;

    case 'stop_transcript':
      await handleStopTranscript(ws, session, msg, send);
      break;

    case 'switch_sip_user':
      await handleSwitchSipUser(ws, session, msg as any, send);
      break;

    case 'get_callerid':
      await handleGetCallerId(ws, session, msg as any, send);
      break;

    case 'set_callerid':
      if (!session.permissions.caller_id) {
        send(ws, { type: 'error', message: 'Caller ID management not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleSetCallerId(ws, session, msg as any, send);
      break;

    case 'originate_call':
      if (!session.permissions.quick_dial) {
        send(ws, { type: 'error', message: 'Quick dial not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleOriginateCall(ws, session, msg as any, send);
      break;

    case 'cnam_lookup':
      if (!session.permissions.cnam_lookup) {
        send(ws, { type: 'error', message: 'CNAM lookup not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleCnamLookup(ws, session, msg as any, send);
      break;

    case 'get_cdr':
      if (!session.permissions.cdr) {
        send(ws, { type: 'error', message: 'CDR access not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetCdr(ws, session, msg as any, send);
      break;

    case 'transfer_call':
      await handleTransferCall(ws, session, msg as any, send);
      break;

    case 'get_sip_usage':
      if (!session.permissions.cdr) {
        send(ws, { type: 'error', message: 'CDR access not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetSipUsage(ws, session, msg as any, send);
      break;

    case 'create_payment':
      if (!session.permissions.billing) {
        send(ws, { type: 'error', message: 'Billing access not permitted.', code: 'FORBIDDEN' });
        return;
      }
      await handleCreatePayment(ws, session, msg as any, send);
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

    case 'list_audio':
      if (!session.permissions.audio_player) {
        send(ws, { type: 'error', message: 'Audio player is disabled for your account.', code: 'FORBIDDEN' });
        return;
      }
      await handleListAudio(ws, session, msg, send);
      break;

    case 'upload_audio':
      await handleUploadAudio(ws, session, msg, send);
      break;

    case 'play_audio':
      await handlePlayAudio(ws, session, msg, send);
      break;

    case 'stop_audio':
      await handleStopAudio(ws, session, msg, send);
      break;

    case 'delete_audio':
      await handleDeleteAudio(ws, session, msg, send);
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

    case 'get_audit_log':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleGetAuditLog(ws, session, msg as any, send);
      break;

    case 'add_credit':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleAddCredit(ws, session, msg as any, send);
      break;

    case 'set_global_settings':
      if (session.role !== 'admin') {
        send(ws, { type: 'error', message: 'Admin access required.', code: 'FORBIDDEN' });
        return;
      }
      await handleSetGlobalSettings(ws, session, msg as any, send, broadcastFn ?? undefined);
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

    case 'get_sip_info':
      await handleGetSipInfo(ws, session, send);
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

  // Fire async CNAM + fraud + cost enrichment (non-blocking, like V1's _send_cnam_update)
  const canCnam = session.role === 'admin' || session.permissions.cnam_lookup !== false;
  const canFraud = session.role === 'admin';
  const canCost = session.role === 'admin' || session.permissions.call_cost === true;
  enrichChannels(ws, send, formatted, canCnam, canFraud, canCost, allChannels as any).catch(err => console.error('[Enrich] error:', err));
}

async function handleSwitchSipUser(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  const sipUser = (msg.sipUser || '').trim();

  // Ownership validation: non-admin can only switch to their own SIP users
  if (sipUser && session.role !== 'admin') {
    const ownedSips = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
    if (!ownedSips.includes(sipUser)) {
      send(ws, { type: 'error', message: 'Access denied for this SIP user.', code: 'FORBIDDEN' });
      return;
    }
  }

  // Update session context
  (session as any).selectedSipUser = sipUser || undefined;

  // Resolve permissions for the selected SIP user
  const perms = sipUser
    ? await resolvePermissions(session.role, sipUser, session.userId?.toString())
    : await resolvePermissions(session.role, session.sipUser, session.userId?.toString());
  session.permissions = perms;

  // Get callerid for the selected SIP user
  let callerid = '';
  let tollfreeBlocked = false;
  if (sipUser) {
    try {
      const rows = await dbQuery<any>('SELECT callerid FROM pkg_sip WHERE name = ? LIMIT 1', [sipUser]);
      callerid = rows[0]?.callerid || '';
    } catch {}
    tollfreeBlocked = !perms.allow_tollfree_callerid;
  }

  send(ws, {
    type: 'sip_user_switched',
    sipUser: sipUser || '',
    permissions: perms,
    callerid,
    tollfreeBlocked,
  });
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

async function handleGetSipInfo(ws: ServerWebSocket<any>, session: SessionInfo, send: SendFn) {
  try {
    const sipUser = session.sipUser;
    const userId = session.userId;

    // Query SIP extensions for this user (admin sees all, user sees own, sip_user sees own)
    const rows = session.role === 'admin'
      ? await dbQuery<{ name: string; callerid: string; host: string; allow: string; secret: string }>(
          'SELECT s.name, s.callerid, s.host, s.allow, s.secret FROM pkg_sip s ORDER BY s.name'
        )
      : await dbQuery<{ name: string; callerid: string; host: string; allow: string; secret: string }>(
          'SELECT s.name, s.callerid, s.host, s.allow, s.secret FROM pkg_sip s WHERE s.id_user = ? OR s.name = ?',
          [userId ?? 0, sipUser ?? '']
        );

    const extensions = await Promise.all(
      rows.map(async (row) => {
        // Check registration status via Asterisk CLI
        let registered = false;
        try {
          const proc = Bun.spawn(['/usr/sbin/asterisk', '-rx', `sip show peer ${row.name}`], {
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const output = await new Response(proc.stdout).text();
          registered = output.includes('OK');
        } catch {
          // If asterisk command fails, assume unregistered
        }

        return {
          name: row.name,
          callerid: row.callerid || '',
          host: row.host || '',
          codecs: row.allow || '',
          secret: session.role === 'admin' ? (row.secret || '') : '••••••',
          registered,
        };
      })
    );

    send(ws, { type: 'sip_info', extensions });
  } catch (err) {
    console.error('[WS] get_sip_info error:', err);
    send(ws, { type: 'error', message: 'Failed to fetch SIP info.', code: 'INTERNAL_ERROR' });
  }
}
