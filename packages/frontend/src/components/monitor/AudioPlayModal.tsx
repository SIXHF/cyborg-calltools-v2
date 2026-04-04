import { useState, useEffect } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

interface AudioPlayModalProps {
  channel: string;
  onClose: () => void;
}

export function AudioPlayModal({ channel, onClose }: AudioPlayModalProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const audioListMsg = useWsMessage<any>('audio_list');
  const audioPlayingMsg = useWsMessage<any>('audio_playing');

  useEffect(() => {
    wsSend({ cmd: 'list_audio' });
  }, []);

  useEffect(() => {
    if (audioListMsg?.files) {
      setFiles(audioListMsg.files.map((f: any) => typeof f === 'string' ? f : f.name));
      if (audioListMsg.files.length > 0 && !selected) {
        const first = audioListMsg.files[0];
        setSelected(typeof first === 'string' ? first : first.name);
      }
    }
  }, [audioListMsg]);

  useEffect(() => {
    if (audioPlayingMsg) onClose();
  }, [audioPlayingMsg]);

  const handlePlay = () => {
    if (!selected) return;
    wsSend({ cmd: 'play_audio', channel, filename: selected });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-ct-accent">Play Audio</h3>
          <button onClick={onClose} className="text-ct-muted hover:text-ct-text text-xl">&times;</button>
        </div>
        <p className="text-xs text-ct-muted mb-3">Channel: {channel}</p>

        {files.length === 0 ? (
          <div className="text-ct-muted text-sm py-4 text-center">No audio files available. Upload files in Tools &gt; Audio Player.</div>
        ) : (
          <>
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="form-input w-full mb-3"
            >
              {files.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="btn btn-sm">Cancel</button>
              <button onClick={handlePlay} disabled={!selected} className="btn btn-primary btn-sm">
                &#9654; Play
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
