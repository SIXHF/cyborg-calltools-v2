import type { ServerWebSocket } from 'bun';
import { getAmiClient } from '../ami/client';
import { auditLog } from '../audit/logger';
import { transcribeAudio } from '../transcription/whisper';
import { readFile, unlink, stat } from 'fs/promises';

// Match V1 constants exactly
const TRANSCRIPT_DIR = '/dev/shm'; // RAM-backed tmpfs
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? '';
const ELEVENLABS_SCRIBE_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const ELEVENLABS_SCRIBE_MODEL = process.env.ELEVENLABS_SCRIBE_MODEL ?? 'scribe_v2_realtime';
const ELEVENLABS_SCRIBE_LANGUAGE = process.env.ELEVENLABS_SCRIBE_LANGUAGE ?? 'en';
const ELEVENLABS_SCRIBE_SAMPLE_RATE = 16000; // matches .sln16

const WHISPER_SAMPLE_RATE = 16000;
const WHISPER_SEGMENT_DURATION = 5.0;
const TRANSCRIPT_READ_INTERVAL = 1000; // ms

const MAX_CONCURRENT_TRANSCRIPTIONS = ELEVENLABS_API_KEY ? 50 : (process.env.WHISPER_GPU_URL ? 15 : 3);

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

interface TranscriptState {
  enabled: boolean;
  channel: string;
  bridgeId: string;
  fileRx: string;
  fileTx: string;
  fileMix: string;
  backend: 'elevenlabs' | 'whisper';
  lines: { text: string; time: string; speaker: string }[];
  abortController: AbortController;
  elevenlabsWsRx: WebSocket | null;
  elevenlabsWsTx: WebSocket | null;
}

// ── Whisper hallucination filtering (V1 parity: lines 2202-2240) ──
const WHISPER_HALLUCINATIONS = new Set([
  'thank you', 'thank you.', 'thank you!',
  'thanks', 'thanks.', 'thanks!',
  'thanks for watching', 'thanks for watching.',
  'thanks for watching!', 'thank you for watching',
  'thank you for watching.', 'thank you for watching!',
  'bye', 'bye.', 'bye bye', 'bye bye.',
  'goodbye', 'goodbye.', 'you', 'you.',
  'the end', 'the end.', 'hmm', 'hmm.',
  'uh', 'uh.', 'oh', 'oh.',
  'so', 'so.', 'okay', 'okay.',
  'ok, perfect', 'ok, perfect.',
  'ok perfect', 'ok perfect.',
  'perfect', 'perfect.',
  'yes', 'yes.', 'no', 'no.',
  'i', 'i.', 'um', 'um.',
  'silence', 'silence.', 'music', 'music.',
  'applause', 'applause.',
  'subtitles by', 'subtitles by the amara.org community',
  'thank you so much', 'thank you so much.',
  'please subscribe', 'please subscribe.',
  'like and subscribe', 'like and subscribe.',
]);

function isHallucination(text: string): boolean {
  return WHISPER_HALLUCINATIONS.has(text.trim().toLowerCase());
}

/** Active transcriptions per WebSocket client */
const activeTranscripts = new Map<ServerWebSocket<any>, TranscriptState>();
let activeCount = 0;

export function getActiveTranscriptionCount(): number {
  return activeCount;
}

export function getMaxTranscriptions(): number {
  return MAX_CONCURRENT_TRANSCRIPTIONS;
}

export function getTranscriptState(ws: ServerWebSocket<any>): TranscriptState | undefined {
  return activeTranscripts.get(ws);
}

/**
 * Check all active transcriptions and clean up any whose channel is no longer active.
 * Called from channel broadcast polling (every 3s) to auto-stop on hangup.
 */
export function checkTranscriptionChannels(activeChannelNames: Set<string>): void {
  for (const [ws, state] of activeTranscripts) {
    if (!activeChannelNames.has(state.channel)) {
      console.log(`[Transcription] Channel ${state.channel} hung up, auto-stopping`);
      try {
        (ws as any).send(JSON.stringify({ type: 'transcript_done', channel: state.channel }));
      } catch {}
      cleanupTranscription(ws).catch(() => {});
    }
  }
}

// ── ElevenLabs Scribe Streaming ─────────────────────────────────────

