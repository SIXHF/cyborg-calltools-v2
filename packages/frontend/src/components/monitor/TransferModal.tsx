import { useState } from 'react';
import { wsSend } from '../../hooks/useWebSocket';

interface TransferModalProps {
  channel: string;
  sipUser: string;
  onClose: () => void;
}

export function TransferModal({ channel, sipUser, onClose }: TransferModalProps) {
  const [destination, setDestination] = useState('');
  const [transferType, setTransferType] = useState<'blind' | 'attended'>('blind');
  const [loading, setLoading] = useState(false);

  const doTransfer = () => {
    if (!destination.trim()) return;
    setLoading(true);
    wsSend({ cmd: 'transfer_call', channel, destination: destination.trim(), transferType });
    setTimeout(() => { setLoading(false); onClose(); }, 2000);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <h3 className="text-base font-semibold text-ct-text-secondary mb-1">Transfer Call</h3>
        <p className="text-[13px] text-ct-muted mb-4">{sipUser} — {channel}</p>

        {/* Transfer type toggle */}
        <div className="flex gap-0 mb-4">
          <button
            onClick={() => setTransferType('blind')}
            className={`flex-1 py-1.5 text-xs font-semibold border transition-colors ${
              transferType === 'blind'
                ? 'bg-ct-blue text-white border-ct-blue'
                : 'bg-ct-border-solid text-ct-muted border-ct-border-solid'
            }`}
            style={{ borderRadius: '8px 0 0 8px' }}
          >
            Blind
          </button>
          <button
            onClick={() => setTransferType('attended')}
            className={`flex-1 py-1.5 text-xs font-semibold border transition-colors ${
              transferType === 'attended'
                ? 'bg-ct-blue text-white border-ct-blue'
                : 'bg-ct-border-solid text-ct-muted border-ct-border-solid'
            }`}
            style={{ borderRadius: '0 8px 8px 0' }}
          >
            Attended
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={destination}
            onChange={e => setDestination(e.target.value)}
            placeholder="Destination number..."
            className="form-input flex-1 font-mono"
            onKeyDown={e => e.key === 'Enter' && doTransfer()}
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-sm">Cancel</button>
          <button onClick={doTransfer} disabled={loading || !destination.trim()} className="btn btn-sm btn-primary">
            {loading ? 'Transferring...' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
