import type { ServerWebSocket } from 'bun';
import { getAmiClient } from '../../ami/client';
import { getActiveChannels } from '../../ami/channels';
import { auditLog } from '../../audit/logger';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

export async function handleTransferCall(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const channel = (msg.channel || '').trim();
  const destination = (msg.destination || '').trim().replace(/[^0-9*#+]/g, '');
  const transferType = msg.transferType === 'attended' ? 'attended' : 'blind';

  if (!channel || !destination) {
    send(ws, { type: 'error', message: 'Missing channel or destination.', code: 'INVALID_INPUT' });
    return;
  }

  // Validate ownership
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  const peer = channel.split('/')[1]?.replace(/-[^-]+$/, '') ?? '';
  if (session.role !== 'admin' && !sipUsers.includes(peer)) {
    send(ws, { type: 'error', message: 'Access denied for this channel.', code: 'FORBIDDEN' });
    return;
  }

  // Resolve bridge and find callee channel
  const channels = await getActiveChannels();
  let bridge = '';
  for (const ch of channels) {
    if (ch.channel === channel) {
      bridge = ch.bridgeid;
      break;
    }
  }

  if (!bridge) {
    send(ws, { type: 'error', message: 'Channel is not in a bridge (not connected).', code: 'NOT_BRIDGED' });
    return;
  }

  // Find the other party in the bridge
  let calleeChannel = '';
  for (const ch of channels) {
    if (ch.channel !== channel && ch.bridgeid === bridge) {
      calleeChannel = ch.channel;
      break;
    }
  }

  if (!calleeChannel) {
    send(ws, { type: 'error', message: 'Could not find the other party in the call.', code: 'NO_CALLEE' });
    return;
  }

  const ami = getAmiClient();
  if (!ami) {
    send(ws, { type: 'error', message: 'AMI not connected.', code: 'SERVICE_UNAVAILABLE' });
    return;
  }

  try {
    if (transferType === 'blind') {
      // Blind transfer: redirect the callee to the new destination
      ami.sendAction('Redirect', {
        Channel: calleeChannel,
        Exten: destination,
        Context: 'billing',
        Priority: '1',
      });
    } else {
      // Attended transfer: initiate attended transfer from user's channel
      ami.sendAction('Atxfer', {
        Channel: channel,
        Exten: destination,
        Context: 'billing',
      });
    }

    auditLog(session.username, session.role, session.ip, 'transfer_call', channel, `${transferType}:${destination}`);
    send(ws, {
      type: 'transfer_initiated' as any,
      channel,
      destination,
      transferType,
    } as any);
  } catch (err) {
    send(ws, { type: 'error', message: `Transfer failed: ${err}`, code: 'AMI_ERROR' });
  }
}
