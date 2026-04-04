import { useEffect, useRef } from 'react';
import { useTranscriptStore } from '../../stores/transcriptStore';
import { useUiStore } from '../../stores/uiStore';
import { wsSend } from '../../hooks/useWebSocket';

interface LiveTranscriptModalProps {
  channel: string;
  onClose: () => void;
}

function speakerLabel(speaker: string): string {
  if (speaker === 'caller') return 'Caller';
  if (speaker === 'callee') return 'Called Party';
  return speaker || 'Unknown';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function extractAgentName(channel: string): string {
  // Extract SIP user from channel like "SIP/1001-00000042"
  const match = channel.match(/^SIP\/([^-]+)/);
  return match ? match[1] : channel;
}

export function LiveTranscriptModal({ channel, onClose }: LiveTranscriptModalProps) {
  const segments = useTranscriptStore((s) => s.segments);
  const partials = useTranscriptStore((s) => s.partials);
  const areaRef = useRef<HTMLDivElement>(null);
  const addToast = useUiStore((s) => s.addToast);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (areaRef.current) {
      areaRef.current.scrollTop = areaRef.current.scrollHeight;
    }
  }, [segments, partials]);

  function handleStop() {
    wsSend({ cmd: 'stop_transcript', channel });
    onClose();
  }

  function handleCopy() {
    if (segments.length === 0) return;
    const lines = ['=== Call Transcript ==='];
    lines.push('Date: ' + new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString());
    lines.push('Channel: ' + channel);
    lines.push('');
    segments.forEach((line) => {
      const spk = speakerLabel(line.speaker || 'caller');
      lines.push('[' + formatTime(line.timestamp) + '] ' + spk + ': ' + line.text);
    });
    lines.push('');
    lines.push('=======================');
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      addToast('Transcript copied to clipboard', 'success', 2000);
    }).catch(() => {
      addToast('Copy failed', 'error', 2000);
    });
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const hasContent = segments.length > 0 || partials.caller || partials.callee;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={handleOverlayClick}
    >
      <div
        className="w-full max-w-[600px] max-h-[80vh] overflow-y-auto rounded-2xl border p-6"
        style={{
          background: 'rgba(22, 27, 34, 0.95)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderColor: 'rgba(48, 54, 61, 0.6)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4), 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold" style={{ color: '#3fb950', marginBottom: '2px' }}>
              Live Transcript
            </h3>
            <p className="text-xs" style={{ color: '#8b949e', margin: 0 }}>
              {extractAgentName(channel)} ({channel})
            </p>
          </div>
          <div className="flex gap-1.5">
            {segments.length > 0 && (
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border"
                style={{
                  background: 'transparent',
                  borderColor: '#30363d',
                  color: '#c9d1d9',
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
            )}
            <button
              onClick={handleStop}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border"
              style={{
                background: 'rgba(248, 81, 73, 0.15)',
                borderColor: 'rgba(248, 81, 73, 0.4)',
                color: '#f85149',
                cursor: 'pointer',
              }}
            >
              Stop
            </button>
          </div>
        </div>

        {/* Transcript Area */}
        <div
          ref={areaRef}
          className="rounded-lg mb-2"
          style={{
            maxHeight: '400px',
            minHeight: '120px',
            background: '#0d1117',
            borderRadius: '8px',
            padding: '12px 18px',
            overflowY: 'auto',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: '13px',
            lineHeight: '1.6',
          }}
        >
          {!hasContent && (
            <div style={{ color: '#484f58', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
              Listening for speech...
            </div>
          )}

          {/* Final lines */}
          {segments.map((line, i) => {
            const spkClass = line.speaker === 'callee' ? 'callee' : 'caller';
            const spkColor = spkClass === 'callee' ? '#d2a8ff' : '#58a6ff';
            return (
              <div key={i} className="flex gap-2.5" style={{ padding: '3px 0' }}>
                <span style={{ color: '#484f58', whiteSpace: 'nowrap', minWidth: '65px', fontSize: '11px', paddingTop: '1px' }}>
                  {formatTime(line.timestamp)}
                </span>
                <span style={{ color: spkColor, fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', minWidth: '85px', padding: '1px 0' }}>
                  {speakerLabel(line.speaker)}
                </span>
                <span style={{ color: '#e0e6f0' }}>{line.text}</span>
              </div>
            );
          })}

          {/* Partial lines */}
          {(['caller', 'callee'] as const).map((spk) => {
            if (!partials[spk]) return null;
            const spkColor = spk === 'callee' ? '#d2a8ff' : '#58a6ff';
            return (
              <div key={`partial-${spk}`} className="flex gap-2.5" style={{ padding: '3px 0' }}>
                <span style={{ color: '#484f58', whiteSpace: 'nowrap', minWidth: '65px', fontSize: '11px', paddingTop: '1px' }} />
                <span style={{ color: spkColor, fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', minWidth: '85px', padding: '1px 0' }}>
                  {speakerLabel(spk)}
                </span>
                <span style={{ color: '#e0e6f0' }} className="transcript-partial">
                  {partials[spk]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer legend */}
        <div className="flex justify-between" style={{ fontSize: '11px', color: '#8b949e' }}>
          <span>
            {hasContent ? 'Transcribing...' : 'Connecting...'}
          </span>
          <span>
            <span style={{ color: '#58a6ff' }}>Caller</span> &amp; <span style={{ color: '#d2a8ff' }}>Called Party</span>
          </span>
        </div>
      </div>

      {/* CSS for blinking cursor on partials */}
      <style>{`
        .transcript-partial::after {
          content: '\\2502';
          animation: blink-cursor 0.8s step-end infinite;
          color: #58a6ff;
          margin-left: 2px;
        }
        @keyframes blink-cursor {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
