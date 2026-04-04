import type { ServerWebSocket } from 'bun';
import { dbQuery } from '../../db/mysql';
import { getActiveChannels } from '../../ami/channels';
import { auditLog } from '../../audit/logger';
import { getActiveSessions, destroySession } from '../../auth/session';
import { readFile, writeFile } from 'fs/promises';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

const PERMISSIONS_FILE = process.env.PERMISSIONS_FILE ?? '/opt/calltools-v2-permissions.json';
const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE ?? '/opt/calltools-v2-audit.log';

// Disposition labels matching V1
const CAUSE_LABELS: Record<string, string> = {
  '0': 'Unknown', '1': 'Answered', '2': 'Busy',
  '3': 'No Answer', '4': 'Error', '5': 'Congestion',
  '6': 'Failed', '7': 'Cancel', '8': 'Unavailable',
};

export async function handleGetStats(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  try {
    const stats: Record<string, any> = {};

    // Shift window: 8pm PKT to 8am PKT (matches V1 exactly)
    const shiftRows = await dbQuery<any>(
      "SELECT IF(HOUR(NOW()) >= 20, CONCAT(CURDATE(), ' 20:00:00'), CONCAT(CURDATE() - INTERVAL 1 DAY, ' 20:00:00')) as shift_start"
    );
    const shiftStart = shiftRows[0]?.shift_start ?? new Date().toISOString().slice(0, 10) + ' 00:00:00';
    stats.shift_start = shiftStart;

    // Trunk name lookup
    const trunkNameRows = await dbQuery<any>('SELECT id, trunkcode FROM pkg_trunk');
    const tnMap: Record<string, string> = {};
    for (const t of trunkNameRows) tnMap[String(t.id)] = t.trunkcode;

    // Parallel queries (matching V1)
    const [
      answeredRows, failedRows, trunkAnswered, trunkFailed,
      topRows, trunkPerfRows, peakCpsRows, peakCcRows,
      refillsRows, longestCallRows, trunkGroupRows,
      errByTrunkRows, errUsersRows, errCalleridsRows,
      sipCountRows,
    ] = await Promise.all([
      dbQuery<any>('SELECT COUNT(*) as cnt FROM pkg_cdr WHERE starttime >= ?', [shiftStart]),
      dbQuery<any>('SELECT COUNT(*) as cnt FROM pkg_cdr_failed WHERE starttime >= ?', [shiftStart]),
      dbQuery<any>('SELECT id_trunk, COUNT(*) as cnt FROM pkg_cdr WHERE starttime >= ? GROUP BY id_trunk', [shiftStart]),
      dbQuery<any>('SELECT id_trunk, COUNT(*) as cnt FROM pkg_cdr_failed WHERE starttime >= ? GROUP BY id_trunk', [shiftStart]),
      dbQuery<any>('SELECT calledstation, COUNT(*) as cnt FROM pkg_cdr WHERE starttime >= ? GROUP BY calledstation ORDER BY cnt DESC LIMIT 10', [shiftStart]),
      dbQuery<any>('SELECT id_trunk, AVG(sessiontime) as avg_session, SUM(buycost) as total_buy, COUNT(*) as call_count, SUM(sessionbill) as total_bill, SUM(sessiontime) as total_session FROM pkg_cdr WHERE starttime >= ? GROUP BY id_trunk', [shiftStart]),
      dbQuery<any>('SELECT COALESCE(MAX(cps), 0) as v FROM pkg_status_system WHERE date >= ?', [shiftStart]),
      dbQuery<any>('SELECT COALESCE(MAX(total), 0) as v FROM pkg_call_chart WHERE date >= ?', [shiftStart]),
      dbQuery<any>('SELECT COALESCE(SUM(credit), 0) as v FROM pkg_refill WHERE date >= ?', [shiftStart]),
      dbQuery<any>('SELECT COALESCE(MAX(sessiontime), 0) as v FROM pkg_cdr WHERE starttime >= ?', [shiftStart]),
      dbQuery<any>(
        'SELECT g.name, g.type, t.trunkcode, p.credit FROM pkg_trunk_group g ' +
        'JOIN pkg_trunk_group_trunk tgt ON tgt.id_trunk_group = g.id ' +
        'JOIN pkg_trunk t ON t.id = tgt.id_trunk ' +
        'LEFT JOIN pkg_provider p ON t.id_provider = p.id ORDER BY g.id, tgt.id'
      ),
      dbQuery<any>('SELECT id_trunk, terminatecauseid, COUNT(*) as cnt FROM pkg_cdr_failed WHERE starttime >= ? GROUP BY id_trunk, terminatecauseid', [shiftStart]),
      dbQuery<any>('SELECT src, id_trunk, terminatecauseid, COUNT(*) as cnt FROM pkg_cdr_failed WHERE starttime >= ? GROUP BY src, id_trunk, terminatecauseid ORDER BY cnt DESC', [shiftStart]),
      dbQuery<any>('SELECT callerid, id_trunk, COUNT(*) as cnt FROM pkg_cdr_failed WHERE starttime >= ? AND callerid != \'\' AND callerid IS NOT NULL GROUP BY callerid, id_trunk ORDER BY cnt DESC LIMIT 10', [shiftStart]),
      dbQuery<any>('SELECT COUNT(*) as cnt FROM pkg_sip'),
    ]);

    stats.answered = answeredRows[0]?.cnt ?? 0;
    stats.failed = failedRows[0]?.cnt ?? 0;
    stats.calls_today = stats.answered + stats.failed;
    stats.total_sip = sipCountRows[0]?.cnt ?? 0;

    // Active calls
    const channels = await getActiveChannels();
    const upChannels = channels.filter(c => c.state === 'Up');
    const bridgeIds = new Set(upChannels.filter(c => c.bridgeid).map(c => c.bridgeid));
    const unbridged = upChannels.filter(c => !c.bridgeid).length;
    stats.active_calls = bridgeIds.size + unbridged;

    // Registered SIP count
    try {
      const proc = Bun.spawn(['/usr/sbin/asterisk', '-rx', 'sip show peers'], { stdout: 'pipe', stderr: 'pipe' });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      stats.registered = output.split('\n').filter(l => l.includes('OK') && !l.startsWith('Name')).length;
    } catch { stats.registered = 0; }

    // ASR by trunk
    const ansByTrunk: Record<string, number> = {};
    for (const r of trunkAnswered) ansByTrunk[String(r.id_trunk)] = r.cnt;
    const failByTrunk: Record<string, number> = {};
    for (const r of trunkFailed) failByTrunk[String(r.id_trunk)] = r.cnt;
    const allTrunkIds = new Set([...Object.keys(ansByTrunk), ...Object.keys(failByTrunk)]);
    stats.asr_by_trunk = [...allTrunkIds].map(tid => {
      const ans = ansByTrunk[tid] ?? 0;
      const fail = failByTrunk[tid] ?? 0;
      const total = ans + fail;
      return { trunk_id: tid, trunk_name: tnMap[tid] ?? `Trunk ${tid}`, total, answered: ans, asr: total > 0 ? Math.round((ans / total) * 1000) / 10 : 0 };
    });

    // Top 10 dialed numbers
    stats.top_numbers = topRows.map((r: any) => ({ number: r.calledstation, count: r.cnt }));

    // Trunk performance (ACD + cost + revenue) — matches V1 exactly
    const trunkPerformance: any[] = [];
    for (const row of trunkPerfRows) {
      const tid = String(row.id_trunk);
      const acd = parseFloat(row.avg_session) || 0;
      const totalCost = parseFloat(row.total_buy) || 0;
      const callCount = parseInt(row.call_count) || 0;
      const totalRevenue = parseFloat(row.total_bill) || 0;
      const totalSeconds = parseFloat(row.total_session) || 0;
      trunkPerformance.push({
        trunk_id: tid, trunk_name: tnMap[tid] ?? `Trunk ${tid}`,
        acd_seconds: Math.round(acd * 10) / 10,
        avg_cost: callCount > 0 ? Math.round(totalCost / callCount * 10000) / 10000 : 0,
        total_cost: Math.round(totalCost * 100) / 100,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_seconds: Math.round(totalSeconds * 10) / 10,
        answered: callCount,
      });
    }
    trunkPerformance.sort((a, b) => b.answered - a.answered);
    stats.trunk_performance = trunkPerformance;

    // Global aggregates for stat cards
    const totalAnsweredPerf = trunkPerformance.reduce((s, t) => s + t.answered, 0);
    const totalSessionSecs = trunkPerformance.reduce((s, t) => s + t.total_seconds, 0);
    stats.asr_percent = stats.calls_today > 0 ? Math.round((stats.answered / stats.calls_today) * 1000) / 10 : 0;
    stats.acd_seconds = totalAnsweredPerf > 0 ? Math.round(totalSessionSecs / totalAnsweredPerf * 10) / 10 : 0;
    stats.total_cost = Math.round(trunkPerformance.reduce((s, t) => s + t.total_cost, 0) * 100) / 100;
    stats.total_revenue = Math.round(trunkPerformance.reduce((s, t) => s + t.total_revenue, 0) * 100) / 100;
    stats.profit = Math.round((stats.total_revenue - stats.total_cost) * 100) / 100;
    stats.total_minutes = Math.round(totalSessionSecs / 60 * 10) / 10;
    stats.peak_cps = parseInt(peakCpsRows[0]?.v) || 0;
    stats.peak_cc = parseInt(peakCcRows[0]?.v) || 0;
    stats.refills_today = parseFloat(refillsRows[0]?.v) || 0;
    stats.longest_call = parseInt(longestCallRows[0]?.v) || 0;
    stats.connected_users = getActiveSessions().length;

    // Error breakdown by trunk
    const trunkErrors: Record<string, Record<string, number>> = {};
    for (const row of errByTrunkRows) {
      const tid = String(row.id_trunk);
      const code = String(row.terminatecauseid);
      if (!trunkErrors[tid]) trunkErrors[tid] = {};
      trunkErrors[tid][code] = (trunkErrors[tid][code] ?? 0) + (row.cnt ?? 0);
    }
    stats.error_by_trunk = Object.entries(trunkErrors).map(([tid, codes]) => ({
      trunk_id: tid, trunk_name: tnMap[tid] ?? `Trunk ${tid}`,
      total_errors: Object.values(codes).reduce((s, v) => s + v, 0),
      codes,
    })).sort((a, b) => b.total_errors - a.total_errors);

    // Top error caller IDs
    stats.top_error_callerids = errCalleridsRows.map((r: any) => ({
      number: String(r.callerid), trunk_name: tnMap[String(r.id_trunk)] ?? `Trunk ${r.id_trunk}`, count: r.cnt,
    })).slice(0, 10);

    // Top error users
    const userErrAgg: Record<string, { total: number; details: any[] }> = {};
    for (const row of errUsersRows) {
      const src = String(row.src);
      if (!userErrAgg[src]) userErrAgg[src] = { total: 0, details: [] };
      userErrAgg[src].total += row.cnt ?? 0;
      userErrAgg[src].details.push({ trunk: String(row.id_trunk), code: String(row.terminatecauseid), count: row.cnt ?? 0 });
    }
    stats.top_error_users = Object.entries(userErrAgg)
      .map(([src, data]) => {
        const best = data.details.reduce((a, b) => a.count > b.count ? a : b, data.details[0]);
        return { src, errors: data.total, top_error_code: best?.code, trunk_name: tnMap[best?.trunk] ?? '', };
      })
      .sort((a, b) => b.errors - a.errors)
      .slice(0, 10);

    // Trunk failover groups
    const trunkGroups: Record<string, { type: string; trunks: any[] }> = {};
    for (const row of trunkGroupRows) {
      const gname = String(row.name);
      if (!trunkGroups[gname]) trunkGroups[gname] = { type: row.type === 1 ? 'Order' : 'Weight', trunks: [] };
      trunkGroups[gname].trunks.push({ name: row.trunkcode, balance: row.credit != null ? parseFloat(row.credit) : null });
    }
    stats.trunk_groups = trunkGroups;

    send(ws, { type: 'stats_result', data: stats });
  } catch (err) {
    console.error('[Admin] Stats error:', err);
    send(ws, { type: 'error', message: 'Failed to load stats.', code: 'DB_ERROR' });
  }
}

