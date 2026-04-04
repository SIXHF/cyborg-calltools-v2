import type { ServerWebSocket } from 'bun';
import type { ServerMessage, ClientMessageType, SipUsageEntry, SipUsageTotals, TopDestination } from '@calltools/shared';
import { auditLog } from '../audit/logger';
import { destroySession } from '../auth/session';
import { checkRateLimit } from './middleware';
import { dbQuery } from '../db/mysql';

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

    case 'get_sip_usage':
      await handleGetSipUsage(ws, session, msg, send);
      break;

    case 'ping':
      send(ws, { type: 'pong' });
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

async function handleGetSipUsage(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  if (!session.permissions.cdr) {
    send(ws, { type: 'error', message: 'CDR access not permitted.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'permission_denied', 'cdr');
    return;
  }

  try {
    // Determine which SIP users to query
    let sipList: string[] = [];
    const targetAccount = msg.target_account;
    const targetSip = msg.target_sip;

    if (session.role === 'sip_user') {
      sipList = session.sipUser ? [session.sipUser] : [];
    } else if (session.role === 'user') {
      sipList = session.sipUsers ?? [];
      if (targetSip && sipList.includes(targetSip)) {
        sipList = [targetSip];
      }
    } else if (session.role === 'admin') {
      if (targetAccount) {
        const acctRows = await dbQuery<{ name: string }>(
          `SELECT s.name FROM pkg_sip s JOIN pkg_user u ON s.id_user = u.id WHERE u.username = ?`,
          [targetAccount]
        );
        sipList = acctRows.map(r => r.name);
      } else if (targetSip) {
        sipList = [targetSip];
      } else {
        const allRows = await dbQuery<{ name: string }>('SELECT name FROM pkg_sip');
        sipList = allRows.map(r => r.name);
      }
    }

    if (sipList.length === 0) {
      send(ws, {
        type: 'sip_usage_data',
        sip_usage: [],
        totals: { total_calls: 0, answered: 0, failed: 0, total_seconds: 0, total_cost: 0 },
        hourly: [],
        top_destinations: [],
        shift_start: '',
        timestamp: Date.now() / 1000,
      });
      return;
    }

    // Shift time window: 8pm PKT to 8am PKT (same as V1)
    const shiftRows = await dbQuery<{ shift_start: string }>(
      `SELECT IF(HOUR(NOW()) >= 20, CONCAT(CURDATE(), ' 20:00:00'), CONCAT(CURDATE() - INTERVAL 1 DAY, ' 20:00:00')) as shift_start`
    );
    const shiftStart = shiftRows[0]?.shift_start ?? '';
    const dateFilter = shiftStart ? shiftStart : new Date().toISOString().slice(0, 10);

    // Build parameterized IN clause
    const placeholders = sipList.map(() => '?').join(',');

    // Per-SIP answered stats
    const answeredRows = await dbQuery<{ src: string; calls: number; secs: number; cost: number }>(
      `SELECT src, COUNT(*) as calls, SUM(sessiontime) as secs, SUM(sessionbill) as cost FROM pkg_cdr WHERE src IN (${placeholders}) AND starttime >= ? GROUP BY src`,
      [...sipList, dateFilter]
    );

    // Per-SIP failed stats
    const failedRows = await dbQuery<{ src: string; calls: number }>(
      `SELECT src, COUNT(*) as calls FROM pkg_cdr_failed WHERE src IN (${placeholders}) AND starttime >= ? GROUP BY src`,
      [...sipList, dateFilter]
    );

    // Hourly distribution
    const hourlyRows = await dbQuery<{ hr: number; cnt: number }>(
      `SELECT HOUR(starttime) as hr, COUNT(*) as cnt FROM pkg_cdr WHERE src IN (${placeholders}) AND starttime >= ? GROUP BY HOUR(starttime) ORDER BY hr`,
      [...sipList, dateFilter]
    );

    // Top destinations
    const topDestRows = await dbQuery<{ calledstation: string; cnt: number; dur: number; cost: number }>(
      `SELECT calledstation, COUNT(*) as cnt, SUM(sessiontime) as dur, SUM(sessionbill) as cost FROM pkg_cdr WHERE src IN (${placeholders}) AND starttime >= ? GROUP BY calledstation ORDER BY cnt DESC LIMIT 10`,
      [...sipList, dateFilter]
    );

    // Build per-SIP usage map
    const usageMap: Record<string, { sip_user: string; answered: number; total_seconds: number; cost: number; failed: number }> = {};
    for (const row of answeredRows) {
      usageMap[row.src] = {
        sip_user: row.src,
        answered: Number(row.calls || 0),
        total_seconds: Number(row.secs || 0),
        cost: Number(row.cost || 0),
        failed: 0,
      };
    }
    for (const row of failedRows) {
      if (usageMap[row.src]) {
        usageMap[row.src].failed = Number(row.calls || 0);
      } else {
        usageMap[row.src] = {
          sip_user: row.src,
          answered: 0,
          total_seconds: 0,
          cost: 0,
          failed: Number(row.calls || 0),
        };
      }
    }

    // Build response arrays
    const sipUsage: SipUsageEntry[] = [];
    let totalCalls = 0, totalAnswered = 0, totalFailed = 0, totalSeconds = 0, totalCost = 0;

    for (const sipName of sipList) {
      const u = usageMap[sipName] ?? { sip_user: sipName, answered: 0, total_seconds: 0, cost: 0, failed: 0 };
      const calls = u.answered + u.failed;
      const successRate = calls > 0 ? Math.round((u.answered / calls) * 1000) / 10 : 0;
      sipUsage.push({
        sip_user: sipName,
        total_calls: calls,
        answered: u.answered,
        failed: u.failed,
        total_seconds: u.total_seconds,
        cost: Math.round(u.cost * 1000000) / 1000000,
        success_rate: successRate,
      });
      totalCalls += calls;
      totalAnswered += u.answered;
      totalFailed += u.failed;
      totalSeconds += u.total_seconds;
      totalCost += u.cost;
    }

    // Sort by total_calls descending (default, same as V1)
    sipUsage.sort((a, b) => b.total_calls - a.total_calls);

    // Hourly distribution (24 buckets)
    const hourly: number[] = new Array(24).fill(0);
    for (const row of hourlyRows) {
      const hr = Number(row.hr);
      if (hr >= 0 && hr < 24) {
        hourly[hr] = Number(row.cnt || 0);
      }
    }

    // Top destinations
    const topDestinations: TopDestination[] = topDestRows.map(row => ({
      number: row.calledstation,
      calls: Number(row.cnt || 0),
      seconds: Number(row.dur || 0),
      cost: Math.round(Number(row.cost || 0) * 1000000) / 1000000,
    }));

    const totals: SipUsageTotals = {
      total_calls: totalCalls,
      answered: totalAnswered,
      failed: totalFailed,
      total_seconds: totalSeconds,
      total_cost: Math.round(totalCost * 1000000) / 1000000,
    };

    send(ws, {
      type: 'sip_usage_data',
      sip_usage: sipUsage,
      totals,
      hourly,
      top_destinations: topDestinations,
      shift_start: shiftStart,
      timestamp: Date.now() / 1000,
    });
  } catch (err: any) {
    console.error('[SipUsage] Error:', err);
    send(ws, { type: 'error', message: 'Failed to load SIP usage data.', code: 'INTERNAL' });
  }
}

async function handleAdminCommand(ws: ServerWebSocket<any>, session: SessionInfo, msg: any, send: SendFn) {
  auditLog(session.username, session.role, session.ip, `admin_${msg.cmd.replace('admin_', '')}`, JSON.stringify(msg));
  // TODO: Implement admin handlers
  send(ws, { type: 'error', message: 'Admin command handler not yet implemented.', code: 'NOT_IMPLEMENTED' });
}
