import type { ServerWebSocket } from 'bun';
import { getAmiClient, type AmiEvent } from '../../ami/client';
import { getActiveChannels } from '../../ami/channels';
import { auditLog } from '../../audit/logger';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

/**
 * Per-client DTMF monitoring state.
 * Maps token -> monitoring info.
 */
interface MonitorState {
  ws: ServerWebSocket<any>;
  send: SendFn;
  username: string;
  role: string;
  sipUser?: string;
  sipUsers: string[];
  monitoredChannel?: string;
  monitoredBridge?: string;
  digits: string[];
}

const monitors = new Map<string, MonitorState>();
let amiListenerAttached = false;

/**
 * Extract SIP peer name from channel string.
 * e.g. "SIP/nathan-000245fe" → "nathan"
 */
function extractPeer(channel: string): string {
  const parts = channel.split('/');
  if (parts.length >= 2) return parts[1].replace(/-[^-]+$/, '');
  return channel;
}

/**
 * Check if a monitoring client should receive DTMF from this channel.
 * Key rule from V1: skip DTMF on the user's OWN SIP extension (capture only remote/called-party DTMF).
 */
function shouldReceiveDtmf(monitor: MonitorState, dtmfChannel: string, dtmfBridge: string): boolean {
  // Skip DTMF from the user's own SIP extension
  const peer = extractPeer(dtmfChannel);
  const userSips = monitor.sipUsers.length > 0 ? monitor.sipUsers : (monitor.sipUser ? [monitor.sipUser] : []);
  for (const sip of userSips) {
    if (peer === sip) return false;
  }

  // If monitoring a specific bridge, only match that bridge
  if (monitor.monitoredBridge) {
    return dtmfBridge === monitor.monitoredBridge;
  }

  // If monitoring a specific channel but no bridge was resolved, match channel directly
  if (monitor.monitoredChannel) {
    return dtmfChannel === monitor.monitoredChannel || (dtmfBridge && dtmfBridge === monitor.monitoredBridge);
  }

  // Admin monitoring all — match any bridge that has their user's channels
  if (monitor.role === 'admin') return true;

  return false;
}

/**
 * Dispatch a DTMFEnd event to all relevant monitoring clients.
 */
async function dispatchDtmf(evt: AmiEvent) {
  // Only process DTMFEnd with Direction=Received and duration >= 40ms
  if (evt.event !== 'DTMFEnd') return;
  if (evt.direction !== 'Received') return;
  const duration = parseInt(evt.duration || '0');
  if (duration < 40) return;

  const digit = evt.digit;
  const channel = evt.channel || '';
  if (!digit || !channel) return;

  // Resolve bridge for this channel
  const channels = await getActiveChannels(true); // use cache
  let bridge = '';
  for (const ch of channels) {
    if (ch.channel === channel) {
      bridge = ch.bridgeid;
      break;
    }
  }

  // Dispatch to matching monitors
  for (const [token, monitor] of monitors) {
    if (shouldReceiveDtmf(monitor, channel, bridge)) {
      monitor.digits.push(digit);
      // Cap at 500 digits
      if (monitor.digits.length > 500) monitor.digits.shift();

      try {
        monitor.send(monitor.ws, {
          type: 'dtmf_digit',
          channel,
          digit,
          direction: 'remote',
          durationMs: duration,
        } as any);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }
}

/**
 * Attach the AMI DTMF event listener (once).
 */
function ensureAmiListener() {
  if (amiListenerAttached) return;
  const ami = getAmiClient();
  if (!ami) return;

  ami.on('ami_event', (evt: AmiEvent) => {
    if (evt.event === 'DTMFEnd') {
      dispatchDtmf(evt).catch(err => console.error('[DTMF] dispatch error:', err));
    }

    // Clean up monitors when monitored channel hangs up
    if (evt.event === 'Hangup' && evt.channel) {
      for (const [token, monitor] of monitors) {
        if (monitor.monitoredChannel === evt.channel) {
          try {
            monitor.send(monitor.ws, { type: 'dtmf_done', channel: evt.channel });
          } catch {}
          monitors.delete(token);
        }
      }
    }
  });

  amiListenerAttached = true;
  console.log('[DTMF] AMI event listener attached');
}

export async function handleStartListening(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  ensureAmiListener();

  const requestedChannel = (msg.channel || '').trim();

  // Resolve bridge for the requested channel
  let monitoredBridge = '';
  if (requestedChannel) {
    const channels = await getActiveChannels();
    for (const ch of channels) {
      if (ch.channel === requestedChannel && ch.bridgeid) {
        monitoredBridge = ch.bridgeid;
        break;
      }
    }
  }

  // Register monitor
  monitors.set(session.token, {
    ws,
    send,
    username: session.username,
    role: session.role,
    sipUser: session.sipUser,
    sipUsers: session.sipUsers ?? [],
    monitoredChannel: requestedChannel || undefined,
    monitoredBridge: monitoredBridge || undefined,
    digits: [],
  });

  auditLog(session.username, session.role, session.ip, 'start_listening', requestedChannel);
  send(ws, { type: 'dtmf_start', channel: requestedChannel, sipUser: session.sipUser ?? session.username });
}

export async function handleStopListening(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const monitor = monitors.get(session.token);
  const channel = monitor?.monitoredChannel || msg.channel || '';

  monitors.delete(session.token);
  auditLog(session.username, session.role, session.ip, 'stop_listening', channel);
  send(ws, { type: 'dtmf_done', channel });
}

/**
 * Clean up monitors for disconnected clients.
 */
export function cleanupMonitor(token: string) {
  monitors.delete(token);
}
