import type { ServerWebSocket } from 'bun';
import { dbQuery } from '../../db/mysql';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

export async function handleGetSipUsage(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const dateFrom = (msg.dateFrom ?? '').trim();
  const dateTo = (msg.dateTo ?? '').trim();

  // Build date conditions
  const cdrConditions: string[] = [];
  const failedConditions: string[] = [];
  const cdrParams: any[] = [];
  const failedParams: any[] = [];

  if (dateFrom) {
    const safeDate = dateFrom.replace(/[^0-9-]/g, '').slice(0, 10);
    cdrConditions.push('starttime >= ?');
    failedConditions.push('starttime >= ?');
    cdrParams.push(`${safeDate} 00:00:00`);
    failedParams.push(`${safeDate} 00:00:00`);
  } else {
    // Default to today
    cdrConditions.push('starttime >= CURDATE()');
    failedConditions.push('starttime >= CURDATE()');
  }

  if (dateTo) {
    const safeDate = dateTo.replace(/[^0-9-]/g, '').slice(0, 10);
    cdrConditions.push('starttime <= ?');
    failedConditions.push('starttime <= ?');
    cdrParams.push(`${safeDate} 23:59:59`);
    failedParams.push(`${safeDate} 23:59:59`);
  }

  // Resolve target_account to SIP users
  const targetAccount = (msg.target_account ?? '').trim();
  const targetSip = (msg.target_sip ?? '').trim();
  let filterSips: string[] | null = null;

  if (targetAccount) {
    try {
      const rows = await dbQuery<{ name: string }>(
        'SELECT s.name FROM pkg_sip s JOIN pkg_user u ON s.id_user = u.id WHERE u.username = ?',
        [targetAccount]
      );
      filterSips = rows.map(r => r.name);
    } catch {}
  } else if (targetSip) {
    filterSips = [targetSip];
  }

  // Role-based filtering + target filtering
  if (session.role === 'sip_user') {
    cdrConditions.push('src = ?');
    failedConditions.push('src = ?');
    cdrParams.push(session.sipUser);
    failedParams.push(session.sipUser);
  } else if (session.role === 'user') {
    const sipUsers = session.sipUsers ?? [];
    // Apply target filter within user's scope
    const effective = filterSips ? filterSips.filter(s => sipUsers.includes(s)) : sipUsers;
    if (effective.length > 0) {
      const placeholders = effective.map(() => '?').join(',');
      cdrConditions.push(`src IN (${placeholders})`);
      failedConditions.push(`src IN (${placeholders})`);
      cdrParams.push(...effective);
      failedParams.push(...effective);
    } else {
      cdrConditions.push('1=0');
      failedConditions.push('1=0');
    }
  } else if (session.role === 'admin') {
    // Admin: apply target filter if specified
    if (filterSips && filterSips.length > 0) {
      const placeholders = filterSips.map(() => '?').join(',');
      cdrConditions.push(`src IN (${placeholders})`);
      failedConditions.push(`src IN (${placeholders})`);
      cdrParams.push(...filterSips);
      failedParams.push(...filterSips);
    }
    // No filter = admin sees all
  }

  const cdrWhere = cdrConditions.length > 0 ? cdrConditions.join(' AND ') : '1=1';
  const failedWhere = failedConditions.length > 0 ? failedConditions.join(' AND ') : '1=1';

  try {
    const [answeredRows, failedRows] = await Promise.all([
      dbQuery<{ src: string; calls: number; seconds: number; cost: number }>(
        `SELECT src, COUNT(*) as calls, COALESCE(SUM(sessiontime), 0) as seconds, COALESCE(SUM(sessionbill), 0) as cost FROM pkg_cdr WHERE ${cdrWhere} GROUP BY src`,
        cdrParams
      ),
      dbQuery<{ src: string; calls: number }>(
        `SELECT src, COUNT(*) as calls FROM pkg_cdr_failed WHERE ${failedWhere} GROUP BY src`,
        failedParams
      ),
    ]);

    // Merge into per-SIP stats
    const sipMap = new Map<string, { answered: number; failed: number; seconds: number; cost: number }>();

    for (const row of answeredRows) {
      sipMap.set(row.src, {
        answered: Number(row.calls),
        failed: 0,
        seconds: Number(row.seconds),
        cost: Number(row.cost),
      });
    }

    for (const row of failedRows) {
      const existing = sipMap.get(row.src);
      if (existing) {
        existing.failed = Number(row.calls);
      } else {
        sipMap.set(row.src, { answered: 0, failed: Number(row.calls), seconds: 0, cost: 0 });
      }
    }

    const stats = Array.from(sipMap.entries()).map(([sipUser, data]) => ({
      sipUser,
      answered: data.answered,
      failed: data.failed,
      total: data.answered + data.failed,
      minutes: Math.round((data.seconds / 60) * 100) / 100,
      cost: Math.round(data.cost * 10000) / 10000,
      asr: data.answered + data.failed > 0
        ? Math.round((data.answered / (data.answered + data.failed)) * 100)
        : 0,
    })).sort((a, b) => b.total - a.total);

    const totals = stats.reduce(
      (acc, s) => ({
        answered: acc.answered + s.answered,
        failed: acc.failed + s.failed,
        total: acc.total + s.total,
        minutes: Math.round((acc.minutes + s.minutes) * 100) / 100,
        cost: Math.round((acc.cost + s.cost) * 10000) / 10000,
      }),
      { answered: 0, failed: 0, total: 0, minutes: 0, cost: 0 }
    );

    // Hourly distribution
    const hourlyRows = await dbQuery<{ hr: number; cnt: number }>(
      `SELECT HOUR(starttime) as hr, COUNT(*) as cnt FROM pkg_cdr WHERE ${cdrWhere} GROUP BY HOUR(starttime) ORDER BY hr`,
      [...cdrParams]
    );
    const hourly: number[] = new Array(24).fill(0);
    for (const row of hourlyRows) {
      const hr = Number(row.hr);
      if (hr >= 0 && hr < 24) hourly[hr] = Number(row.cnt || 0);
    }

    // Top destinations
    const topDestRows = await dbQuery<{ calledstation: string; cnt: number; dur: number; cost: number }>(
      `SELECT calledstation, COUNT(*) as cnt, SUM(sessiontime) as dur, SUM(sessionbill) as cost FROM pkg_cdr WHERE ${cdrWhere} GROUP BY calledstation ORDER BY cnt DESC LIMIT 10`,
      [...cdrParams]
    );
    const topDestinations = topDestRows.map(row => ({
      number: row.calledstation,
      calls: Number(row.cnt || 0),
      seconds: Number(row.dur || 0),
      cost: Math.round(Number(row.cost || 0) * 1000000) / 1000000,
    }));

    // Map to frontend-expected format
    const sipUsage = stats.map(s => ({
      sip_user: s.sipUser,
      total_calls: s.total,
      answered: s.answered,
      failed: s.failed,
      total_seconds: Math.round(s.minutes * 60),
      cost: s.cost,
      success_rate: s.asr,
    }));
    const sipTotals = {
      total_calls: totals.total,
      answered: totals.answered,
      failed: totals.failed,
      total_seconds: Math.round(totals.minutes * 60),
      total_cost: totals.cost,
    };
    send(ws, {
      type: 'sip_usage_data',
      sip_usage: sipUsage,
      totals: sipTotals,
      hourly,
      top_destinations: topDestinations,
      shift_start: dateFrom || new Date().toISOString().slice(0, 10),
      timestamp: Date.now() / 1000,
    } as any);
  } catch (err) {
    console.error('[SIP Usage] Query error:', err);
    send(ws, { type: 'error', message: 'Failed to fetch SIP usage.', code: 'DB_ERROR' });
  }
}

