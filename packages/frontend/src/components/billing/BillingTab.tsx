import { useEffect, useState } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

interface RefillRecord {
  id: number;
  date: string;
  credit: number;
  description: string;
  payment: string;
}

export function BillingTab() {
  const [balance, setBalance] = useState<number | null>(null);
  const [refills, setRefills] = useState<RefillRecord[]>([]);
  const [totalRefills, setTotalRefills] = useState(0);
  const [page, setPage] = useState(1);

  const balanceMsg = useWsMessage<any>('billing_update');
  const refillMsg = useWsMessage<any>('refill_history');

  // Fetch on mount
  useEffect(() => {
    wsSend({ cmd: 'get_balance' });
    wsSend({ cmd: 'get_refill_history', page: 1, perPage: 25 });
  }, []);

  useEffect(() => {
    if (balanceMsg) setBalance(balanceMsg.balance);
  }, [balanceMsg]);

  useEffect(() => {
    if (refillMsg) {
      setRefills(refillMsg.records ?? []);
      setTotalRefills(refillMsg.total ?? 0);
    }
  }, [refillMsg]);

  const loadPage = (p: number) => {
    setPage(p);
    wsSend({ cmd: 'get_refill_history', page: p, perPage: 25 });
  };

  return (
    <div className="space-y-5 animate-fade-in" role="tabpanel" id="panel-billing">
      {/* Balance Card */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Account Balance</h2>
          <button onClick={() => wsSend({ cmd: 'get_balance' })} className="btn btn-sm">Refresh</button>
        </div>
        <div className="p-6 text-center">
          <div className="text-4xl font-bold font-mono" style={{ color: balance !== null && balance < 1 ? '#f85149' : '#3fb950' }}>
            {balance !== null ? `$${balance.toFixed(2)}` : '—'}
          </div>
          <div className="text-ct-muted text-sm mt-1">Current Credit Balance</div>
        </div>
      </div>

      {/* Refill History */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Refill History</h2>
          <span className="text-ct-muted text-xs">{totalRefills} total</span>
        </div>
        {refills.length === 0 ? (
          <div className="empty-state">No refill records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {refills.map(r => (
                  <tr key={r.id}>
                    <td className="text-ct-muted text-xs whitespace-nowrap">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="font-mono text-ct-green font-semibold">${r.credit.toFixed(2)}</td>
                    <td className="text-ct-text-secondary">{r.description || '—'}</td>
                    <td className="text-ct-muted">{r.payment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalRefills > 25 && (
          <div className="flex items-center justify-center gap-2 p-3">
            <button onClick={() => loadPage(page - 1)} disabled={page <= 1} className="btn btn-sm">Prev</button>
            <span className="text-xs text-ct-muted">Page {page}</span>
            <button onClick={() => loadPage(page + 1)} disabled={page * 25 >= totalRefills} className="btn btn-sm">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
