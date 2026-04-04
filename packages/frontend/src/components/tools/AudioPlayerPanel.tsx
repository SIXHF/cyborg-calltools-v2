import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useChannelStore } from '../../stores/channelStore';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

interface AudioFile {
  name: string;
  size: number;
  status: string;
  uploaded_by?: string;
  uploaded_at?: string;
}

export function AudioPlayerPanel() {
  const { role } = useAuthStore();
  const globalSelectedSip = useAuthStore(s => s.selectedSipUser);
  const { channels } = useChannelStore();
  const isAdmin = role === 'admin';
  const isNoSipSelected = (role === 'admin' || role === 'user') && !globalSelectedSip;

  const [files, setFiles] = useState<AudioFile[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCalls = channels.filter(ch => ch.state === 'answered');

  // Listen for audio messages
  const audioList = useWsMessage<any>('audio_list');
  const audioUploaded = useWsMessage<any>('audio_uploaded');
  const audioDeleted = useWsMessage<any>('audio_deleted');
  const audioPlayingMsg = useWsMessage<any>('audio_playing');
  const audioStopped = useWsMessage<any>('audio_stopped');
  const errorMsg = useWsMessage<any>('error');

  // Fetch file list on mount
  useEffect(() => {
    wsSend({ cmd: 'list_audio' });
  }, []);

  // Update file list from responses
  useEffect(() => {
    if (audioList?.files) {
      setFiles(audioList.files);
    }
  }, [audioList]);

  useEffect(() => {
    if (audioUploaded?.files) {
      setFiles(audioUploaded.files);
      setUploading(false);
      setStatus(`Uploaded: ${audioUploaded.name} (${audioUploaded.status})`);
    }
  }, [audioUploaded]);

  useEffect(() => {
    if (audioDeleted?.files) {
      setFiles(audioDeleted.files);
      if (selectedFile === audioDeleted.name) {
        setSelectedFile('');
      }
      setStatus(`Deleted: ${audioDeleted.name}`);
    }
  }, [audioDeleted]);

  useEffect(() => {
    if (audioPlayingMsg) {
      setIsPlaying(true);
      setPlayingFile(audioPlayingMsg.file);
      setStatus(`Playing: ${audioPlayingMsg.file}`);
    }
  }, [audioPlayingMsg]);

  useEffect(() => {
    if (audioStopped) {
      setIsPlaying(false);
      setPlayingFile(null);
      setStatus('Playback stopped.');
    }
  }, [audioStopped]);

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExt = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExt.includes(ext)) {
      setStatus(`Unsupported format. Allowed: ${allowedExt.join(', ')}`);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setStatus('File too large (max 10MB).');
      return;
    }

    setUploading(true);
    setStatus(`Uploading ${file.name}...`);

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]; // strip data:... prefix
      wsSend({ cmd: 'upload_audio', filename: file.name, data: base64 });
    };
    reader.onerror = () => {
      setUploading(false);
      setStatus('Failed to read file.');
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  const handlePlay = () => {
    if (!selectedFile || !selectedChannel) return;
    wsSend({ cmd: 'play_audio', channel: selectedChannel, filename: selectedFile });
  };

  const handleStop = () => {
    wsSend({ cmd: 'stop_audio' });
  };

  const handleDelete = (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    wsSend({ cmd: 'delete_audio', filename });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  return (
    <div className="glass-panel" style={{ borderColor: 'rgba(139,92,246,0.3)' }}>
      <div className="panel-header" style={{ borderBottomColor: 'rgba(139,92,246,0.2)', background: 'rgba(22,27,34,0.6)', borderRadius: '12px 12px 0 0' }}>
        <h2>Audio Player</h2>
      </div>
      <div className="p-4 space-y-3">
        {isNoSipSelected ? (
          <p className="text-ct-yellow text-sm">Select a specific SIP user to use Audio Player.</p>
        ) : (
          <>
            {/* File selector */}
            <div className="flex gap-2 items-center">
              <select
                value={selectedFile}
                onChange={e => setSelectedFile(e.target.value)}
                className="form-input flex-1 text-sm"
              >
                <option value="">-- Select audio file --</option>
                {files.filter(f => f.status === 'approved' || isAdmin).map(f => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({formatSize(f.size)}){f.status !== 'approved' ? ` [${f.status}]` : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="btn btn-sm text-xs px-3 py-1.5 bg-ct-surface-solid border border-ct-border-solid text-ct-text hover:border-purple-500 transition-colors"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.ogg,.m4a,.flac"
                onChange={onFileSelected}
                className="hidden"
              />
            </div>

            {/* Channel selector */}
            <div className="flex gap-2 items-center">
              <select
                value={selectedChannel}
                onChange={e => setSelectedChannel(e.target.value)}
                className="form-input flex-1 text-sm"
              >
                <option value="">-- Select active call --</option>
                {activeCalls.map(ch => (
                  <option key={ch.id} value={ch.id}>
                    {ch.sipUser} - {ch.callerNum || '?'} → {ch.calleeNum || '?'}
                  </option>
                ))}
              </select>
            </div>

            {/* Play / Stop buttons */}
            <div className="flex gap-2">
              <button
                onClick={handlePlay}
                disabled={!selectedFile || !selectedChannel || isPlaying}
                className="btn btn-success btn-sm flex-1"
              >
                {isPlaying ? 'Playing...' : 'Play to Callee'}
              </button>
              <button
                onClick={handleStop}
                disabled={!isPlaying}
                className="btn btn-sm flex-1 bg-red-600/20 border border-red-500/40 text-red-400 hover:bg-red-600/30 disabled:opacity-40"
              >
                Stop
              </button>
            </div>

            {/* Status */}
            {status && (
              <p className="text-xs text-ct-muted">{status}</p>
            )}

            {/* File list (admin sees all + delete) */}
            {files.length > 0 && (
              <div className="border border-ct-border-solid rounded-lg overflow-hidden">
                <div className="max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-ct-surface-solid text-ct-muted">
                        <th className="text-left px-2 py-1.5">File</th>
                        <th className="text-left px-2 py-1.5">Size</th>
                        <th className="text-left px-2 py-1.5">Status</th>
                        {isAdmin && <th className="text-right px-2 py-1.5">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {files.map(f => (
                        <tr key={f.name} className="border-t border-ct-border-solid hover:bg-ct-surface-solid/50">
                          <td className="px-2 py-1 font-mono text-ct-text truncate max-w-[150px]">{f.name}</td>
                          <td className="px-2 py-1 text-ct-muted">{formatSize(f.size)}</td>
                          <td className="px-2 py-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              f.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                              f.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-ct-surface-solid text-ct-muted'
                            }`}>
                              {f.status}
                            </span>
                          </td>
                          {isAdmin && (
                            <td className="px-2 py-1 text-right">
                              <button
                                onClick={() => handleDelete(f.name)}
                                className="text-red-400 hover:text-red-300 text-[10px] font-medium"
                              >
                                Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeCalls.length === 0 && (
              <p className="text-ct-muted text-xs">No active calls. Start a call to play audio.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
