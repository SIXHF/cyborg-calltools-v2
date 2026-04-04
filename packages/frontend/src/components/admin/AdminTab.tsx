import { useEffect, useState } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

/** Stats Dashboard */
function StatsDashboard() {
  const [stats, setStats] = useState<any>(null);
  const statsMsg = useWsMessage<any>('stats_result');

  useEffect(() => {
    wsSend({ cmd: 'get_stats' });
    const interval = setInterval(() => wsSend({ cmd: 'get_stats' }), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (statsMsg?.data) setStats(statsMsg.data);
  }, [statsMsg]);

  if (!stats) return <div className="glass-panel p-6"><p className="text-ct-muted text-sm">Loading stats...</p></div>;

  const cards = [
    { label: 'ACTIVE CALLS', value: stats.active_calls ?? 0, color: '#3fb950' },
    { label: 'CALLS (SHIFT)', value: stats.calls_today ?? 0, color: '#58a6ff' },
    { label: 'ANSWERED', value: stats.answered ?? 0, color: '#3fb950' },
    { label: 'FAILED', value: stats.failed ?? 0, color: '#f85149' },
    { label: 'TOTAL SIP', value: stats.total_sip ?? 0, color: '#58a6ff' },
    { label: 'REGISTERED', value: stats.registered ?? 0, color: '#3fb950' },
    { label: 'CONNECTED USERS', value: stats.connected_users ?? 0, color: '#d2a8ff' },
  ];

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Dashboard</h2>
        <button onClick={() => wsSend({ cmd: 'get_stats' })} className="btn btn-sm">Refresh</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
        {cards.map(c => (
          <div key={c.label} className="bg-ct-surface-solid border border-ct-border-solid rounded-[10px] p-3.5 text-center">
            <div className="text-[28px] font-bold font-mono" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[11px] text-ct-muted uppercase tracking-wider mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* ASR by Trunk */}
      {stats.asr_by_trunk?.length > 0 && (
        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold text-ct-muted uppercase tracking-wider mb-2">ASR by Trunk</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Trunk</th>
                <th>Total</th>
                <th>Answered</th>
                <th>ASR</th>
              </tr>
            </thead>
            <tbody>
              {stats.asr_by_trunk.map((t: any) => (
                <tr key={t.trunk_id}>
                  <td className="font-mono text-ct-accent">{t.trunk_name}</td>
                  <td className="font-mono">{t.total}</td>
                  <td className="font-mono text-ct-green">{t.answered}</td>
                  <td>
                    <span className={`tag ${t.asr >= 50 ? 'tag-up' : t.asr >= 20 ? 'tag-ring' : 'tag-down'}`}>
                      {t.asr}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top Numbers */}
      {stats.top_numbers?.length > 0 && (
        <div className="px-4 pb-4">
          <h3 className="text-xs font-semibold text-ct-muted uppercase tracking-wider mb-2">Top Dialed Numbers</h3>
          <div className="space-y-1">
            {stats.top_numbers.map((n: any, i: number) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b border-ct-border-solid/30 last:border-b-0">
                <span className="font-mono text-ct-text-secondary">{n.number}</span>
                <span className="font-mono text-ct-muted">{n.count} calls</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Sessions Panel */
function SessionsPanel() {
  const [sessions, setSessions] = useState<any[]>([]);
  const sessionsMsg = useWsMessage<any>('online_users');

  useEffect(() => {
    wsSend({ cmd: 'get_sessions' });
    const interval = setInterval(() => wsSend({ cmd: 'get_sessions' }), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (sessionsMsg?.users) setSessions(sessionsMsg.users);
  }, [sessionsMsg]);

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Active Sessions</h2>
        <span className="text-ct-muted text-xs">{sessions.length} connected</span>
      </div>
      {sessions.length === 0 ? (
        <div className="empty-state">No active sessions.</div>
      ) : (
        <div className="p-0">
          {sessions.map((s, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-ct-border-solid/50 last:border-b-0">
              <div className="flex gap-3 items-center text-sm">
                <span className="text-ct-accent font-semibold">{s.username}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-[10px] font-semibold uppercase tracking-wider ${
                  s.role === 'admin' ? 'bg-[#2d1b00] text-ct-yellow' :
                  s.role === 'user' ? 'bg-[#1a1040] text-ct-purple-dark' :
                  'bg-ct-green-bg text-ct-green'
                }`}>
                  {s.role}
                </span>
                {s.sipUser && <span className="text-ct-muted font-mono text-xs">{s.sipUser}</span>}
              </div>
              <span className="text-ct-muted-dark text-xs">{s.ip}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Broadcast Panel */
function BroadcastPanel() {
  const [message, setMessage] = useState('');

  const send = () => {
    if (!message.trim()) return;
    wsSend({ cmd: 'admin_broadcast', message: message.trim() });
    setMessage('');
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Broadcast Message</h2>
      </div>
      <div className="p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Message to broadcast to all users..."
            className="form-input flex-1 !text-sm"
            maxLength={500}
            onKeyDown={e => e.key === 'Enter' && send()}
          />
          <button onClick={send} disabled={!message.trim()} className="btn btn-primary btn-sm">
            Broadcast
          </button>
        </div>
      </div>
    </div>
  );
}

/** Users Overview */
function UsersOverview() {
  const [users, setUsers] = useState<any[]>([]);
  const usersMsg = useWsMessage<any>('users_overview');

  useEffect(() => {
    wsSend({ cmd: 'get_users_overview' });
  }, []);

  useEffect(() => {
    if (usersMsg?.users) setUsers(usersMsg.users);
  }, [usersMsg]);

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>User Accounts</h2>
        <span className="text-ct-muted text-xs">{users.length} accounts</span>
      </div>
      {users.length === 0 ? (
        <div className="empty-state">Loading users...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {users.map(u => (
            <div key={u.id} className="bg-ct-surface-solid border border-ct-border-solid rounded-[10px] p-4 hover:border-ct-border-hover transition-colors">
              <div className="flex justify-between items-center mb-2">
                <span className="text-base font-bold text-ct-accent font-mono">{u.username}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-[10px] font-semibold uppercase tracking-wider ${
                  u.role === 'admin' ? 'bg-[#2d1b00] text-ct-yellow' : 'bg-[#1a1040] text-ct-purple-dark'
                }`}>
                  {u.role}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-ct-muted leading-relaxed">
                <span>Balance:</span>
                <span className={`font-medium ${u.credit < 1 ? 'text-ct-red' : 'text-ct-green'}`}>
                  ${u.credit.toFixed(2)}
                </span>
                <span>SIP Users:</span>
                <span className="text-ct-text-secondary font-medium">{u.sipCount}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminTab() {
  return (
    <div className="space-y-5 animate-fade-in" role="tabpanel" id="panel-admin">
      <StatsDashboard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SessionsPanel />
        <BroadcastPanel />
      </div>
      <UsersOverview />
    </div>
  );
}
