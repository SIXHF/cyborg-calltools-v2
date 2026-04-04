import type { ServerWebSocket } from 'bun';
import { dbQuery } from '../../db/mysql';
import { getActiveChannels } from '../../ami/channels';
import { auditLog } from '../../audit/logger';
import { getActiveSessions, destroySession } from '../../auth/session';
import { readFile, writeFile } from 'fs/promises';

const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE ?? '/opt/calltools-v2-audit.log';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

const PERMISSIONS_FILE = process.env.PERMISSIONS_FILE ?? '/opt/calltools-v2-permissions.json';

export async function handleGetStats(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  try {
    const stats: Record<string, any> = {};

    // Shift window: 8pm PKT to 8am PKT
    const shiftRows = await dbQuery<any>(
      "SELECT IF(HOUR(NOW()) >= 20, CONCAT(CURDATE(), ' 20:00:00'), CONCAT(CURDATE() - INTERVAL 1 DAY, ' 20:00:00')) as shift_start"
    );
    const shiftStart = shiftRows[0]?.shift_start ?? new Date().toISOString().slice(0, 10) + ' 00:00:00';

    // Calls this shift
    const [answeredRows, failedRows] = await Promise.all([
      dbQuery<any>('SELECT COUNT(*) as cnt FROM pkg_cdr WHERE starttime >= ?', [shiftStart]),
      dbQuery<any>('SELECT COUNT(*) as cnt FROM pkg_cdr_failed WHERE starttime >= ?', [shiftStart]),
    ]);
    stats.answered = answeredRows[0]?.cnt ?? 0;
    stats.failed = failedRows[0]?.cnt ?? 0;
    stats.calls_today = stats.answered + stats.failed;

    // Active calls
    const channels = await getActiveChannels();
    const upChannels = channels.filter(c => c.state === 'Up');
    const bridgeIds = new Set(upChannels.filter(c => c.bridgeid).map(c => c.bridgeid));
    const unbridged = upChannels.filter(c => !c.bridgeid).length;
    stats.active_calls = bridgeIds.size + unbridged;

    // SIP users count
    const sipCountRows = await dbQuery<any>('SELECT COUNT(*) as cnt FROM pkg_sip');
    stats.total_sip = sipCountRows[0]?.cnt ?? 0;

    // Registered SIP count
    try {
      const proc = Bun.spawn(['/usr/sbin/asterisk', '-rx', 'sip show peers'], { stdout: 'pipe', stderr: 'pipe' });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      const lines = output.split('\n');
      stats.registered = lines.filter(l => l.includes('OK') && !l.startsWith('Name')).length;
    } catch { stats.registered = 0; }

    // ASR by trunk
    const [trunkNames, trunkAnswered, trunkFailed] = await Promise.all([
      dbQuery<any>('SELECT id, trunkcode FROM pkg_trunk'),
      dbQuery<any>('SELECT id_trunk, COUNT(*) as cnt FROM pkg_cdr WHERE starttime >= ? GROUP BY id_trunk', [shiftStart]),
      dbQuery<any>('SELECT id_trunk, COUNT(*) as cnt FROM pkg_cdr_failed WHERE starttime >= ? GROUP BY id_trunk', [shiftStart]),
    ]);
    const tnMap: Record<string, string> = {};
    for (const t of trunkNames) tnMap[String(t.id)] = t.trunkcode;
    const ansByTrunk: Record<string, number> = {};
    for (const r of trunkAnswered) ansByTrunk[String(r.id_trunk)] = r.cnt;
    const failByTrunk: Record<string, number> = {};
    for (const r of trunkFailed) failByTrunk[String(r.id_trunk)] = r.cnt;
    const allTrunkIds = new Set([...Object.keys(ansByTrunk), ...Object.keys(failByTrunk)]);
    stats.asr_by_trunk = [...allTrunkIds].map(tid => {
      const ans = ansByTrunk[tid] ?? 0;
      const fail = failByTrunk[tid] ?? 0;
      const total = ans + fail;
      return {
        trunk_id: tid,
        trunk_name: tnMap[tid] ?? `Trunk ${tid}`,
        total,
        answered: ans,
        asr: total > 0 ? Math.round((ans / total) * 1000) / 10 : 0,
      };
    });

    // Top 10 dialed numbers
    const topRows = await dbQuery<any>(
      'SELECT calledstation, COUNT(*) as cnt FROM pkg_cdr WHERE starttime >= ? GROUP BY calledstation ORDER BY cnt DESC LIMIT 10',
      [shiftStart]
    );
    stats.top_numbers = topRows.map(r => ({ number: r.calledstation, count: r.cnt }));

    // Connected users
    stats.connected_users = getActiveSessions().length;

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

    // Handle special targets
    if (target === '__access_control__') {
      // Direct update to allowed_accounts
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
    send(ws, { type: 'permissions_updated', permissions });
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

  // Support both full token and 8-char prefix
  const allSessions = getActiveSessions();
  const target = allSessions.find(s =>
    s.token === targetToken || s.token.startsWith(targetToken)
  );

  if (!target) {
    send(ws, { type: 'error', message: 'Session not found.', code: 'NOT_FOUND' });
    return;
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

  // If broadcastToAll callback is provided, use it; otherwise just acknowledge
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
    // Get all user accounts with their SIP users
    const users = await dbQuery<any>(
      'SELECT u.id, u.username, u.credit, u.id_group, u.active, ' +
      '(SELECT COUNT(*) FROM pkg_sip WHERE id_user = u.id) as sip_count ' +
      'FROM pkg_user u WHERE u.active = 1 ORDER BY u.username'
    );

    const result = users.map(u => ({
      id: u.id,
      username: u.username,
      credit: parseFloat(String(u.credit)) || 0,
      role: u.id_group === 1 ? 'admin' : 'user',
      sipCount: u.sip_count || 0,
      active: !!u.active,
    }));

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

    // Apply filters
    const actorFilter = (msg.actor || '').trim().toLowerCase();
    const actionFilter = (msg.action || '').trim().toLowerCase();

    const filtered = lines.filter(line => {
      if (actorFilter && !line.toLowerCase().includes(actorFilter)) return false;
      if (actionFilter && !line.toLowerCase().includes(actionFilter)) return false;
      return true;
    }).slice(0, 100);

    send(ws, { type: 'audit_log' as any, lines: filtered } as any);
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
  const targetUserId = parseInt(msg.targetUserId);
  const amount = parseFloat(msg.amount);
  const note = (msg.note || '').trim();

  if (!targetUserId || isNaN(amount) || !note) {
    send(ws, { type: 'error', message: 'Missing target user, amount, or note.', code: 'INVALID_INPUT' });
    return;
  }

  try {
    // Update user credit
    await dbQuery('UPDATE pkg_user SET credit = credit + ? WHERE id = ?', [amount, targetUserId]);

    // Create refill record
    await dbQuery(
      'INSERT INTO pkg_refill (id_user, credit, description, payment, date) VALUES (?, ?, ?, ?, NOW())',
      [targetUserId, amount, `Manual: ${note}`, `Admin: ${session.username}`]
    );

    auditLog(session.username, session.role, session.ip, 'add_credit', String(targetUserId), `${amount} - ${note}`);

    // Get updated balance
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
