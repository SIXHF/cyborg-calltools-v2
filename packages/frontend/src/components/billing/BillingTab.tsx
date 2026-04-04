import { useEffect, useState, useRef } from 'react';
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
  const [rechargeAmt, setRechargeAmt] = useState('');
  const [rechargeStatus, setRechargeStatus] = useState('');
  const [rechargeUrl, setRechargeUrl] = useState('');
  const [rechargeLoading, setRechargeLoading] = useState(false);

  const balanceMsg = useWsMessage<any>('billing_update');
  const refillMsg = useWsMessage<any>('refill_history');
  const paymentMsg = useWsMessage<any>('payment_created');
  const errorMsg = useWsMessage<any>('error');

  useEffect(() => {
    wsSend({ cmd: 'get_balance' });
    wsSend({ cmd: 'get_refill_history', page: 1, perPage: 25 });
  }, []);

  useEffect(() => { if (balanceMsg) setBalance(balanceMsg.balance); }, [balanceMsg]);
  useEffect(() => {
    if (refillMsg) { setRefills(refillMsg.records ?? []); setTotalRefills(refillMsg.total ?? 0); }
  }, [refillMsg]);

  // Balance polling after payment (V1 parity)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (paymentMsg) {
      setRechargeLoading(false);
      const url = paymentMsg.payment_url;
      if (url) {
        setRechargeUrl(url);
        const win = window.open(url, '_blank');
        setRechargeStatus(win ? 'Invoice created! Payment page opened. Watching for payment...' : 'Invoice created! Click the link below to pay.');
      }
      // Start polling balance every 15s for up to 1 hour
      if (pollRef.current) clearInterval(pollRef.current);
      const preBalance = balance;
      pollRef.current = setInterval(() => wsSend({ cmd: 'get_balance' }), 15000);
      // Stop after 1 hour
      setTimeout(() => { if (pollRef.current) clearInterval(pollRef.current); }, 3600000);
    }
  }, [paymentMsg]);

  // Clear loading on any error (Bug 2.1 fix)
  useEffect(() => {
    if (errorMsg && rechargeLoading) {
      setRechargeLoading(false);
      setRechargeStatus(`Error: ${errorMsg.message || 'Unknown error'}`);
    }
  }, [errorMsg]);

  const loadPage = (p: number) => {
    setPage(p);
    wsSend({ cmd: 'get_refill_history', page: p, perPage: 25 });
  };

  const handleRecharge = () => {
    const amt = parseFloat(rechargeAmt);
    if (isNaN(amt) || amt < 50 || amt > 10000) {
      setRechargeStatus('Minimum $50, maximum $10,000.');
      return;
    }
    setRechargeLoading(true);
    setRechargeStatus('Creating Heleket invoice...');
    wsSend({ cmd: 'create_payment', amount: amt });
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
          <div className="text-ct-muted text-sm mt-1">USDT Balance</div>
        </div>
      </div>

      {/* Recharge with USDT */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Recharge with USDT</h2>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {[50, 100, 250, 500].map(amt => (
              <button key={amt} onClick={() => setRechargeAmt(String(amt))} className="btn btn-sm">
                ${amt}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="number"
              value={rechargeAmt}
              onChange={e => setRechargeAmt(e.target.value)}
              placeholder="Min $50"
              min={50}
              max={10000}
              step={0.01}
              className="form-input !w-40 font-mono"
            />
            <button onClick={handleRecharge} disabled={rechargeLoading} className="btn btn-primary">
              {rechargeLoading ? 'Creating invoice...' : 'Recharge'}
            </button>
          </div>
          {rechargeStatus && (
            <div className="text-[13px]" style={{ color: rechargeStatus.includes('Error') ? '#f85149' : rechargeStatus.includes('invoice') ? '#d29922' : '#3fb950' }}>
              {rechargeStatus}
            </div>
          )}
          {rechargeUrl && (
            <a href={rechargeUrl} target="_blank" rel="noopener noreferrer" className="text-ct-accent underline font-bold text-sm">
              Click here to open the payment page
            </a>
          )}
          <div className="text-[11px] text-ct-muted-dark">0.4% processing fee may apply. Invoice valid for 1 hour.</div>
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
                <tr><th>Date</th><th>Amount</th><th>Description</th><th>Payment</th></tr>
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