export async function handleGetPermissions(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  try {
    const raw = await readFile(PERMISSIONS_FILE, 'utf-8');
    const config = JSON.parse(raw);
    send(ws, { type: 'permissions_data', config });
  } catch {
    send(ws, { type: 'permissions_data', config: {} });
  }
}

export async function handleSetPermissions(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const { target, permissions } = msg;
  if (!target || !permissions) {
    send(ws, { type: 'error', message: 'Missing target or permissions.', code: 'INVALID_INPUT' });
    return;
  }

  try {
    let config: any = {};
    try {
      const raw = await readFile(PERMISSIONS_FILE, 'utf-8');
      config = JSON.parse(raw);
    } catch {}

    // Handle access control
    if (target === '__access_control__') {
      const { action, account } = permissions as any;
      if (!config.allowed_accounts) config.allowed_accounts = [];
      if (action === 'add' && account && !config.allowed_accounts.includes(account)) {
        config.allowed_accounts.push(account);
      } else if (action === 'remove' && account) {
        config.allowed_accounts = config.allowed_accounts.filter((a: string) => a !== account);
      }
      await writeFile(PERMISSIONS_FILE, JSON.stringify(config, null, 2));
      auditLog(session.username, session.role, session.ip, 'set_access', account, action);
      send(ws, { type: 'permissions_data', config });
      return;
    }

    // Store under admin_restrictions for SIP users
    if (!config.admin_restrictions) config.admin_restrictions = {};
    config.admin_restrictions[target] = permissions;

    await writeFile(PERMISSIONS_FILE, JSON.stringify(config, null, 2));
    auditLog(session.username, session.role, session.ip, 'set_permissions', target, JSON.stringify(permissions));
    // Return full config so admin UI refreshes
    send(ws, { type: 'permissions_data', config });
  } catch (err) {
    send(ws, { type: 'error', message: 'Failed to save permissions.', code: 'FS_ERROR' });
  }
}

