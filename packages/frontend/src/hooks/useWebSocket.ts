import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useChannelStore } from '../stores/channelStore';
import { useTranscriptStore } from '../stores/transcriptStore';
import { useUiStore } from '../stores/uiStore';
import type { ServerMessage } from '@calltools/shared';

const WS_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_WS_URL) || 'wss://sip.osetec.net/beta-ws/';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

let wsInstance: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;

function handleMessage(event: MessageEvent) {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(event.data);
  } catch {
    console.error('[WS] Invalid JSON:', event.data);
    return;
  }

  const auth = useAuthStore.getState();
  const channels = useChannelStore.getState();
  const transcript = useTranscriptStore.getState();
  const ui = useUiStore.getState();

  switch (msg.type) {
    case 'auth_ok':
      auth.login({
        token: msg.token,
        username: msg.username,
        role: msg.role as any,
        version: msg.version,
        permissions: msg.permissions,
        sipUsers: msg.sipUsers,
      });
      ui.addLogEntry('Authenticated successfully.');
      ui.addToast('Logged in!', 'success', 2000);
      // Request initial channel list
      wsSend({ cmd: 'get_channels' });
      break;

    case 'auth_error':
      ui.addToast(msg.message, 'error', 5000);
      ui.addLogEntry(`Auth error: ${msg.message}`);
      break;

    case 'resume_ok':
      auth.resume({ username: msg.username, role: msg.role as any });
      ui.addLogEntry('Session resumed.');
      // Request channels on resume
      wsSend({ cmd: 'get_channels' });
      break;

    case 'resume_failed':
      auth.logout();
      ui.addToast('Session expired. Please log in again.', 'error');
      break;

    case 'channel_update':
      channels.setChannels(msg.channels as any);
      break;

    case 'dtmf_digit':
      ui.addLogEntry(`DTMF [${msg.channel}]: ${msg.digit} (${msg.direction})`);
      break;

    case 'transcript_start':
      transcript.setActive(true);
      ui.addLogEntry(`Transcript started for ${msg.channel}`);
      break;

    case 'transcript_update':
      if (msg.isFinal) {
        transcript.addSegment({
          speaker: msg.speaker as 'caller' | 'callee',
          text: msg.text,
          timestamp: Date.now(),
          isFinal: true,
        });
      } else {
        transcript.updatePartial(msg.speaker as 'caller' | 'callee', msg.text);
      }
      break;

    case 'transcript_done':
      transcript.setActive(false);
      ui.addLogEntry(`Transcript ended for ${msg.channel}`);
      break;

    case 'callerid_updated':
      ui.addToast(`Caller ID updated: ${(msg as any).callerid || 'cleared'}`, 'success');
      ui.addLogEntry(`Caller ID for ${(msg as any).sipUser} set to ${(msg as any).callerid || '(cleared)'}`);
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
      break;

    case 'call_originated':
      ui.addToast(`Call originated to ${(msg as any).destination}`, 'success');
      ui.addLogEntry(`Call originated: ${(msg as any).sipUser} → ${(msg as any).destination}`);
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
      break;

    case 'cnam_result':
      ui.addLogEntry(`CNAM: ${(msg as any).number} → ${(msg as any).name}${(msg as any).carrier ? ` (${(msg as any).carrier})` : ''}`);
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
      break;

    case 'cdr_result':
    case 'stats_result':
    case 'billing_update':
    case 'refill_history':
    case 'users_overview':
    case 'online_users':
    case 'permissions_data':
    case 'audit_log':
    case 'transfer_initiated':
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
      break;

    // Payment messages
    case 'payment_created':
      ui.addLogEntry(`Payment invoice created`);
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
      break;

    case 'permissions_updated':
      auth.updatePermissions(msg.permissions);
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
      break;

    case 'admin_broadcast':
      ui.addToast(`[${msg.from}] ${msg.message}`, 'info', 10000);
      ui.addLogEntry(`Broadcast from ${msg.from}: ${msg.message}`);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`CallTools: ${msg.from}`, { body: msg.message });
      }
      break;

    case 'error':
      ui.addToast(msg.message, 'error');
      ui.addLogEntry(`Error: ${msg.message}`);
      // Dispatch to components so they can react to errors (Bug 13 fix)
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
      break;

    case 'pong':
      break;

    default:
      // Dispatch unknown types to components too (future-proofing)
      ui.addLogEntry(`Message: ${(msg as any).type}`);
      window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
  }
}

function connect() {
  if (wsInstance?.readyState === WebSocket.OPEN || wsInstance?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const ui = useUiStore.getState();
  const ws = new WebSocket(WS_URL);
  wsInstance = ws;

  ws.onopen = () => {
    reconnectAttempt = 0;
    ui.setWsConnected(true);
    ui.addLogEntry('Connected to server.');

    const token = sessionStorage.getItem('ct2_session_token');
    if (token) {
      ws.send(JSON.stringify({ cmd: 'resume', token }));
    }

    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cmd: 'ping' }));
      }
    }, PING_INTERVAL_MS);
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    ui.setWsConnected(false);
    ui.addLogEntry('Disconnected.');
    if (pingTimer) clearInterval(pingTimer);

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
      RECONNECT_MAX_MS
    );
    reconnectAttempt++;
    ui.addLogEntry(`Reconnecting in ${(delay / 1000).toFixed(1)}s...`);
    reconnectTimer = setTimeout(connect, delay);
  };

  ws.onerror = () => {};
}

/** Hook to start the WebSocket connection once */
export function useWebSocket() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      wsInstance?.close();
      wsInstance = null;
      started.current = false;
    };
  }, []);
}

/** Send a message to the WebSocket server */
export function wsSend(msg: Record<string, unknown>) {
  if (wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify(msg));
  } else {
    console.warn('[WS] Cannot send, not connected. readyState:', wsInstance?.readyState);
  }
}
