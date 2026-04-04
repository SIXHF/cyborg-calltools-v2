import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useChannelStore } from '../stores/channelStore';
import { useTranscriptStore } from '../stores/transcriptStore';
import { useUiStore } from '../stores/uiStore';
import type { ServerMessage } from '@calltools/shared';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'wss://sip.osetec.net:8766';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

let wsInstance: WebSocket | null = null;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const pingTimer = useRef<ReturnType<typeof setInterval>>();

  const auth = useAuthStore();
  const channels = useChannelStore();
  const transcript = useTranscriptStore();
  const ui = useUiStore();

  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      console.error('[WS] Invalid JSON:', event.data);
      return;
    }

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
        // Heartbeat response
        break;

      default:
        ui.addLogEntry(`Unhandled message: ${(msg as any).type}`);
    }
  }, [auth, channels, transcript, ui]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    wsInstance = ws;

    ws.onopen = () => {
      reconnectAttempt.current = 0;
      ui.setWsConnected(true);
      ui.addLogEntry('Connected to server.');

      // Try to resume session
      const token = sessionStorage.getItem('ct2_session_token');
      if (token) {
        ws.send(JSON.stringify({ cmd: 'resume', token }));
      }

      // Start ping
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ cmd: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      ui.setWsConnected(false);
      ui.addLogEntry('Disconnected.');
      if (pingTimer.current) clearInterval(pingTimer.current);

      // Exponential backoff reconnect
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt.current),
        RECONNECT_MAX_MS
      );
      reconnectAttempt.current++;
      ui.addLogEntry(`Reconnecting in ${(delay / 1000).toFixed(1)}s...`);
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // Error triggers close, handled there
    };
  }, [handleMessage, ui]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}

/** Send a message to the WebSocket server */
export function wsSend(msg: Record<string, unknown>) {
  if (wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify(msg));
  }
}
