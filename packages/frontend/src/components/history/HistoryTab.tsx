import { useEffect, useState } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

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

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function statusBadge(status: string) {
  switch (status) {
    case 'answered': return 'tag-up';
    case 'busy': return 'tag-ring';
    case 'noanswer': return 'tag-ring';
    default: return 'tag-down';
  }
}

export function HistoryTab() {
  const [records, setRecords] = useState<CdrRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const cdrMsg = useWsMessage<any>('cdr_result');

  useEffect(() => {
    fetchCdr(1);
  }, []);

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
    });
  };

  return (
    <div className="space-y-5 animate-fade-in" role="tabpanel" id="panel-history">
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
                      <span className={`tag ${statusBadge(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="font-mono text-xs text-ct-yellow">
                      {r.cost > 0 ? `$${r.cost.toFixed(4)}` : '—'}
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
    </div>
  );
}
