import type { ServerWebSocket } from 'bun';
import { auditLog } from '../../audit/logger';
import { dbQuery } from '../../db/mysql';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

/** Validate caller ID: must be 11 digits starting with 1 (US/CA) or empty to clear */
function validateCallerId(cid: string): string | null {
  if (!cid) return '';
  const clean = cid.replace(/[^0-9]/g, '');
  if (clean.length === 10) return '1' + clean;
  if (clean.length === 11 && clean.startsWith('1')) return clean;
  return null;
}

/** Check if a number is toll-free */
function isTollfree(num: string): boolean {
  const prefixes = ['1800', '1833', '1844', '1855', '1866', '1877', '1888'];
  return prefixes.some(p => num.startsWith(p));
}

export async function handleGetCallerId(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const targetUser = msg.sipUser || session.sipUser || session.username;

  // Ownership check: non-admin can only read their own SIP users
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  if (session.role !== 'admin' && !sipUsers.includes(targetUser)) {
    send(ws, { type: 'error', message: 'Access denied.', code: 'FORBIDDEN' });
    return;
  }

  try {
    const rows = await dbQuery<{ callerid: string }>(
      'SELECT callerid FROM pkg_sip WHERE name = ? LIMIT 1',
      [targetUser]
    );
    const callerid = rows.length > 0 ? (rows[0].callerid || '') : '';
    send(ws, { type: 'callerid_info', sipUser: targetUser, callerid });
  } catch {
    send(ws, { type: 'error', message: 'Failed to get caller ID.', code: 'DB_ERROR' });
  }
}

export async function handleSetCallerId(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const newCallerid = (msg.callerid || '').trim();
  const targetUser = msg.sipUser || session.sipUser || session.username;

  // Validate ownership
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  if (session.role !== 'admin' && !sipUsers.includes(targetUser)) {
    send(ws, { type: 'error', message: 'Access denied for this SIP user.', code: 'FORBIDDEN' });
    return;
  }

  const validated = validateCallerId(newCallerid);
  if (validated === null) {
    send(ws, { type: 'error', message: 'Invalid caller ID. US/CA format: 11 digits starting with 1.', code: 'INVALID_INPUT' });
    return;
  }

  // Check toll-free restriction
  if (validated && isTollfree(validated) && !session.permissions.allow_tollfree_callerid) {
    send(ws, { type: 'error', message: 'Toll-free caller IDs are not allowed for this account.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'set_callerid_blocked', targetUser, `Toll-free: ${validated}`);
    return;
  }

  try {
    await dbQuery('UPDATE pkg_sip SET callerid = ? WHERE name = ?', [validated, targetUser]);
    auditLog(session.username, session.role, session.ip, 'set_callerid', targetUser, validated);
    send(ws, { type: 'callerid_updated', sipUser: targetUser, callerid: validated });
  } catch (err) {
    send(ws, { type: 'error', message: 'Failed to update caller ID.', code: 'DB_ERROR' });
  }
}
