import type { ServerWebSocket } from 'bun';
import { getAmiClient } from '../../ami/client';
import { auditLog } from '../../audit/logger';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

export async function handleOriginateCall(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const destination = (msg.destination || '').trim().replace(/[^0-9]/g, '');
  const targetSip = msg.sipUser || session.sipUser || session.username;

  if (!destination) {
    send(ws, { type: 'error', message: 'No destination specified.', code: 'INVALID_INPUT' });
    return;
  }

  // Validate ownership
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  if (session.role !== 'admin' && !sipUsers.includes(targetSip)) {
    send(ws, { type: 'error', message: 'Access denied for this SIP user.', code: 'FORBIDDEN' });
    return;
  }

  const ami = getAmiClient();
  if (!ami) {
    send(ws, { type: 'error', message: 'AMI not connected.', code: 'SERVICE_UNAVAILABLE' });
    return;
  }

  try {
    ami.sendAction('Originate', {
      Channel: `SIP/${targetSip}`,
      Context: 'billing',
      Exten: destination,
      Priority: '1',
      CallerID: destination,
      Timeout: '30000',
      Async: 'yes',
    });

    auditLog(session.username, session.role, session.ip, 'originate_call', targetSip, destination);
    send(ws, { type: 'call_originated', sipUser: targetSip, destination });
  } catch (err) {
    send(ws, { type: 'error', message: `Failed to originate call: ${err}`, code: 'AMI_ERROR' });
  }
}
