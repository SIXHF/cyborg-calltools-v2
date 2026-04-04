import { useEffect, useState } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

type AdminPage = 'stats' | 'settings' | 'broadcast';

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
    { label: 'CONNECTED', value: stats.connected_users ?? 0, color: '#d2a8ff' },
  ];

  return (
    <div className="space-y-5">
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
              <thead><tr><th>Trunk</th><th>Total</th><th>Answered</th><th>ASR</th></tr></thead>
              <tbody>
                {stats.asr_by_trunk.map((t: any) => (
                  <tr key={t.trunk_id}>
                    <td className="font-mono text-ct-accent">{t.trunk_name}</td>
                    <td className="font-mono">{t.total}</td>
                    <td className="font-mono text-ct-green">{t.answered}</td>
                    <td><span className={`tag ${t.asr >= 50 ? 'tag-up' : t.asr >= 20 ? 'tag-ring' : 'tag-down'}`}>{t.asr}%</span></td>
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

      {/* Users Overview */}
      <UsersOverview />
    </div>
  );
}

/** Users Overview */
function UsersOverview() {
  const [users, setUsers] = useState<any[]>([]);
  const usersMsg = useWsMessage<any>('users_overview');

  useEffect(() => {
    wsSend({ cmd: 'get_users_overview' });
    const interval = setInterval(() => wsSend({ cmd: 'get_users_overview' }), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { if (usersMsg?.users) setUsers(usersMsg.users); }, [usersMsg]);

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
                }`}>{u.role}</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-ct-muted leading-relaxed">
                <span>Balance:</span>
                <span className={`font-medium ${u.credit < 1 ? 'text-ct-red' : 'text-ct-green'}`}>${u.credit.toFixed(2)}</span>
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

/** Sessions Panel with Force Logout */
function SessionsPanel() {
  const [sessions, setSessions] = useState<any[]>([]);
  const sessionsMsg = useWsMessage<any>('online_users');

  useEffect(() => {
    wsSend({ cmd: 'get_sessions' });
    const interval = setInterval(() => wsSend({ cmd: 'get_sessions' }), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { if (sessionsMsg?.users) setSessions(sessionsMsg.users); }, [sessionsMsg]);

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Active Sessions</h2>
        <div className="flex items-center gap-2">
          <span className="text-ct-muted text-xs">{sessions.length} connected</span>
          <button onClick={() => wsSend({ cmd: 'get_sessions' })} className="btn btn-sm">Refresh</button>
        </div>
      </div>
      {sessions.length === 0 ? (
        <div className="empty-state">No active sessions.</div>
      ) : (
        <div>
          {sessions.map((s, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-ct-border-solid/50 last:border-b-0">
              <div className="flex gap-3 items-center text-sm">
                <span className="w-2 h-2 rounded-full bg-ct-green" style={{ boxShadow: '0 0 6px #3fb95066' }} />
                <span className="text-ct-accent font-semibold">{s.username}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-[10px] font-semibold uppercase tracking-wider ${
                  s.role === 'admin' ? 'bg-[#2d1b00] text-ct-yellow' :
                  s.role === 'user' ? 'bg-[#1a1040] text-ct-purple-dark' :
                  'bg-ct-green-bg text-ct-green'
                }`}>{s.role}</span>
                {s.sipUser && <span className="text-ct-muted font-mono text-xs">{s.sipUser}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-ct-muted-dark text-xs">{s.ip}</span>
                <button
                  onClick={() => {
                    if (confirm(`Force logout ${s.username}?`)) {
                      wsSend({ cmd: 'admin_force_logout', targetToken: s.tokenPrefix || '' });
                    }
                  }}
                  className="btn btn-sm btn-danger"
                  style={{ padding: '2px 8px', fontSize: '10px' }}
                >
                  Kick
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Permissions Manager */
function PermissionsPanel() {
  const [config, setConfig] = useState<any>(null);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [targetPerms, setTargetPerms] = useState<Record<string, boolean>>({});
  const [sipList, setSipList] = useState<string[]>([]);
  const permMsg = useWsMessage<any>('permissions_data');

  useEffect(() => {
    wsSend({ cmd: 'get_permissions' });
  }, []);

  useEffect(() => {
    if (permMsg?.config) {
      setConfig(permMsg.config);
      // Build SIP user list from admin_restrictions keys
      const sips = Object.keys(permMsg.config.admin_restrictions || {});
      setSipList(sips);
    }
  }, [permMsg]);

  const loadPerms = (target: string) => {
    setSelectedTarget(target);
    if (config?.admin_restrictions?.[target]) {
      setTargetPerms(config.admin_restrictions[target]);
    } else {
      // defaults
      setTargetPerms(config?.defaults || {});
    }
  };

  const togglePerm = (key: string) => {
    setTargetPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const save = () => {
    if (!selectedTarget) return;
    wsSend({ cmd: 'admin_set_permissions', target: selectedTarget, permissions: targetPerms });
  };

  const tools = [
    { key: 'dtmf', label: 'DTMF Capture' },
    { key: 'transcript', label: 'Live Transcription' },
    { key: 'audio_player', label: 'Audio Player' },
    { key: 'caller_id', label: 'Caller ID' },
    { key: 'moh', label: 'Music on Hold' },
    { key: 'quick_dial', label: 'Quick Dial' },
    { key: 'cdr', label: 'Call History (CDR)' },
    { key: 'billing', label: 'Billing' },
    { key: 'allow_tollfree_callerid', label: 'Toll-Free Caller ID' },
    { key: 'cnam_lookup', label: 'CNAM Lookup' },
    { key: 'call_cost', label: 'Call Cost Display' },
  ];

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Permissions Manager</h2>
      </div>
      <div className="p-4 border-b border-ct-border-solid">
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="text"
            list="sip-targets"
            value={selectedTarget}
            onChange={e => setSelectedTarget(e.target.value)}
            placeholder="SIP user or account name..."
            className="form-input !text-sm flex-1"
          />
          <datalist id="sip-targets">
            {sipList.map(s => <option key={s} value={s} />)}
          </datalist>
          <button onClick={() => loadPerms(selectedTarget)} className="btn btn-sm">Load</button>
          <button onClick={save} className="btn btn-sm btn-primary">Save</button>
        </div>
      </div>
      {selectedTarget ? (
        <div>
          {tools.map(t => (
            <div key={t.key} className="flex items-center justify-between px-4 py-2 border-b border-ct-border-solid/30 last:border-b-0">
              <span className="text-[13px] text-ct-text-secondary font-medium">{t.label}</span>
              <label className="relative inline-block w-9 h-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={targetPerms[t.key] !== false}
                  onChange={() => togglePerm(t.key)}
                  className="sr-only peer"
                />
                <span className="absolute inset-0 rounded-full bg-ct-border-solid transition-colors peer-checked:bg-ct-green-dark" />
                <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-ct-text-secondary transition-transform peer-checked:translate-x-4" />
              </label>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">Select a user or SIP user to manage permissions.</div>
      )}
    </div>
  );
}

/** Access Control Panel */
function AccessControlPanel() {
  const [config, setConfig] = useState<any>(null);
  const [newAccount, setNewAccount] = useState('');
  const permMsg = useWsMessage<any>('permissions_data');

  useEffect(() => { wsSend({ cmd: 'get_permissions' }); }, []);
  useEffect(() => { if (permMsg?.config) setConfig(permMsg.config); }, [permMsg]);

  const allowedAccounts: string[] = config?.allowed_accounts || [];

  const addAccount = () => {
    if (!newAccount.trim() || allowedAccounts.includes(newAccount.trim())) return;
    wsSend({ cmd: 'admin_set_permissions', target: '__access_control__', permissions: { action: 'add', account: newAccount.trim() } as any });
    // Optimistic update
    setConfig({ ...config, allowed_accounts: [...allowedAccounts, newAccount.trim()] });
    setNewAccount('');
  };

  const removeAccount = (name: string) => {
    wsSend({ cmd: 'admin_set_permissions', target: '__access_control__', permissions: { action: 'remove', account: name } as any });
    setConfig({ ...config, allowed_accounts: allowedAccounts.filter(a => a !== name) });
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Access Control</h2>
        <span className="text-ct-muted text-xs">{allowedAccounts.length} accounts enabled</span>
      </div>
      <div className="p-4 border-b border-ct-border-solid">
        <div className="flex gap-2">
          <input
            type="text"
            value={newAccount}
            onChange={e => setNewAccount(e.target.value)}
            placeholder="Account username to enable..."
            className="form-input !text-sm flex-1"
            onKeyDown={e => e.key === 'Enter' && addAccount()}
          />
          <button onClick={addAccount} className="btn btn-sm btn-success">Add</button>
        </div>
        <div className="text-[11px] text-ct-muted-dark mt-2">Admins always have access. Users are denied by default until added here.</div>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {allowedAccounts.map(name => (
          <div key={name} className="flex items-center justify-between px-4 py-2 border-b border-ct-border-solid/30 last:border-b-0">
            <span className="text-[13px] text-ct-accent font-mono">{name}</span>
            <button onClick={() => removeAccount(name)} className="text-ct-red text-xs hover:underline">Remove</button>
          </div>
        ))}
        {allowedAccounts.length === 0 && <div className="empty-state">No accounts in access list (all accounts allowed).</div>}
      </div>
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
        <h2>Send Broadcast</h2>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="block text-[13px] text-ct-muted mb-1">Message</label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Message to broadcast to all users..."
            className="form-input !h-20 resize-none"
            maxLength={500}
          />
          <div className="text-[11px] text-ct-muted-dark mt-1">{message.length}/500</div>
        </div>
        <button onClick={send} disabled={!message.trim()} className="btn btn-primary">
          Send Broadcast
        </button>
      </div>
    </div>
  );
}

/** Main Admin Tab with Sub-Navigation */
export function AdminTab() {
  const [page, setPage] = useState<AdminPage>('stats');

  const pages: { id: AdminPage; label: string }[] = [
    { id: 'stats', label: 'Dashboard' },
    { id: 'settings', label: 'Settings' },
    { id: 'broadcast', label: 'Broadcast' },
  ];

  return (
    <div className="space-y-4 animate-fade-in" role="tabpanel" id="panel-admin">
      {/* Sub-navigation */}
      <div className="flex gap-1">
        {pages.map(p => (
          <button
            key={p.id}
            onClick={() => setPage(p.id)}
            className={`tab-btn-v1 ${page === p.id ? 'active' : ''}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Stats Page */}
      {page === 'stats' && <StatsDashboard />}

      {/* Settings Page */}
      {page === 'settings' && (
        <div className="space-y-5">
          <AccessControlPanel />
          <PermissionsPanel />
          <SessionsPanel />
        </div>
      )}

      {/* Broadcast Page */}
      {page === 'broadcast' && <BroadcastPanel />}
    </div>
  );
}
