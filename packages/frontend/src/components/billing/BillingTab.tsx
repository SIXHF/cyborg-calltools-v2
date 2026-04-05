import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
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
  const role = useAuthStore(s => s.role);
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

  const selectedSip = useAuthStore(s => s.selectedSipUser);

  // Admin user filter for refill history (V1 line 1572-1576)
  const [filterUserId, setFilterUserId] = useState<number | undefined>(undefined);
  const [userList, setUserList] = useState<{ id: number; username: string; credit: number }[]>([]);
  const usersMsg = useWsMessage<any>('users_overview');

  // Resolve selected SIP/account for backend filtering
  const targetSipParam = selectedSip?.startsWith('account:')
    ? { targetAccount: selectedSip.slice('account:'.length) }
    : selectedSip ? { targetSip: selectedSip } : {};

  // Re-fetch when SIP user changes
  useEffect(() => {
    wsSend({ cmd: 'get_balance', ...targetSipParam });
    wsSend({ cmd: 'get_refill_history', page: 1, perPage: 25, ...targetSipParam });
    // Admin: fetch user list for filter dropdown (V1 line 5154)
    if (role === 'admin') {
      wsSend({ cmd: 'get_users_overview', includeAll: true });
    }
  }, [selectedSip, role]);

  useEffect(() => {
    if (usersMsg?.users) {
      setUserList(usersMsg.users.map((u: any) => ({ id: u.id, username: u.username, credit: parseFloat(u.credit ?? 0) })));
    }
  }, [usersMsg]);

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

  // Clear loading on any error
  useEffect(() => {
    if (errorMsg && rechargeLoading) {
      setRechargeLoading(false);
      setRechargeStatus(`Error: ${errorMsg.message || 'Unknown error'}`);
    }
  }, [errorMsg, rechargeLoading]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadPage = (p: number, overrideFilterUserId?: number | undefined) => {
    setPage(p);
    const fuid = overrideFilterUserId !== undefined ? overrideFilterUserId : filterUserId;
    wsSend({ cmd: 'get_refill_history', page: p, perPage: 25, ...(fuid ? { filterUserId: fuid } : {}), ...targetSipParam });
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
          <button onClick={() => wsSend({ cmd: 'get_balance', ...targetSipParam })} className="btn btn-sm">Refresh</button>
        </div>
        <div className="p-6 text-center">
          <div className="text-[28px] font-bold font-mono" style={{ color: balance !== null && balance < 1 ? '#f85149' : '#3fb950' }}>
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
            {[50, 100, 250].map(amt => (
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

      {/* Manual Credit Adjustment (Admin only) */}
      {role === 'admin' && <ManualCreditSection userList={userList} />}

      {/* Refill History */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Refill History</h2>
          <span className="text-ct-muted text-xs">{totalRefills} total</span>
        </div>
        {/* V1 line 1572-1576: Admin user filter dropdown */}
        {role === 'admin' && (
          <div className="flex gap-2 px-4 py-2 border-b border-ct-border-solid items-center">
            <select
              value={filterUserId ?? ''}
              onChange={e => {
                const val = e.target.value ? parseInt(e.target.value) : undefined;
                setFilterUserId(val);
                setPage(1);
                loadPage(1, val);
              }}
              className="form-input !py-1.5 !px-2.5 !text-xs"
              style={{ minWidth: 160 }}
            >
              <option value="">All Users</option>
              {userList.map(u => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
          </div>
        )}
        {refills.length === 0 ? (
          <div className="empty-state">No refill records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  {role === 'admin' && <th>User</th>}
                  <th>Amount</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {refills.map(r => (
                  <tr key={r.id}>
                    <td className="text-ct-muted text-xs whitespace-nowrap">{new Date(r.date).toLocaleString()}</td>
                    {role === 'admin' && <td className="text-ct-accent font-mono text-xs">{(r as any).username || '—'}</td>}
                    <td className="font-mono font-semibold" style={{ color: r.credit >= 0 ? '#3fb950' : '#f85149' }}>
                      ${r.credit >= 0 ? '+' : ''}{r.credit.toFixed(2)}
                    </td>
                    <td className="text-ct-text-secondary">{r.description || '—'}</td>
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

function ManualCreditSection({ userList }: { userList: { id: number; username: string; credit: number }[] }) {
  const [targetUserId, setTargetUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const creditMsg = useWsMessage<any>('credit_added');

  useEffect(() => {
    if (creditMsg) {
      wsSend({ cmd: 'get_balance' });
      wsSend({ cmd: 'get_refill_history', page: 1, perPage: 25 });
      wsSend({ cmd: 'get_users_overview', includeAll: true });
    }
  }, [creditMsg]);

  const doAddCredit = () => {
    const uid = parseInt(targetUserId);
    const amt = parseFloat(amount);
    if (!uid || isNaN(amt) || !note.trim()) return;
    wsSend({ cmd: 'add_credit', targetUserId: uid, amount: amt, note: note.trim() });
    setAmount('');
    setNote('');
  };

  return (
    <div className="glass-panel">
      <div className="panel-header"><h2>Manual Credit Adjustment</h2></div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <select value={targetUserId} onChange={e => setTargetUserId(e.target.value)} className="form-input !text-sm !w-48">
            <option value="">Select user...</option>
            {userList.map(u => <option key={u.id} value={u.id}>{u.username} (${u.credit.toFixed(2)})</option>)}
          </select>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (+/-)" step="0.01" className="form-input !text-sm !w-32 font-mono" />
        </div>
        <div className="flex gap-2 items-center">
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / Note (required)" maxLength={200} className="form-input !text-sm flex-1" />
          <button onClick={doAddCredit} disabled={!targetUserId || !amount || !note.trim()} className="btn btn-primary btn-sm">Apply Credit</button>
        </div>
      </div>
    </div>
  );
}
