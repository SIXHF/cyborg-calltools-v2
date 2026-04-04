import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useChannelStore } from '../../stores/channelStore';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

/** CNAM Lookup Panel */
function CnamLookupPanel() {
  const [number, setNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const cnamMsg = useWsMessage<any>('cnam_result');

  useEffect(() => {
    if (cnamMsg) {
      setResult(cnamMsg);
      setLoading(false);
    }
  }, [cnamMsg]);

  const doLookup = () => {
    if (!number.trim()) return;
    setLoading(true);
    setResult(null);
    wsSend({ cmd: 'cnam_lookup', number: number.trim() });
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Caller Name / Carrier Lookup</h2>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="tel"
            value={number}
            onChange={e => setNumber(e.target.value)}
            placeholder="+1 (202) 555-0123"
            className="form-input flex-1 font-mono"
            onKeyDown={e => e.key === 'Enter' && doLookup()}
          />
          <button onClick={doLookup} disabled={loading || !number.trim()} className="btn btn-success btn-sm">
            {loading ? 'Looking up...' : 'Lookup'}
          </button>
        </div>
        {result && (
          <div className="p-3 bg-ct-surface-solid rounded-lg border border-ct-border-solid">
            <div className="flex gap-5 flex-wrap">
              <div>
                <div className="text-[10px] text-ct-muted uppercase tracking-wider mb-1">Caller Name</div>
                <div className="text-sm text-ct-text font-medium">{result.name || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-ct-muted uppercase tracking-wider mb-1">Carrier</div>
                <div className="text-sm text-ct-text font-medium">{result.carrier || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-ct-muted uppercase tracking-wider mb-1">Type</div>
                <div className="text-sm text-ct-text font-medium">{result.lineType || '—'}</div>
              </div>
              {result.state && (
                <div>
                  <div className="text-[10px] text-ct-muted uppercase tracking-wider mb-1">State</div>
                  <div className="text-sm text-ct-text font-medium">{result.state}</div>
                </div>
              )}
              {result.city && (
                <div>
                  <div className="text-[10px] text-ct-muted uppercase tracking-wider mb-1">City</div>
                  <div className="text-sm text-ct-text font-medium">{result.city}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** BIN Lookup Panel — calls /bin-lookup.php directly */
function BinLookupPanel() {
  const [bin, setBin] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const doLookup = async () => {
    const clean = bin.replace(/\D/g, '').slice(0, 8);
    if (clean.length < 6) {
      setError('Enter at least 6 digits');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/bin-lookup.php?bin=${encodeURIComponent(clean)}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      if (data.error || data.valid === false) throw new Error('BIN not found');
      setResult(data);
    } catch {
      setError('BIN not found in database');
    }
    setLoading(false);
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>BIN Lookup</h2>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={bin}
            onChange={e => setBin(e.target.value)}
            placeholder="Enter first 6-8 digits of card number"
            maxLength={8}
            className="form-input flex-1 font-mono"
            onKeyDown={e => e.key === 'Enter' && doLookup()}
          />
          <button onClick={doLookup} disabled={loading || bin.replace(/\D/g, '').length < 6} className="btn btn-success btn-sm">
            {loading ? 'Looking up...' : 'Lookup'}
          </button>
        </div>
        {error && <div className="text-xs text-ct-muted">{error}</div>}
        {result && (
          <div className="p-3 bg-ct-surface-solid rounded-lg border border-ct-border-solid">
            <div className="flex gap-4 flex-wrap">
              {result.brand && (
                <div><div className="text-[10px] text-ct-muted-dark">Brand</div><div className="text-sm text-ct-text-secondary font-medium">{result.brand}</div></div>
              )}
              {result.type && (
                <div><div className="text-[10px] text-ct-muted-dark">Type</div><div className="text-sm text-ct-text-secondary font-medium">{result.type}</div></div>
              )}
              {result.level && (
                <div><div className="text-[10px] text-ct-muted-dark">Level</div><div className="text-sm text-ct-text-secondary font-medium">{result.level}</div></div>
              )}
              {result.bank && (
                <div><div className="text-[10px] text-ct-muted-dark">Bank</div><div className="text-sm text-ct-text-secondary font-medium">{result.bank}</div></div>
              )}
              {result.country && (
                <div><div className="text-[10px] text-ct-muted-dark">Country</div><div className="text-sm text-ct-text-secondary font-medium">{result.emoji || ''} {result.country}</div></div>
              )}
              {result.prepaid && (
                <div><div className="text-[10px] text-ct-muted-dark">Prepaid</div><div className="text-sm text-ct-yellow font-medium">Yes</div></div>
              )}
              {result.phone && (
                <div><div className="text-[10px] text-ct-muted-dark">Phone</div><div className="text-sm text-ct-text-secondary font-mono">{result.phone}</div></div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Quick Dial Panel with Recent Numbers */
function QuickDialPanel() {
  const { sipUsers, role } = useAuthStore();
  const [destination, setDestination] = useState('');
  const [selectedSip, setSelectedSip] = useState(sipUsers[0] ?? '');
  const [recentNumbers, setRecentNumbers] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ct2_recent_numbers') || '[]'); } catch { return []; }
  });

  const doDial = () => {
    if (!destination.trim() || !selectedSip) return;
    const num = destination.trim();
    wsSend({ cmd: 'originate_call', sipUser: selectedSip, destination: num });
    // Save to recent
    const updated = [num, ...recentNumbers.filter(n => n !== num)].slice(0, 8);
    setRecentNumbers(updated);
    localStorage.setItem('ct2_recent_numbers', JSON.stringify(updated));
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
            placeholder="+1 (202) 555-0123"
            className="form-input flex-1 font-mono"
            onKeyDown={e => e.key === 'Enter' && doDial()}
          />
          <button onClick={doDial} disabled={!destination.trim() || !selectedSip} className="btn btn-success btn-sm">
            Dial
          </button>
        </div>
        {!selectedSip && (role === 'admin' || role === 'user') && (
          <p className="text-ct-yellow text-xs">Select a specific SIP user to use Quick Dial.</p>
        )}
        {recentNumbers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] text-ct-muted-dark mr-1">Recent:</span>
            {recentNumbers.map(n => (
              <button
                key={n}
                onClick={() => setDestination(n)}
                className="px-2.5 py-0.5 rounded-xl text-xs font-mono bg-ct-surface-solid border border-ct-border-solid text-ct-accent hover:border-ct-blue transition-colors cursor-pointer"
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** DTMF Capture Panel */
function DtmfPanel() {
  const { channels } = useChannelStore();
  const activeCalls = channels.filter(ch => ch.state === 'answered');

  return (
    <div className="glass-panel" style={{ borderColor: 'rgba(31,111,235,0.2)' }}>
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
        <h2>Live Transcription <span className="text-[10px] font-bold text-white bg-[#5865f2] px-1.5 py-0.5 rounded align-middle ml-1.5 tracking-wider">BETA</span></h2>
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
      {/* V1 layout: single column stacked panels */}
      {(isAdmin || permissions.transcript !== false) && <TranscriptPanel />}
      {(isAdmin || permissions.dtmf !== false) && <DtmfPanel />}
      {(isAdmin || permissions.quick_dial !== false) && <QuickDialPanel />}
      {(isAdmin || permissions.cnam_lookup !== false) && <CnamLookupPanel />}
      <BinLookupPanel />
    </div>
  );
}