export async function handleGetSessions(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const sessions = getActiveSessions().map(s => ({
    username: s.username,
    role: s.role,
    sipUser: s.sipUser,
    ip: s.ip,
    connectedAt: s.connectedAt,
    tokenPrefix: s.token.slice(0, 8),
  }));
  send(ws, { type: 'online_users', users: sessions });
}

export async function handleForceLogout(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const { targetToken } = msg;
  if (!targetToken) {
    send(ws, { type: 'error', message: 'Missing target token.', code: 'INVALID_INPUT' });
    return;
  }

  const allSessions = getActiveSessions();
  const target = allSessions.find(s => s.token === targetToken || s.token.startsWith(targetToken));
  if (!target) {
    send(ws, { type: 'error', message: 'Session not found.', code: 'NOT_FOUND' });
    return;
  }

  if (target.ws) {
    try { (target.ws as any).close(1000, 'Force logged out by admin'); } catch {}
  }
  destroySession(target.token);
  auditLog(session.username, session.role, session.ip, 'force_logout', target.username);
  send(ws, { type: 'admin_broadcast', message: `${target.username} was forcefully logged out.`, from: session.username });
}

export async function handleBroadcast(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn,
  broadcastToAll?: (msg: any) => void
) {
  const message = (msg.message || '').trim();
  if (!message) {
    send(ws, { type: 'error', message: 'Empty broadcast message.', code: 'INVALID_INPUT' });
    return;
  }

  auditLog(session.username, session.role, session.ip, 'broadcast', message);

  if (broadcastToAll) {
    broadcastToAll({ type: 'admin_broadcast', message, from: session.username });
  }

  send(ws, { type: 'admin_broadcast', message: `Broadcast sent: "${message}"`, from: 'system' });
}