export async function handleGetCdr(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const page = Math.max(1, msg.page ?? 1);
  const perPage = Math.min(50, Math.max(1, msg.perPage ?? 25));
  const search = (msg.search ?? '').trim();
  const dateFrom = (msg.dateFrom ?? '').trim();
  const dateTo = (msg.dateTo ?? '').trim();
  const targetSip = msg.targetSip || session.selectedSipUser || undefined;
  const targetAccount = msg.targetAccount || session.selectedAccount || undefined;
  const offset = (page - 1) * perPage;

  // Resolve account to SIP users if needed
  let accountSipUsers: string[] = [];
  if (targetAccount) {
    try {
      const rows = await dbQuery<{ name: string }>(
        'SELECT s.name FROM pkg_sip s JOIN pkg_user u ON s.id_user = u.id WHERE u.username = ?',
        [targetAccount]
      );
      accountSipUsers = rows.map(r => r.name);
    } catch {}
  }

  // Build WHERE clause using parameterized queries
  const conditions: string[] = [];
  const params: any[] = [];

  // Role-based filtering
  if (session.role === 'sip_user') {
    conditions.push('(src = ? OR calledstation LIKE ?)');
    params.push(session.sipUser, `%${session.sipUser}%`);
  } else if (session.role === 'user') {
    const sipUsers = session.sipUsers ?? [];
    if (targetSip && sipUsers.includes(targetSip)) {
      conditions.push('(src = ? OR calledstation LIKE ?)');
      params.push(targetSip, `%${targetSip}%`);
    } else if (sipUsers.length > 0) {
      const placeholders = sipUsers.map(() => 'src = ?').join(' OR ');
      conditions.push(`(${placeholders})`);
      params.push(...sipUsers);
    } else {
      conditions.push('1=0');
    }
  } else if (session.role === 'admin') {
    if (targetSip) {
      conditions.push('(src = ? OR calledstation LIKE ?)');
      params.push(targetSip, `%${targetSip}%`);
    } else if (accountSipUsers.length > 0) {
      const placeholders = accountSipUsers.map(() => 'src = ?').join(' OR ');
      conditions.push(`(${placeholders})`);
      params.push(...accountSipUsers);
    }
    // Admin with no filter sees all
  }

  // Search filter
  if (search) {
    const cleanSearch = search.replace(/[^0-9a-zA-Z]/g, '');
    if (cleanSearch) {
      conditions.push('(calledstation LIKE ? OR src LIKE ? OR callerid LIKE ?)');
      params.push(`%${cleanSearch}%`, `%${cleanSearch}%`, `%${cleanSearch}%`);
    }
  }

  // Date filters
  if (dateFrom) {
    const safeDate = dateFrom.replace(/[^0-9-]/g, '').slice(0, 10);
    conditions.push('starttime >= ?');
    params.push(`${safeDate} 00:00:00`);
  }
  if (dateTo) {
    const safeDate = dateTo.replace(/[^0-9-]/g, '').slice(0, 10);
    conditions.push('starttime <= ?');
    params.push(`${safeDate} 23:59:59`);
  }

  const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

  try {
    // Count total from BOTH tables (Bug 4.1 fix)
    const [countCdr, countFailed] = await Promise.all([
      dbQuery<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM pkg_cdr WHERE ${where}`, params),
      dbQuery<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM pkg_cdr_failed WHERE ${where}`, params),
    ]);
    const total = (countCdr[0]?.cnt ?? 0) + (countFailed[0]?.cnt ?? 0);

    // Fetch more than needed from both tables for proper merge pagination (V1 approach)
    const fetchLimit = perPage + offset;
    const [cdrRows, failedRows] = await Promise.all([
      dbQuery<any>(
        `SELECT id, starttime, src, calledstation, sessiontime, ` +
        `terminatecauseid, id_trunk, sessionbill, callerid ` +
        `FROM pkg_cdr WHERE ${where} ` +
        `ORDER BY starttime DESC LIMIT ?`,
        [...params, fetchLimit]
      ),
      dbQuery<any>(
        `SELECT id, starttime, src, calledstation, 0 as sessiontime, ` +
        `terminatecauseid, id_trunk, 0 as sessionbill, callerid ` +
        `FROM pkg_cdr_failed WHERE ${where} ` +
        `ORDER BY starttime DESC LIMIT ?`,
        [...params, fetchLimit]
      ),
    ]);

    // Merge, sort, then apply offset+limit in code (V1 approach for correct pagination)
    const allRecords = [
      ...cdrRows.map((r: any) => ({ ...r, _source: 'cdr' })),
      ...failedRows.map((r: any) => ({ ...r, _source: 'failed' })),
    ]
      .sort((a, b) => {
        const ta = new Date(a.starttime).getTime();
        const tb = new Date(b.starttime).getTime();
        return tb - ta;
      })
      .slice(offset, offset + perPage);

    // Format records with unique IDs (Bug 4.3 fix)
    const records = allRecords.map(r => ({
      id: `${r._source}-${r.id}`,
      startTime: r.starttime,
      src: r.src,
      destination: r.calledstation,
      duration: r.sessiontime || 0,
      status: r.terminatecauseid === 1 ? 'answered' :
              r.terminatecauseid === 2 ? 'busy' :
              r.terminatecauseid === 3 ? 'noanswer' : 'failed',
      cost: parseFloat(r.sessionbill) || 0,
      callerid: r.callerid || '',
      trunkId: r.id_trunk,
    }));

    send(ws, { type: 'cdr_result', records, total, page, perPage });
  } catch (err) {
    console.error('[CDR] Query error:', err);
    send(ws, { type: 'error', message: 'Failed to fetch CDR.', code: 'DB_ERROR' });
  }
}
