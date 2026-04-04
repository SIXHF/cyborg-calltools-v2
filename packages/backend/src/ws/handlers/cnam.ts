import type { ServerWebSocket } from 'bun';
import { lookupCnam } from '../../services/cnam';
import { auditLog } from '../../audit/logger';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

export async function handleCnamLookup(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const number = (msg.number || '').trim().replace(/[^0-9]/g, '');
  if (!number || number.length < 10) {
    send(ws, { type: 'error', message: 'Invalid phone number.', code: 'INVALID_INPUT' });
    return;
  }

  auditLog(session.username, session.role, session.ip, 'cnam_lookup', number);

  try {
    const result = await lookupCnam(number);
    send(ws, {
      type: 'cnam_result',
      number,
      name: result.name || 'Unknown',
      carrier: result.carrier,
      lineType: result.type,
      state: result.state,
      city: result.city,
    } as any);
  } catch (err) {
    console.error('[CNAM] Lookup error:', err);
    send(ws, {
      type: 'cnam_result',
      number,
      name: 'Lookup failed',
    });
  }
}
