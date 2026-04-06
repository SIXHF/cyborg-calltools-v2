import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useChannelStore } from '../stores/channelStore';
import { useTranscriptStore } from '../stores/transcriptStore';
import { useUiStore } from '../stores/uiStore';
import type { ServerMessage } from '@calltools/shared';
import { notifDtmfBeep, notifCallConnect, notifCallHangup, notifBroadcast, getNotifSettings } from '../utils/audio';

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
      // V1: request notification permission on login
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
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
      // V1: play call connect sound (600Hz + 900Hz)
      { const ns = getNotifSettings(); if (ns.callEvents) notifCallConnect(); }
      break;

    case 'dtmf_digit':
      ui.addLogEntry(`DTMF [${msg.channel}]: ${msg.digit} (${msg.direction})`);
      // V1: play DTMF beep (1200Hz)
      { const ns = getNotifSettings(); if (ns.dtmfSound) notifDtmfBeep(); }
      break;

    case 'dtmf_done':
      ui.addLogEntry(`DTMF capture ended for ${msg.channel}`);
      // V1: play call hangup sound (500Hz + 350Hz)
      { const ns = getNotifSettings(); if (ns.callEvents) notifCallHangup(); }
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

    case 'call_originated':
      ui.addToast(`Calling ${(msg as any).destination}`, 'success', 3000);
      ui.addLogEntry(`Call originated: ${(msg as any).sipUser} → ${(msg as any).destination}`);
      break;

    case 'transfer_initiated':
      ui.addToast('Transfer initiated', 'success', 3000);
      ui.addLogEntry(`Transfer: ${(msg as any).channel} → ${(msg as any).destination} (${(msg as any).transfer_type || 'blind'})`);
      break;

    case 'callerid_updated':
      ui.addToast('Caller ID updated', 'success', 3000);
      ui.addLogEntry(`Caller ID set to: ${(msg as any).callerid || '(cleared)'}`);
      break;

    case 'permissions_updated':
      auth.updatePermissions(msg.permissions);
      ui.addToast('Permissions saved', 'success', 2000);
      break;

    case 'global_settings_updated':
      ui.addToast('Global setting saved', 'success', 2000);
      ui.addLogEntry(`Global setting: ${(msg as any).key} = ${(msg as any).value}`);
      break;

    case 'audio_uploaded':
      ui.addToast(`Audio uploaded: ${(msg as any).name}`, 'success', 3000);
      ui.addLogEntry(`Audio uploaded: ${(msg as any).name}`);
      break;

    case 'audio_playing':
      ui.addLogEntry(`Playing audio: ${(msg as any).file || (msg as any).filename}`);
      break;

    case 'audio_stopped':
      ui.addLogEntry('Audio playback stopped');
      break;

    case 'moh_updated':
      ui.addToast((msg as any).using_default ? 'Hold music set to default' : 'Hold music updated', 'success', 3000);
      ui.addLogEntry('Hold music ' + ((msg as any).using_default ? 'reverted to default' : 'updated'));
      break;

    case 'audio_deleted':
      ui.addLogEntry(`Audio deleted: ${(msg as any).name}`);
      break;

    case 'cnam_result':
      ui.addLogEntry(`CNAM: ${(msg as any).name || '?'} / ${(msg as any).carrier || '?'}`);
      break;

    case 'access_updated':
      ui.addToast(`Access ${(msg as any).enabled ? 'enabled' : 'disabled'} for ${(msg as any).username}`, 'success', 3000);
      ui.addLogEntry(`Access ${(msg as any).enabled ? 'enabled' : 'disabled'} for ${(msg as any).username}`);
      break;

    case 'audio_approved':
      ui.addToast('Audio file approved', 'success', 3000);
      ui.addLogEntry(`Audio approved: ${(msg as any).name}`);
      break;

    case 'audio_rejected':
      ui.addLogEntry(`Audio rejected: ${(msg as any).name}`);
      break;

    case 'force_logout_ok':
      ui.addToast(`User ${(msg as any).username || ''} disconnected`, 'success', 3000);
      ui.addLogEntry(`Force logout: ${(msg as any).username || '?'}`);
      break;

    case 'ip_restrictions_updated':
      ui.addToast(`IP restrictions updated for ${(msg as any).targetName}`, 'success', 3000);
      ui.addLogEntry(`IP restrictions updated: ${(msg as any).targetType}/${(msg as any).targetName}`);
      break;

    case 'rate_limit_cleared':
      ui.addToast((msg as any).clear_all ? 'All rate limits cleared' : 'Rate limit cleared', 'success', 3000);
      ui.addLogEntry(`Rate limit cleared: ${(msg as any).rate_key || 'all'}`);
      break;

    case 'rate_whitelist_updated':
      ui.addToast('Rate limit whitelist updated', 'success', 3000);
      break;

    case 'permissions_refreshed':
      auth.updatePermissions((msg as any).permissions || {});
      ui.addToast('Permissions refreshed', 'success', 2000);
      ui.addLogEntry('Permissions refreshed by admin');
      break;

    case 'broadcast_sent':
      ui.addToast(`Broadcast sent to ${(msg as any).recipients} user(s)`, 'success', 3000);
      ui.addLogEntry(`Broadcast sent to ${(msg as any).target} (${(msg as any).recipients} recipients)`);
      break;

    case 'admin_broadcast': {
      // V1 parity: colored toast, sound, desktop notification
      const bcMsg = msg as any;

      // Colored toast — pass color through toast system
      ui.addToast(`Admin: ${bcMsg.message}`, 'broadcast', 6000, bcMsg.color || 'orange');

      // Sound: two-tone beep (V1: 800Hz then 1000Hz)
      notifBroadcast();

      // Desktop notification (V1 parity)
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Admin Broadcast', { body: bcMsg.message, tag: 'admin-broadcast-' + Date.now() });
        }
      } catch {}

      ui.addLogEntry(`Broadcast from ${bcMsg.from}: ${bcMsg.message}`);
      break;
    }

    case 'admin_billing_alert': {
      // V1 line 5209-5224: admin sees payment/invoice alerts from users
      const alert = msg as any;
      if (auth.role === 'admin') {
        if (alert.event === 'payment_received') {
          ui.addToast(`${alert.username} payment received: +$${parseFloat(alert.amount).toFixed(2)}`, 'success', 5000);
          ui.addLogEntry(`Billing: ${alert.username} payment +$${parseFloat(alert.amount).toFixed(2)} (balance: $${parseFloat(alert.new_balance).toFixed(2)})`);
        } else if (alert.event === 'invoice_created') {
          ui.addToast(`${alert.username} created $${parseFloat(alert.amount).toFixed(2)} invoice`, 'success', 3000);
          ui.addLogEntry(`Billing: ${alert.username} created $${parseFloat(alert.amount).toFixed(2)} invoice`);
        }
        // V1 line 5217-5222: refresh billing data if admin is on billing tab
        if (alert.event === 'payment_received') {
          // Dispatch so BillingTab can refresh
          window.dispatchEvent(new CustomEvent('admin-billing-refresh'));
        }
      }
      break;
    }

    case 'error':
      // Don't show "Admin access required" errors to non-admin users (normal for user role)
      if ((msg as any).code === 'FORBIDDEN' || msg.message === 'Admin access required.') {
        ui.addLogEntry(`Error: ${msg.message}`);
      } else {
        ui.addToast(msg.message, 'error');
        ui.addLogEntry(`Error: ${msg.message}`);
      }
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
