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

  // Dispatch ALL messages to 'ws-message' CustomEvent so useWsMessage hook works
  window.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));

  switch (msg.type) {
    case 'auth_ok':
      auth.login({
        token: msg.token,
        username: msg.username,
        role: msg.role as any,
        version: msg.version,
        permissions: msg.permissions,
        sipUsers: msg.sipUsers,
        sipGroups: (msg as any).sipGroups,
      });
      ui.addLogEntry('Authenticated successfully.');
      ui.addToast('Logged in!', 'success', 2000);
      break;

    case 'auth_error':
      ui.addToast(msg.message, 'error', 5000);
      ui.addLogEntry(`Auth error: ${msg.message}`);
      break;

    case 'resume_ok':
      auth.resume({ username: msg.username, role: msg.role as any });
      ui.addLogEntry('Session resumed.');
      break;

    case 'resume_failed':
      auth.logout();
      ui.addToast('Session expired. Please log in again.', 'error');
      break;

    case 'channel_update':
      channels.setChannels(msg.channels as any);
      break;

    case 'cnam_update':
      channels.setCnamMap((msg as any).cnam_map ?? {});
      if ((msg as any).cost_map) channels.setCostMap((msg as any).cost_map);
      break;

    case 'dtmf_start':
      ui.addLogEntry(`DTMF capture started for ${msg.channel}`);
      window.dispatchEvent(new CustomEvent('dtmf_start', { detail: msg }));
      break;

    case 'dtmf_digit':
      ui.addLogEntry(`DTMF [${msg.channel}]: ${msg.digit} (${msg.direction})`);
      break;

    case 'dtmf_done':
      ui.addLogEntry(`DTMF capture ended for ${msg.channel}`);
      break;

    case 'transcript_start':
      transcript.setActive(true);
      transcript.setChannel(msg.channel);
      ui.addLogEntry(`Transcript started for ${msg.channel}`);
      window.dispatchEvent(new CustomEvent('transcript_start', { detail: { channel: msg.channel } }));
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
      window.dispatchEvent(new CustomEvent('transcript_done', { detail: { channel: msg.channel } }));
      break;

    case 'sip_usage_data':
      window.dispatchEvent(new CustomEvent('sip_usage_data', { detail: msg }));
      break;

    case 'sip_user_switched':
      auth.updatePermissions((msg as any).permissions);
      ui.addLogEntry(`Switched to SIP: ${(msg as any).sipUser || 'All'}`);
      break;

    case 'permissions_updated':
      auth.updatePermissions(msg.permissions);
      break;

    case 'admin_broadcast':
      ui.addToast(`[${msg.from}] ${msg.message}`, 'info', 10000);
      break;

    case 'error':
      ui.addToast(msg.message, 'error');
      ui.addLogEntry(`Error: ${msg.message}`);
      break;

    case 'pong':
      break;

    default:
      // All messages are dispatched via ws-message CustomEvent above
      break;
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
