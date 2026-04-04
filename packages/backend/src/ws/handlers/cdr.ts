import type { ServerWebSocket } from 'bun';
import { dbQuery } from '../../db/mysql';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

export async function handleGetCdr(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const page = Math.max(1, msg.page ?? 1);
  const perPage = Math.min(50, Math.max(10, msg.perPage ?? 25));
  const search = (msg.search ?? '').trim();
  const dateFrom = (msg.dateFrom ?? '').trim();
  const dateTo = (msg.dateTo ?? '').trim();
  const targetSip = msg.targetSip ?? undefined;
  const offset = (page - 1) * perPage;

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
    // Count total
    const countRows = await dbQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM pkg_cdr WHERE ${where}`,
      params
    );
    const total = countRows[0]?.cnt ?? 0;

    // Fetch CDR records
    const cdrRows = await dbQuery<any>(
      `SELECT id, starttime, src, calledstation, sessiontime, ` +
      `terminatecauseid, id_trunk, sessionbill, callerid ` +
      `FROM pkg_cdr WHERE ${where} ` +
      `ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    // Also fetch failed calls for the same criteria
    const failedRows = await dbQuery<any>(
      `SELECT id, starttime, src, calledstation, 0 as sessiontime, ` +
      `terminatecauseid, id_trunk, 0 as sessionbill, callerid ` +
      `FROM pkg_cdr_failed WHERE ${where} ` +
      `ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    // Merge and sort by starttime descending
    const allRecords = [...cdrRows, ...failedRows]
      .sort((a, b) => {
        const ta = new Date(a.starttime).getTime();
        const tb = new Date(b.starttime).getTime();
        return tb - ta;
      })
      .slice(0, perPage);

    // Format records
    const records = allRecords.map(r => ({
      id: r.id,
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
