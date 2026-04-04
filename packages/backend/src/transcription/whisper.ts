const WHISPER_GPU_URL = process.env.WHISPER_GPU_URL ?? 'http://localhost:8765';
const WHISPER_GPU_API_KEY = process.env.WHISPER_GPU_API_KEY ?? '';

interface TranscriptionResult {
  text: string;
  error?: string;
}

/**
 * Send audio to the Whisper GPU server for transcription.
 * Expects raw PCM audio: 16kHz, 16-bit, mono.
 */
export async function transcribeAudio(pcmAudio: Buffer): Promise<TranscriptionResult> {
  try {
    const response = await fetch(`${WHISPER_GPU_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHISPER_GPU_API_KEY}`,
        'Content-Type': 'application/octet-stream',
      },
      body: pcmAudio,
    });

    if (!response.ok) {
      return { text: '', error: `Whisper server returned ${response.status}` };
    }

    const result = await response.json() as { text: string };
    return { text: result.text };
  } catch (err) {
    return { text: '', error: `Whisper server unavailable: ${err}` };
  }
}

/**
 * Check Whisper GPU server health.
 */
export async function checkWhisperHealth(): Promise<{ healthy: boolean; gpu?: string }> {
  try {
    const response = await fetch(`${WHISPER_GPU_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { healthy: false };
    const data = await response.json() as { status: string; gpu?: string };
    return { healthy: data.status === 'ok', gpu: data.gpu };
  } catch {
    return { healthy: false };
  }
}