export async function handleGetUsersOverview(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  try {
    // Match V1: get all users with SIP counts, last refill info
    const users = await dbQuery<any>(
      'SELECT u.id, u.username, u.credit, u.id_group, u.active, ' +
      '(SELECT COUNT(*) FROM pkg_sip WHERE id_user = u.id) as sip_count, ' +
      '(SELECT MAX(date) FROM pkg_refill r WHERE r.id_user = u.id) as last_refill, ' +
      '(SELECT credit FROM pkg_refill r WHERE r.id_user = u.id ORDER BY date DESC LIMIT 1) as last_refill_amount ' +
      'FROM pkg_user u ORDER BY u.username'
    );

    const result: any[] = [];
    for (const u of users) {
      // Get SIP users for this user
      const sipRows = await dbQuery<any>(
        'SELECT s.name, s.callerid, s.host, s.allow FROM pkg_sip s WHERE s.id_user = ?',
        [u.id]
      );

      const sipUsers = sipRows.map((sr: any) => ({
        extension: sr.name,
        callerid: sr.callerid || '',
        host: sr.host || 'dynamic',
        codecs: sr.allow || '',
      }));

      result.push({
        id: u.id,
        username: u.username,
        credit: parseFloat(String(u.credit)) || 0,
        role: u.id_group === 1 ? 'admin' : 'user',
        sipCount: u.sip_count || 0,
        active: !!u.active,
        lastRefill: u.last_refill || null,
        lastRefillAmount: u.last_refill_amount ? parseFloat(String(u.last_refill_amount)) : null,
        sipUsers,
      });
    }

    send(ws, { type: 'users_overview', users: result });
  } catch (err) {
    console.error('[Admin] Users overview error:', err);
    send(ws, { type: 'error', message: 'Failed to load users.', code: 'DB_ERROR' });
  }
}

