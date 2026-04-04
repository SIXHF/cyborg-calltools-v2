import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useChannelStore } from '../../stores/channelStore';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

/** CNAM Lookup Panel */
function CnamLookupPanel() {
  const [number, setNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const result = useWsMessage<any>('cnam_result');

  const doLookup = () => {
    if (!number.trim()) return;
    setLoading(true);
    wsSend({ cmd: 'cnam_lookup', number: number.trim() });
    setTimeout(() => setLoading(false), 5000);
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>CNAM Lookup</h2>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={number}
            onChange={e => setNumber(e.target.value)}
            placeholder="Phone number..."
            className="form-input flex-1 !text-sm"
            onKeyDown={e => e.key === 'Enter' && doLookup()}
          />
          <button onClick={doLookup} disabled={loading || !number.trim()} className="btn btn-success btn-sm">
            {loading ? 'Looking up...' : 'Lookup'}
          </button>
        </div>
        {result && (
          <div className="p-3 bg-ct-surface-solid rounded-lg border border-ct-border-solid text-sm space-y-1">
            <div><span className="text-ct-muted">Number:</span> <span className="font-mono text-ct-accent">{result.number}</span></div>
            <div><span className="text-ct-muted">Name:</span> <span className="text-ct-text font-medium">{result.name}</span></div>
            {result.carrier && <div><span className="text-ct-muted">Carrier:</span> <span className="text-ct-purple">{result.carrier}</span></div>}
            {result.lineType && <div><span className="text-ct-muted">Type:</span> <span className="text-ct-text-secondary">{result.lineType}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Quick Dial Panel */
function QuickDialPanel() {
  const { sipUsers, role } = useAuthStore();
  const [destination, setDestination] = useState('');
  const [selectedSip, setSelectedSip] = useState(sipUsers[0] ?? '');

  const doDial = () => {
    if (!destination.trim() || !selectedSip) return;
    wsSend({ cmd: 'originate_call', sipUser: selectedSip, destination: destination.trim() });
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Quick Dial</h2>
      </div>
      <div className="p-4 space-y-3">
        {sipUsers.length > 1 && (
          <select value={selectedSip} onChange={e => setSelectedSip(e.target.value)} className="form-input !text-sm">
            {sipUsers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={destination}
            onChange={e => setDestination(e.target.value)}
            placeholder="Destination number..."
            className="form-input flex-1 !text-sm"
            onKeyDown={e => e.key === 'Enter' && doDial()}
          />
          <button onClick={doDial} disabled={!destination.trim() || !selectedSip} className="btn btn-success btn-sm">
            Call
          </button>
        </div>
        {!selectedSip && (role === 'admin' || role === 'user') && (
          <p className="text-ct-yellow text-xs">Select a specific SIP user to use Quick Dial.</p>
        )}
      </div>
    </div>
  );
}

/** DTMF Capture Panel (simplified — full structured capture shown when listening) */
function DtmfPanel() {
  const { channels } = useChannelStore();
  const activeCalls = channels.filter(ch => ch.state === 'answered');

  return (
    <div className="glass-panel">
      <div className="panel-header" style={{ borderBottomColor: 'rgba(31,111,235,0.2)', background: 'rgba(22,27,34,0.6)', borderRadius: '12px 12px 0 0' }}>
        <h2>DTMF Capture</h2>
      </div>
      <div className="p-4">
        {activeCalls.length === 0 ? (
          <p className="text-ct-muted text-sm">No active calls to capture DTMF from. Start a call first.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-ct-muted text-xs mb-2">Select a call to start capturing DTMF tones:</p>
            {activeCalls.map(ch => (
              <button
                key={ch.id}
                onClick={() => wsSend({ cmd: 'start_listening', channel: ch.id })}
                className="w-full text-left p-3 rounded-lg border border-ct-border-solid bg-ct-bg hover:border-ct-blue transition-colors"
              >
                <div className="font-mono text-sm text-ct-accent">{ch.sipUser}</div>
                <div className="text-xs text-ct-muted mt-0.5">
                  {ch.callerNum || '—'} → {ch.calleeNum || '—'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Live Transcription Panel */
function TranscriptPanel() {
  const { channels } = useChannelStore();
  const activeCalls = channels.filter(ch => ch.state === 'answered');

  return (
    <div className="glass-panel" style={{ border: '1px solid rgba(35,134,54,0.4)', boxShadow: '0 0 16px rgba(35,134,54,0.08), 0 2px 8px rgba(0,0,0,0.2)' }}>
      <div className="panel-header" style={{ borderBottomColor: 'rgba(35,134,54,0.2)', background: 'rgba(22,27,34,0.6)', borderRadius: '12px 12px 0 0' }}>
        <h2>Live Transcription</h2>
      </div>
      <div className="p-4">
        {activeCalls.length === 0 ? (
          <p className="text-ct-muted text-sm">No active calls to transcribe. Start a call first.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-ct-muted text-xs mb-2">Select a call to start live transcription:</p>
            {activeCalls.map(ch => (
              <button
                key={ch.id}
                onClick={() => wsSend({ cmd: 'start_transcript', channel: ch.id })}
                className="w-full text-left p-3 rounded-lg border border-ct-border-solid bg-ct-bg hover:border-ct-green-dark transition-colors"
              >
                <div className="font-mono text-sm text-ct-green">{ch.sipUser}</div>
                <div className="text-xs text-ct-muted mt-0.5">
                  {ch.callerNum || '—'} → {ch.calleeNum || '—'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ToolsTab() {
  const { permissions, role } = useAuthStore();
  const isAdmin = role === 'admin';

  return (
    <div className="space-y-5 animate-fade-in" role="tabpanel" id="panel-tools">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {(isAdmin || permissions.dtmf !== false) && <DtmfPanel />}
        {(isAdmin || permissions.transcript !== false) && <TranscriptPanel />}
        {(isAdmin || permissions.cnam_lookup !== false) && <CnamLookupPanel />}
        {(isAdmin || permissions.quick_dial !== false) && <QuickDialPanel />}
      </div>
    </div>
  );
}
