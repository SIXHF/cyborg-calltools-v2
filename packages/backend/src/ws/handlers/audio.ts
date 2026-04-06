import type { ServerWebSocket } from 'bun';
import { readdir, stat, unlink, writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { getAmiClient } from '../../ami/client';
import { getActiveChannels, type RawChannel } from '../../ami/channels';
import { auditLog } from '../../audit/logger';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

const AUDIO_DIR = '/opt/calltools-audio';
const AUDIO_PENDING_DIR = '/opt/calltools-audio/pending';
const AUDIO_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const AUDIO_ALLOWED_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
const PERMISSIONS_FILE = process.env.PERMISSIONS_FILE ?? '/opt/calltools-v2-permissions.json';

// Per-client audio playback state
interface AudioPlaybackState {
  playing: boolean;
  file: string | null;
  calleeChannel: string | null;
}

const audioPlaybackMap = new Map<ServerWebSocket<any>, AudioPlaybackState>();

function getPlaybackState(ws: ServerWebSocket<any>): AudioPlaybackState {
  let state = audioPlaybackMap.get(ws);
  if (!state) {
    state = { playing: false, file: null, calleeChannel: null };
    audioPlaybackMap.set(ws, state);
  }
  return state;
}

export function cleanupAudioState(ws: ServerWebSocket<any>): void {
  audioPlaybackMap.delete(ws);
}

// --- Helpers ---

function sanitizeAudioFilename(name: string): string {
  let stem = name.replace(/\.[^/.]+$/, ''); // remove extension
  stem = stem.replace(/[^a-zA-Z0-9_-]/g, '_');
  stem = stem.replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!stem) stem = `audio_${Math.floor(Date.now() / 1000)}`;
  return stem;
}