export async function handleGetAuditLog(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  try {
    const raw = await readFile(AUDIT_LOG_FILE, 'utf-8').catch(() => '');
    const lines = raw.split('\n').filter(l => l.trim()).reverse().slice(0, 200);

    const actorFilter = (msg.actor || '').trim().toLowerCase();
    const actionFilter = (msg.action || '').trim().toLowerCase();

    const filtered = lines.filter(line => {
      if (actorFilter && !line.toLowerCase().includes(actorFilter)) return false;
      if (actionFilter && !line.toLowerCase().includes(actionFilter)) return false;
      return true;
    }).slice(0, 100);

    send(ws, { type: 'audit_log', lines: filtered });
  } catch (err) {
    send(ws, { type: 'error', message: 'Failed to read audit log.', code: 'FS_ERROR' });
  }
}

export async function handleAddCredit(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const targetUserId = msg.targetUserId;
  const amount = msg.amount;
  const note = (msg.note || '').trim();

  if (targetUserId == null || isNaN(amount) || !note) {
    send(ws, { type: 'error', message: 'Missing target user, amount, or note.', code: 'INVALID_INPUT' });
    return;
  }

  try {
    await dbQuery('UPDATE pkg_user SET credit = credit + ? WHERE id = ?', [amount, targetUserId]);
    await dbQuery(
      'INSERT INTO pkg_refill (id_user, credit, description, payment, date) VALUES (?, ?, ?, ?, NOW())',
      [targetUserId, amount, `Manual: ${note}`, `Admin: ${session.username}`]
    );

    auditLog(session.username, session.role, session.ip, 'add_credit', String(targetUserId), `${amount} - ${note}`);

    const rows = await dbQuery<any>('SELECT credit FROM pkg_user WHERE id = ? LIMIT 1', [targetUserId]);
    const newBalance = rows[0]?.credit ?? 0;

    send(ws, {
      type: 'admin_broadcast' as any,
      message: `Credit adjusted: $${amount.toFixed(2)} for user #${targetUserId}. New balance: $${parseFloat(String(newBalance)).toFixed(2)}`,
      from: 'system',
    } as any);
  } catch (err) {
    console.error('[Admin] Add credit error:', err);
    send(ws, { type: 'error', message: 'Failed to add credit.', code: 'DB_ERROR' });
  }
}
