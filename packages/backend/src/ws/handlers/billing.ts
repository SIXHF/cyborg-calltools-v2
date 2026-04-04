import type { ServerWebSocket } from 'bun';
import { dbQuery } from '../../db/mysql';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

/** Resolve user ID for a SIP user */
async function resolveUserId(sipUser: string): Promise<number | null> {
  const rows = await dbQuery<{ id_user: number }>(
    'SELECT id_user FROM pkg_sip WHERE name = ? LIMIT 1',
    [sipUser]
  );
  return rows.length > 0 ? rows[0].id_user : null;
}

export async function handleGetBalance(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  try {
    let userId: number | null = null;

    // If admin/user has a selected SIP user, show that user's balance
    const targetSip = msg.targetSip || session.selectedSipUser;
    if (targetSip && (session.role === 'admin' || session.role === 'user')) {
      userId = await resolveUserId(targetSip);
    }

    // Fall back to session's own userId
    if (!userId) {
      userId = session.userId ?? null;
    }

    if (!userId && session.sipUser) {
      userId = await resolveUserId(session.sipUser);
    }

    if (!userId) {
      send(ws, { type: 'error', message: 'Could not resolve user account.', code: 'NOT_FOUND' });
      return;
    }

    const rows = await dbQuery<{ credit: number }>(
      'SELECT credit FROM pkg_user WHERE id = ? LIMIT 1',
      [userId]
    );

    const credit = rows.length > 0 ? parseFloat(String(rows[0].credit)) || 0 : 0;

    send(ws, {
      type: 'billing_update',
      balance: credit,
      currency: 'USD',
    });
  } catch (err) {
    console.error('[Billing] Error:', err);
    send(ws, { type: 'error', message: 'Failed to get balance.', code: 'DB_ERROR' });
  }
}

export async function handleGetRefillHistory(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const page = Math.max(1, msg.page ?? 1);
  const perPage = Math.min(50, Math.max(1, msg.perPage ?? 25));
  const offset = (page - 1) * perPage;

  try {
    // V1 line 4998-5001: admin can filter by user ID via dropdown
    const targetSip = msg.targetSip || session.selectedSipUser;
    const filterUserId = msg.filterUserId;

    let whereClause = '';
    let whereParams: any[] = [];

    if (session.role === 'admin' && filterUserId) {
      // Admin filtering by specific user ID (V1: refillUserFilter dropdown)
      whereClause = 'id_user = ?';
      whereParams = [filterUserId];
    } else if (session.role === 'admin' && !targetSip) {
      // Admin with "All" selected — show ALL refills (V1: where = "1=1")
      whereClause = '1=1';
    } else {
      // Resolve specific user
      let userId: number | null = null;
      if (targetSip) {
        userId = await resolveUserId(targetSip);
      }
      if (!userId) {
        userId = session.userId ?? null;
      }
      if (!userId && session.sipUser) {
        userId = await resolveUserId(session.sipUser);
      }
      if (!userId) {
        send(ws, { type: 'error', message: 'Could not resolve user account.', code: 'NOT_FOUND' });
        return;
      }
      whereClause = 'id_user = ?';
      whereParams = [userId];
    }

    // V1: admin sees username column in refill history
    const rows = await dbQuery<any>(
      `SELECT r.id, r.date, r.credit, r.description, r.payment, r.id_user, u.username FROM pkg_refill r LEFT JOIN pkg_user u ON r.id_user = u.id WHERE ${whereClause.replace('id_user', 'r.id_user')} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      [...whereParams, perPage, offset]
    );

    const countRows = await dbQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM pkg_refill r WHERE ${whereClause.replace('id_user', 'r.id_user')}`,
      whereParams
    );

    send(ws, {
      type: 'refill_history',
      records: rows.map((r: any) => ({
        id: r.id,
        date: r.date,
        credit: parseFloat(String(r.credit)) || 0,
        description: r.description || '',
        payment: r.payment || '',
        username: r.username || '',
      })),
      total: countRows[0]?.cnt ?? 0,
      page,
      perPage,
    });
  } catch (err) {
    console.error('[Billing] Refill history error:', err);
    send(ws, { type: 'error', message: 'Failed to get refill history.', code: 'DB_ERROR' });
  }
}