async function loadPermissionsFile(): Promise<any> {
  try {
    const raw = await readFile(PERMISSIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function savePermissionsFile(config: any): Promise<void> {
  await writeFile(PERMISSIONS_FILE, JSON.stringify(config, null, 2));
}

async function listAudioFiles(includePending: boolean): Promise<Array<{ name: string; size: number; status: string; uploaded_by?: string; uploaded_at?: string }>> {
  const files: Array<{ name: string; size: number; status: string; uploaded_by?: string; uploaded_at?: string }> = [];
  const perms = await loadPermissionsFile();
  const approved: string[] = perms?.audio_approvals?.approved ?? [];

  // Ensure directory exists
  try { await mkdir(AUDIO_DIR, { recursive: true }); } catch {}

  try {
    const entries = await readdir(AUDIO_DIR);
    for (const f of entries.sort()) {
      if (!f.endsWith('.wav') || f.startsWith('_tmp_')) continue;
      const fullPath = join(AUDIO_DIR, f);
      try {
        const s = await stat(fullPath);
        if (!s.isFile()) continue;
        if (approved.length > 0) {
          files.push({ name: f, size: s.size, status: approved.includes(f) ? 'approved' : 'unapproved' });
        } else {
          files.push({ name: f, size: s.size, status: 'approved' });
        }
      } catch {}
    }
  } catch {}

  if (includePending) {
    try { await mkdir(AUDIO_PENDING_DIR, { recursive: true }); } catch {}
    try {
      const pendingEntries = await readdir(AUDIO_PENDING_DIR);
      const pendingMeta: any[] = perms?.audio_approvals?.pending ?? [];
      for (const f of pendingEntries.sort()) {
        if (!f.endsWith('.wav')) continue;
        const fullPath = join(AUDIO_PENDING_DIR, f);
        try {
          const s = await stat(fullPath);
          if (!s.isFile()) continue;
          const info = pendingMeta.find((p: any) => p?.filename === f);
          files.push({
            name: f,
            size: s.size,
            status: 'pending',
            uploaded_by: info?.uploaded_by ?? 'unknown',
            uploaded_at: info?.uploaded_at ?? '',
          });
        } catch {}
      }
    } catch {}
  }

  return files;
}

function ownsChannel(session: any, channelName: string): boolean {
  if (session.role === 'admin') return true;
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  // Channel format: SIP/username-xxxx
  for (const sip of sipUsers) {
    if (channelName.startsWith(`SIP/${sip}-`)) return true;
  }
  return false;
}

// --- Handlers ---

export async function handleListAudio(
  ws: ServerWebSocket<any>,
  session: any,
  _msg: any,
  send: SendFn
) {
  if (!session.permissions.audio_player) {
    send(ws, { type: 'error', message: 'Audio player is disabled for your account.', code: 'FORBIDDEN' });
    return;
  }

  try {
    const files = await listAudioFiles(session.role === 'admin');
    send(ws, { type: 'audio_list', files });
  } catch (err) {
    console.error('[Audio] list_audio error:', err);
    send(ws, { type: 'error', message: 'Failed to list audio files.', code: 'INTERNAL_ERROR' });
  }
}

export async function handleUploadAudio(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  if (!session.permissions.audio_player) {
    send(ws, { type: 'error', message: 'Audio upload not permitted.', code: 'FORBIDDEN' });
    return;
  }

  const filename = (msg.filename || '').trim();
  const audioData = msg.data || '';

  if (!filename || !audioData) {
    send(ws, { type: 'error', message: 'Missing filename or audio data.', code: 'INVALID_INPUT' });
    return;
  }

  // Validate extension
  const ext = extname(filename).toLowerCase();
  if (!AUDIO_ALLOWED_EXT.has(ext)) {
    send(ws, { type: 'error', message: `Unsupported format. Allowed: ${[...AUDIO_ALLOWED_EXT].join(', ')}`, code: 'INVALID_INPUT' });
    return;
  }

  // Decode base64
  let rawBytes: Buffer;
  try {
    rawBytes = Buffer.from(audioData, 'base64');
  } catch {
    send(ws, { type: 'error', message: 'Invalid audio data (base64 decode failed).', code: 'INVALID_INPUT' });
    return;
  }

  if (rawBytes.length > AUDIO_MAX_SIZE) {
    send(ws, { type: 'error', message: `File too large (max ${AUDIO_MAX_SIZE / 1024 / 1024}MB).`, code: 'INVALID_INPUT' });
    return;
  }

  const safeName = sanitizeAudioFilename(filename);

  // Admin uploads go directly to approved; others go to pending
  const isAdmin = session.role === 'admin';
  const destDir = isAdmin ? AUDIO_DIR : AUDIO_PENDING_DIR;
  const status = isAdmin ? 'approved' : 'pending';

  const tmpPath = join(destDir, `_tmp_${safeName}${ext}`);
  const wavPath = join(destDir, `${safeName}.wav`);

  try {
    // Ensure directory exists
    await mkdir(destDir, { recursive: true });

    // Write temp file
    await writeFile(tmpPath, rawBytes);

    // Convert to Asterisk-compatible WAV (8kHz mono 16-bit) using sox
    const proc = Bun.spawn(['sox', tmpPath, '-r', '8000', '-c', '1', '-b', '16', wavPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderrText = await new Response(proc.stderr).text();
      throw new Error(`sox conversion failed: ${stderrText.slice(0, 200)}`);
    }

    // Update permissions.json
    const perms = await loadPermissionsFile();
    if (!perms.audio_approvals) {
      perms.audio_approvals = { pending: [], approved: [] };
    }

    const wavName = `${safeName}.wav`;
    if (status === 'approved') {
      if (!perms.audio_approvals.approved.includes(wavName)) {
        perms.audio_approvals.approved.push(wavName);
      }
    } else {
      perms.audio_approvals.pending.push({
        filename: wavName,
        uploaded_by: session.username || session.sipUser,
        uploaded_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      });
    }
    await savePermissionsFile(perms);

    auditLog(session.username, session.role, session.ip, 'upload_audio', wavName, status);
    console.log(`[Audio] ${session.username} uploaded: ${wavName} (${rawBytes.length} bytes) -> ${status}`);

    const files = await listAudioFiles(session.role === 'admin');
    send(ws, { type: 'audio_uploaded', name: wavName, status, files });
  } catch (err: any) {
    console.error('[Audio] upload error:', err);
    send(ws, { type: 'error', message: `Upload failed: ${err.message || err}`, code: 'INTERNAL_ERROR' });
  } finally {
    // Clean up temp file
    try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch {}
  }
}

export async function handlePlayAudio(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  if (!session.permissions.audio_player) {
    send(ws, { type: 'error', message: 'Audio playback not permitted.', code: 'FORBIDDEN' });
    return;
  }

  const filename = (msg.filename || '').trim();
  const channelName = (msg.channel || '').trim();

  if (!filename || filename.includes('..') || filename.includes('/')) {
    send(ws, { type: 'error', message: 'Invalid filename.', code: 'INVALID_INPUT' });
    return;
  }

  // Check file exists
  const wavPath = join(AUDIO_DIR, filename);
  if (!existsSync(wavPath)) {
    send(ws, { type: 'error', message: 'Audio file not found.', code: 'NOT_FOUND' });
    return;
  }

  const playbackState = getPlaybackState(ws);
  if (playbackState.playing) {
    send(ws, { type: 'error', message: 'Audio already playing. Stop it first.', code: 'CONFLICT' });
    return;
  }

  if (!channelName) {
    send(ws, { type: 'error', message: 'No channel specified.', code: 'INVALID_INPUT' });
    return;
  }

  if (!ownsChannel(session, channelName)) {
    send(ws, { type: 'error', message: 'Channel does not belong to you.', code: 'FORBIDDEN' });
    return;
  }

  // Resolve bridge and find callee channel
  const allChannels = await getActiveChannels();
  let bridgeId: string | null = null;
  for (const ch of allChannels) {
    if (ch.channel === channelName && ch.bridgeid) {
      bridgeId = ch.bridgeid;
      break;
    }
  }

  if (!bridgeId) {
    send(ws, { type: 'error', message: 'Call is not bridged yet. Wait until the call is connected.', code: 'PRECONDITION_FAILED' });
    return;
  }

  // Find the callee (other) channel in the bridge
  let calleeChannel: string | null = null;
  for (const ch of allChannels) {
    if (ch.bridgeid === bridgeId && ch.channel !== channelName) {
      calleeChannel = ch.channel;
      break;
    }
  }

  if (!calleeChannel) {
    send(ws, { type: 'error', message: 'Could not find the other party in the call.', code: 'NOT_FOUND' });
    return;
  }

  // Strip .wav extension - Asterisk Playback auto-appends format
  const audioStem = filename.replace(/\.wav$/, '');

  const ami = getAmiClient();
  if (!ami) {
    send(ws, { type: 'error', message: 'AMI not connected.', code: 'SERVICE_UNAVAILABLE' });
    return;
  }

  try {
    // Originate Local channel pair: one leg plays audio, other leg ChanSpys callee
    ami.sendAction('Originate', {
      Channel: 'Local/play@calltools-inject/n',
      Context: 'calltools-spy',
      Exten: 'spy',
      Priority: '1',
      Variable: `TARGET_CHAN=${calleeChannel},AUDIO_FILE=${audioStem}`,
      Async: 'yes',
    });

    playbackState.playing = true;
    playbackState.file = filename;
    playbackState.calleeChannel = calleeChannel;

    auditLog(session.username, session.role, session.ip, 'play_audio', filename, calleeChannel);
    console.log(`[Audio] ${session.username} started playback: ${filename} -> ${calleeChannel}`);

    send(ws, { type: 'audio_playing', file: filename, callee: calleeChannel });
  } catch (err: any) {
    console.error('[Audio] play error:', err);
    send(ws, { type: 'error', message: `Failed to start audio playback: ${err.message || err}`, code: 'AMI_ERROR' });
  }
}

export async function handleStopAudio(
  ws: ServerWebSocket<any>,
  session: any,
  _msg: any,
  send: SendFn
) {
  const playbackState = getPlaybackState(ws);
  const playedFile = playbackState.file;
  const calleeChannel = playbackState.calleeChannel;

  if (playbackState.playing) {
    playbackState.playing = false;
    playbackState.file = null;
    playbackState.calleeChannel = null;

    // Find and hang up calltools-inject/calltools-spy Local channels
    // that are associated with this user's playback callee
    try {
      const proc = Bun.spawn(['/usr/sbin/asterisk', '-rx', 'core show channels concise'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      const calleePrefix = calleeChannel ? calleeChannel.split('-')[0] : null;

      const ami = getAmiClient();
      if (ami) {
        for (const line of output.split('\n')) {
          const parts = line.split('!');
          if (parts.length < 7) continue;
          const chName = parts[0] || '';
          const context = parts[1] || '';
          const data = parts[6] || '';

          const isCalltools = chName.includes('calltools-inject') || chName.includes('calltools-spy') ||
            context.includes('calltools-inject') || context.includes('calltools-spy');
          if (!isCalltools) continue;

          // If we know the callee, only kill channels related to that callee
          if (calleePrefix && !data.includes(calleePrefix) && !chName.includes('calltools-inject')) {
            continue;
          }

          // Hangup this channel
          ami.sendAction('Hangup', { Channel: chName });
        }
      }
    } catch (err) {
      console.error('[Audio] stop cleanup error:', err);
    }

    auditLog(session.username, session.role, session.ip, 'stop_audio', playedFile || '');
    console.log(`[Audio] ${session.username} stopped audio playback`);
  } else {
    console.log(`[Audio] ${session.username} stop_audio but nothing was playing`);
  }

  send(ws, { type: 'audio_stopped', file: playedFile, reason: 'stopped' });
}

export async function handleDeleteAudio(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  if (session.role !== 'admin') {
    send(ws, { type: 'error', message: 'Only admins can delete audio files.', code: 'FORBIDDEN' });
    return;
  }

  const filename = (msg.filename || '').trim();
  if (!filename || filename.includes('..') || filename.includes('/')) {
    send(ws, { type: 'error', message: 'Invalid filename.', code: 'INVALID_INPUT' });
    return;
  }

  const filepath = join(AUDIO_DIR, filename);
  if (!existsSync(filepath)) {
    send(ws, { type: 'error', message: 'File not found.', code: 'NOT_FOUND' });
    return;
  }

  try {
    await unlink(filepath);

    // Remove from approved list in permissions
    const perms = await loadPermissionsFile();
    const approved: string[] = perms?.audio_approvals?.approved ?? [];
    const idx = approved.indexOf(filename);
    if (idx !== -1) {
      approved.splice(idx, 1);
      await savePermissionsFile(perms);
    }

    auditLog(session.username, session.role, session.ip, 'delete_audio', filename);
    console.log(`[Audio] ${session.username} deleted audio: ${filename}`);

    const files = await listAudioFiles(true);
    send(ws, { type: 'audio_deleted', name: filename, files });
  } catch (err: any) {
    console.error('[Audio] delete error:', err);
    send(ws, { type: 'error', message: `Delete failed: ${err.message || err}`, code: 'INTERNAL_ERROR' });
  }
}