async function elevenlabsScribeStream(
  clientWs: ServerWebSocket<any>,
  state: TranscriptState,
  speaker: 'caller' | 'callee',
  audioFile: string,
  send: SendFn
): Promise<void> {
  const chunkInterval = 100; // ms
  const maxRetries = 10;
  const retryBaseDelay = 1000;
  const retryMaxDelay = 15000;

  const params = [
    `?model_id=${ELEVENLABS_SCRIBE_MODEL}`,
    `&language_code=${ELEVENLABS_SCRIBE_LANGUAGE}`,
    `&audio_format=pcm_${ELEVENLABS_SCRIBE_SAMPLE_RATE}`,
    `&commit_strategy=vad`,
    `&vad_silence_threshold_secs=0.5`,
    `&vad_threshold=0.3`,
  ].join('');

  const wsUrl = ELEVENLABS_SCRIBE_WS_URL + params;

  // Wait for file to appear
  while (state.enabled) {
    try {
      await stat(audioFile);
      break;
    } catch {
      await sleep(chunkInterval);
    }
  }
  if (!state.enabled) return;

  // Open file handle outside retry loop so read position survives reconnects
  let filePos = 0;
  let retryCount = 0;

  while (retryCount < maxRetries && state.enabled) {
    let elWs: WebSocket | null = null;
    let wsSendFailed = false;

    try {
      // Connect to ElevenLabs Scribe WebSocket
      elWs = new WebSocket(wsUrl, {
        headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      } as any);

      // Store reference for cleanup
      if (speaker === 'caller') state.elevenlabsWsRx = elWs;
      else state.elevenlabsWsTx = elWs;

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const onOpen = () => { elWs!.removeEventListener('error', onError); resolve(); };
        const onError = (e: Event) => { elWs!.removeEventListener('open', onOpen); reject(e); };
        elWs!.addEventListener('open', onOpen, { once: true });
        elWs!.addEventListener('error', onError, { once: true });
      });

      // Set up message handler
      elWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          const msgType = msg.message_type ?? '';

          if (msgType === 'partial_transcript') {
            const text = (msg.text ?? '').trim();
            if (text && !isHallucination(text)) {
              try {
                send(clientWs, {
                  type: 'transcript_update',
                  channel: state.channel,
                  speaker,
                  text,
                  isFinal: false,
                });
              } catch { /* client may have disconnected */ }
            }
          } else if (msgType === 'committed_transcript' || msgType === 'committed_transcript_with_timestamps') {
            const text = (msg.text ?? '').trim();
            if (text && !isHallucination(text)) {
              const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
              state.lines.push({ text, time: ts, speaker });
              try {
                send(clientWs, {
                  type: 'transcript_update',
                  channel: state.channel,
                  speaker,
                  text,
                  isFinal: true,
                });
              } catch { /* client may have disconnected */ }
            }
          } else if (msgType === 'session_started') {
            console.log(`[Transcription] ElevenLabs Scribe session started (${speaker})`);
          } else if (msgType === 'error') {
            console.error(`[Transcription] ElevenLabs Scribe error (${speaker}):`, msg);
          }
        } catch { /* ignore parse errors */ }
      };

      if (retryCount > 0) {
        console.log(`[Transcription] ElevenLabs Scribe reconnected (${speaker}), attempt ${retryCount + 1}`);
      }

      // Stream audio chunks from growing file
      while (state.enabled) {
        await sleep(chunkInterval);

        let data: Buffer;
        try {
          const fullContent = await readFile(audioFile);
          if (fullContent.length <= filePos) continue;
          data = fullContent.subarray(filePos);
          filePos = fullContent.length;
        } catch {
          continue;
        }

        if (!data.length) continue;

        const audioB64 = data.toString('base64');
        try {
          elWs.send(JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: audioB64,
          }));
        } catch (e) {
          console.warn(`[Transcription] ElevenLabs send error (${speaker}), will reconnect:`, e);
          wsSendFailed = true;
          break;
        }
      }
    } catch (e) {
      console.warn(`[Transcription] ElevenLabs Scribe connection error (${speaker}):`, e);
      wsSendFailed = true;
    } finally {
      if (elWs) {
        if (!wsSendFailed) {
          // Normal shutdown -- send final commit
          try {
            elWs.send(JSON.stringify({
              message_type: 'input_audio_chunk',
              audio_base_64: '',
              commit: true,
            }));
            await sleep(1000);
          } catch { /* ignore */ }
        }
        try { elWs.close(); } catch { /* ignore */ }
      }

      if (speaker === 'caller') state.elevenlabsWsRx = null;
      else state.elevenlabsWsTx = null;
    }

    if (!wsSendFailed || !state.enabled) break;

    retryCount++;
    if (retryCount < maxRetries) {
      const delay = Math.min(retryBaseDelay * Math.pow(2, retryCount - 1), retryMaxDelay);
      console.log(`[Transcription] ElevenLabs Scribe (${speaker}) reconnecting in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
      await sleep(delay);
    } else {
      console.error(`[Transcription] ElevenLabs Scribe (${speaker}) max retries (${maxRetries}) exhausted`);
    }
  }
}

// ── Whisper batch streaming ─────────────────────────────────────────

async function whisperBatchStream(
  clientWs: ServerWebSocket<any>,
  state: TranscriptState,
  speaker: 'caller' | 'callee',
  audioFile: string,
  segmentDuration: number,
  send: SendFn
): Promise<void> {
  const segmentBytes = Math.floor(WHISPER_SAMPLE_RATE * 2 * segmentDuration);
  let filePos = 0;
  let audioBuffer = Buffer.alloc(0);

  try {
    while (state.enabled) {
      await sleep(TRANSCRIPT_READ_INTERVAL);

      let data: Buffer;
      try {
        const fullContent = await readFile(audioFile);
        if (fullContent.length <= filePos) continue;
        data = fullContent.subarray(filePos);
        filePos = fullContent.length;
      } catch {
        continue;
      }

      audioBuffer = Buffer.concat([audioBuffer, data]);

      while (audioBuffer.length >= segmentBytes) {
        const segment = audioBuffer.subarray(0, segmentBytes);
        audioBuffer = audioBuffer.subarray(segmentBytes);

        try {
          const result = await transcribeAudio(segment);
          if (result.text && !isHallucination(result.text)) {
            const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
            state.lines.push({ text: result.text, time: ts, speaker });
            try {
              send(clientWs, {
                type: 'transcript_update',
                channel: state.channel,
                speaker,
                text: result.text,
                isFinal: true,
              });
            } catch { return; }
          }
        } catch (e) {
          console.error(`[Transcription] Whisper error (${speaker}):`, e);
        }
      }
    }
  } catch { /* cancelled or error */ }

  // Transcribe remaining buffered audio (at least 0.5s worth)
  if (audioBuffer.length > WHISPER_SAMPLE_RATE) {
    try {
      const result = await transcribeAudio(audioBuffer);
      if (result.text && !isHallucination(result.text)) {
        const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
        state.lines.push({ text: result.text, time: ts, speaker });
        try {
          send(clientWs, {
            type: 'transcript_update',
            channel: state.channel,
            speaker,
            text: result.text,
            isFinal: true,
          });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function startTranscription(
  ws: ServerWebSocket<any>,
  session: { username: string; role: string; sipUser?: string; sipUsers?: string[]; ip: string; permissions: Record<string, boolean> },
  channel: string,
  allChannels: { channel: string; bridgeid?: string; callerid?: string; exten?: string }[],
  send: SendFn,
  broadcastSlots: () => void
): Promise<void> {
  if (activeTranscripts.has(ws)) {
    send(ws, { type: 'error', message: 'Transcription already active.' });
    return;
  }

  if (activeCount >= MAX_CONCURRENT_TRANSCRIPTIONS) {
    send(ws, { type: 'error', message: `Max concurrent transcriptions reached (${MAX_CONCURRENT_TRANSCRIPTIONS}). Try again later.` });
    return;
  }

  // Resolve bridge ID
  let bridgeId: string | null = null;
  for (const ch of allChannels) {
    if (ch.channel === channel && ch.bridgeid) {
      bridgeId = ch.bridgeid;
      break;
    }
  }

  if (!bridgeId) {
    send(ws, { type: 'error', message: 'Call is not bridged yet. Wait until the call is connected.' });
    return;
  }

  // Resolve caller/callee names
  const callerName = session.sipUser || session.username || 'Caller';
  let calleeName = 'Called Party';
  for (const ch of allChannels) {
    if (ch.bridgeid === bridgeId && ch.channel !== channel) {
      calleeName = ch.callerid || ch.exten || ch.channel || 'Called Party';
      break;
    }
  }

  // Set up dual-stream transcription
  const safeBridge = bridgeId.replace(/[^a-zA-Z0-9_-]/g, '');
  const mixFile = `${TRANSCRIPT_DIR}/transcript_${safeBridge}_mix.sln16`;
  const rxFile = `${TRANSCRIPT_DIR}/transcript_${safeBridge}_rx.sln16`;
  const txFile = `${TRANSCRIPT_DIR}/transcript_${safeBridge}_tx.sln16`;

  // Start MixMonitor with separate r()/t() files
  const ami = getAmiClient();
  if (!ami) {
    send(ws, { type: 'error', message: 'AMI not available.' });
    return;
  }

  try {
    ami.sendAction('MixMonitor', {
      Channel: channel,
      File: mixFile,
      Options: `r(${rxFile})t(${txFile})`,
    });
  } catch (e) {
    send(ws, { type: 'error', message: `Failed to start audio capture: ${e}` });
    return;
  }

  const backend = ELEVENLABS_API_KEY ? 'elevenlabs' : 'whisper';
  const state: TranscriptState = {
    enabled: true,
    channel,
    bridgeId,
    fileRx: rxFile,
    fileTx: txFile,
    fileMix: mixFile,
    backend,
    lines: [],
    abortController: new AbortController(),
    elevenlabsWsRx: null,
    elevenlabsWsTx: null,
  };

  activeTranscripts.set(ws, state);
  activeCount++;

  // Launch async streaming tasks (fire and forget, managed by state.enabled)
  if (backend === 'elevenlabs') {
    elevenlabsScribeStream(ws, state, 'caller', rxFile, send).catch(() => {});
    elevenlabsScribeStream(ws, state, 'callee', txFile, send).catch(() => {});
  } else {
    // Caller (agent) uses 5s segments; callee (customer) uses 8s for longer utterances
    whisperBatchStream(ws, state, 'caller', rxFile, 5.0, send).catch(() => {});
    whisperBatchStream(ws, state, 'callee', txFile, 8.0, send).catch(() => {});
  }

  console.log(`[Transcription] ${session.username} started on ${channel} (bridge=${bridgeId}, backend=${backend}, active=${activeCount})`);
  auditLog(session.username, session.role, session.ip, 'start_transcript', channel, `bridge=${bridgeId},backend=${backend}`);

  send(ws, {
    type: 'transcript_started',
    channel,
    callerName,
    calleeName,
    backend,
    timestamp: Date.now() / 1000,
  });

  broadcastSlots();
}

export async function stopTranscription(
  ws: ServerWebSocket<any>,
  send: SendFn,
  broadcastSlots: () => void
): Promise<{ lines: { text: string; time: string; speaker: string }[] } | null> {
  const state = activeTranscripts.get(ws);
  if (!state) {
    return null;
  }

  const finalLines = [...state.lines];
  await cleanupTranscription(ws);
  broadcastSlots();
  return { lines: finalLines };
}

export async function cleanupTranscription(ws: ServerWebSocket<any>): Promise<void> {
  const state = activeTranscripts.get(ws);
  if (!state) return;

  const wasActive = state.enabled;
  state.enabled = false;

  // Stop MixMonitor
  if (state.channel) {
    const ami = getAmiClient();
    if (ami) {
      try {
        ami.sendAction('StopMixMonitor', { Channel: state.channel });
      } catch { /* channel may be gone */ }
    }
  }

  // Remove audio files
  for (const fpath of [state.fileMix, state.fileRx, state.fileTx]) {
    if (fpath) {
      try { await unlink(fpath); } catch { /* may not exist */ }
    }
  }

  // Close ElevenLabs WebSocket connections
  for (const elWs of [state.elevenlabsWsRx, state.elevenlabsWsTx]) {
    if (elWs) {
      try { elWs.close(); } catch { /* ignore */ }
    }
  }
  state.elevenlabsWsRx = null;
  state.elevenlabsWsTx = null;

  activeTranscripts.delete(ws);

  if (wasActive) {
    activeCount = Math.max(0, activeCount - 1);
    console.log(`[Transcription] Cleaned up (active: ${activeCount})`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
