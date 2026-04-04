import { useEffect, useState } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

type AdminPage = 'stats' | 'settings' | 'broadcast';

// ── Helpers ──

function formatDuration(secs: number): string {
  if (!secs) return '0s';
  const totalSecs = Math.round(secs);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatMoney(v: number): string { return `$${v.toFixed(2)}`; }

// ── Stats Dashboard (V1 parity: 17+ stat cards) ──

function StatsDashboard() {
  const [stats, setStats] = useState<any>(null);
  const statsMsg = useWsMessage<any>('stats_result');

  useEffect(() => {
    wsSend({ cmd: 'get_stats' });
    const interval = setInterval(() => wsSend({ cmd: 'get_stats' }), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { if (statsMsg?.data) setStats(statsMsg.data); }, [statsMsg]);

  if (!stats) return <div className="glass-panel p-6"><p className="text-ct-muted text-sm">Loading stats...</p></div>;

  const cards: { label: string; value: string | number; color: string }[] = [
    { label: 'ACTIVE CALLS', value: stats.active_calls ?? 0, color: '#3fb950' },
    { label: 'CALLS (SHIFT)', value: stats.calls_today ?? 0, color: '#58a6ff' },
    { label: 'ANSWERED', value: stats.answered ?? 0, color: '#3fb950' },
    { label: 'FAILED', value: stats.failed ?? 0, color: '#f85149' },
    { label: 'REGISTERED', value: stats.registered ?? 0, color: '#3fb950' },
    { label: 'TOTAL SIP', value: stats.total_sip ?? 0, color: '#58a6ff' },
    { label: 'ASR %', value: `${stats.asr_percent ?? 0}%`, color: '#58a6ff' },
    { label: 'ACD', value: formatDuration(stats.acd_seconds ?? 0), color: '#58a6ff' },
    { label: 'COST TODAY', value: formatMoney(stats.total_cost ?? 0), color: '#f85149' },
    { label: 'REVENUE TODAY', value: formatMoney(stats.total_revenue ?? 0), color: '#3fb950' },
    { label: 'PROFIT TODAY', value: formatMoney(stats.profit ?? 0), color: stats.profit >= 0 ? '#3fb950' : '#f85149' },
    { label: 'MINUTES BILLED', value: stats.total_minutes ?? 0, color: '#58a6ff' },
    { label: 'PEAK CPS', value: stats.peak_cps ?? 0, color: '#58a6ff' },
    { label: 'PEAK CC', value: stats.peak_cc ?? 0, color: '#58a6ff' },
    { label: 'REFILLS TODAY', value: formatMoney(stats.refills_today ?? 0), color: '#d29922' },
    { label: 'USERS ONLINE', value: stats.connected_users ?? 0, color: '#3fb950' },
    { label: 'LONGEST CALL', value: formatDuration(stats.longest_call ?? 0), color: '#58a6ff' },
  ];

  return (
    <div className="space-y-5">
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Dashboard <span className="text-xs text-ct-muted font-normal ml-2">{stats.shift_start ? `Shift: ${stats.shift_start}` : ''}</span></h2>
          <button onClick={() => wsSend({ cmd: 'get_stats' })} className="btn btn-sm">Refresh</button>
        </div>

        {/* Stat Cards — V1 layout */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
          {cards.map(c => (
            <div key={c.label} className="bg-ct-surface-solid border border-ct-border-solid rounded-[10px] p-3.5 text-center overflow-hidden">
              <div className="text-[28px] font-bold font-mono" style={{ color: c.color }}>{c.value}</div>
              <div className="text-[11px] text-ct-muted uppercase tracking-wider mt-1">{c.label}</div>
            </div>
          ))}
        </div>

        {/* Trunk Failover Groups */}
        {stats.trunk_groups && Object.keys(stats.trunk_groups).length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-ct-muted uppercase tracking-wider mb-2">Trunk Failover Groups</h3>
            {Object.entries(stats.trunk_groups).map(([name, group]: [string, any]) => (
              <div key={name} className="mb-2 p-3 bg-ct-surface-solid border border-ct-border-solid rounded-lg">
                <div className="text-sm font-semibold text-ct-accent">{name} <span className="text-ct-muted text-xs font-normal">({group.type})</span></div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {group.trunks.map((t: any, i: number) => (
                    <span key={i} className="text-xs font-mono bg-ct-bg px-2 py-0.5 rounded border border-ct-border-solid">
                      {t.name}{t.balance != null && (
                        <span style={{ color: t.balance < 10 ? '#f85149' : t.balance < 50 ? '#d29922' : '#3fb950', marginLeft: 4 }}>
                          (${t.balance.toFixed(2)})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

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

        {/* Trunk Performance */}
        {stats.trunk_performance?.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-ct-muted uppercase tracking-wider mb-2">Trunk Performance</h3>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Trunk</th><th>Calls</th><th>ACD</th><th>Cost</th><th>Revenue</th></tr></thead>
                <tbody>
                  {stats.trunk_performance.map((t: any) => (
                    <tr key={t.trunk_id}>
                      <td className="font-mono text-ct-accent">{t.trunk_name}</td>
                      <td className="font-mono">{t.answered}</td>
                      <td className="font-mono">{formatDuration(t.acd_seconds)}</td>
                      <td className="font-mono text-ct-red">${t.total_cost.toFixed(2)}</td>
                      <td className="font-mono text-ct-green">${t.total_revenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

        {/* Top Error Caller IDs */}
        {stats.top_error_callerids?.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-ct-muted uppercase tracking-wider mb-2">Top Failed Caller IDs</h3>
            <table className="data-table">
              <thead><tr><th>Caller ID</th><th>Trunk</th><th>Failures</th></tr></thead>
              <tbody>
                {stats.top_error_callerids.map((c: any, i: number) => (
                  <tr key={i}>
                    <td className="font-mono text-ct-red">{c.number}</td>
                    <td className="text-ct-muted">{c.trunk_name}</td>
                    <td className="font-mono">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Error Breakdown by Trunk */}
        {stats.error_by_trunk?.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-ct-muted uppercase tracking-wider mb-2">Error Breakdown by Trunk</h3>
            <table className="data-table">
              <thead><tr><th>Trunk</th><th>Total Errors</th><th>Breakdown</th></tr></thead>
              <tbody>
                {stats.error_by_trunk.map((t: any) => (
                  <tr key={t.trunk_id}>
                    <td className="font-mono text-ct-accent">{t.trunk_name}</td>
                    <td className="font-mono text-ct-red">{t.total_errors}</td>
                    <td className="text-xs text-ct-muted">
                      {Object.entries(t.codes || {}).filter(([_, v]) => (v as number) > 0).map(([code, count]) => (
                        <span key={code} className="inline-block mr-2">
                          <span className="text-ct-muted-dark">{(CAUSE_LABELS as any)[code] || code}:</span> {count as number}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Top Error Users */}
        {stats.top_error_users?.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-ct-muted uppercase tracking-wider mb-2">Top Error Users</h3>
            <table className="data-table">
              <thead><tr><th>User</th><th>Errors</th><th>Top Error</th><th>Trunk</th></tr></thead>
              <tbody>
                {stats.top_error_users.map((u: any, i: number) => (
                  <tr key={i}>
                    <td className="font-mono text-ct-accent">{u.src}</td>
                    <td className="font-mono text-ct-red">{u.errors}</td>
                    <td className="text-ct-muted">{(CAUSE_LABELS as any)[u.top_error_code] || u.top_error_code}</td>
                    <td className="text-ct-muted">{u.trunk_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Users Overview with expandable SIP details */}
      <UsersOverview />
    </div>
  );
}

const CAUSE_LABELS: Record<string, string> = {
  '0': 'Unknown', '1': 'Answered', '2': 'Busy', '3': 'No Answer',
  '4': 'Error', '5': 'Congestion', '6': 'Failed', '7': 'Cancel', '8': 'Unavailable',
};

// ── Users Overview (V1: expandable cards with SIP details) ──

function UsersOverview() {
  const [users, setUsers] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
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
        <h2>Users</h2>
        <span className="text-ct-muted text-xs">{users.length} accounts</span>
      </div>
      {users.length === 0 ? (
        <div className="empty-state">Loading users...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {users.map(u => (
            <div
              key={u.id}
              className={`bg-ct-surface-solid border rounded-[10px] p-4 cursor-pointer transition-all ${expandedId === u.id ? 'border-ct-blue' : 'border-ct-border-solid hover:border-ct-border-hover'}`}
              onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
            >
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
                {u.lastRefill && <>
                  <span>Last Refill:</span>
                  <span className="text-ct-text-secondary">{new Date(u.lastRefill).toLocaleDateString()}{u.lastRefillAmount != null ? ` ($${u.lastRefillAmount.toFixed(2)})` : ''}</span>
                </>}
              </div>

              {/* Expandable SIP Details */}
              {expandedId === u.id && u.sipUsers?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-ct-border-solid space-y-2">
                  {u.sipUsers.map((sip: any) => (
                    <div key={sip.extension} className="bg-ct-bg border border-ct-border-solid rounded-lg p-2.5">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-semibold text-ct-accent font-mono">{sip.extension}</span>
                      </div>
                      <div className="text-[11px] text-ct-muted leading-relaxed">
                        CallerID: {sip.callerid || 'Not set'}<br/>
                        Codecs: {sip.codecs || 'default'}<br/>
                        Host: {sip.host}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {u.sipCount > 0 && (
                <div className="text-[11px] text-ct-muted-dark text-center mt-2">{expandedId === u.id ? '▲ collapse' : '▼ expand SIP details'}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sessions Panel with Force Logout ──

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
      {sessions.length === 0 ? <div className="empty-state">No active sessions.</div> : (
        <div>
          {sessions.map((s, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-ct-border-solid/50 last:border-b-0 flex-wrap gap-2">
              <div className="flex gap-3 items-center text-sm">
                <span className="w-2 h-2 rounded-full bg-ct-green" style={{ boxShadow: '0 0 6px #3fb95066' }} />
                <span className="text-ct-accent font-semibold">{s.username}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-[10px] font-semibold uppercase tracking-wider ${
                  s.role === 'admin' ? 'bg-[#2d1b00] text-ct-yellow' : s.role === 'user' ? 'bg-[#1a1040] text-ct-purple-dark' : 'bg-ct-green-bg text-ct-green'
                }`}>{s.role}</span>
                {s.sipUser && <span className="text-ct-muted font-mono text-xs">{s.sipUser}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-ct-muted-dark text-xs">{s.ip}</span>
                <button onClick={() => { if (confirm(`Force logout ${s.username}?`)) wsSend({ cmd: 'admin_force_logout', targetToken: s.tokenPrefix || '' }); }}
                  className="btn btn-sm btn-danger" style={{ padding: '2px 8px', fontSize: '10px' }}>Kick</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Permissions Manager ──

function PermissionsPanel() {
  const [config, setConfig] = useState<any>(null);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [targetPerms, setTargetPerms] = useState<Record<string, boolean>>({});
  const [sipList, setSipList] = useState<string[]>([]);
  const permMsg = useWsMessage<any>('permissions_data');

  useEffect(() => { wsSend({ cmd: 'get_permissions' }); }, []);
  useEffect(() => {
    if (permMsg?.config) {
      setConfig(permMsg.config);
      const sips = Object.keys(permMsg.config.admin_restrictions || {});
      setSipList(sips);
      // Refresh current target if set
      if (selectedTarget && permMsg.config.admin_restrictions?.[selectedTarget]) {
        setTargetPerms({ ...permMsg.config.defaults, ...permMsg.config.admin_restrictions[selectedTarget] });
      }
    }
  }, [permMsg, selectedTarget]);

  const loadPerms = (target: string) => {
    setSelectedTarget(target);
    if (config?.admin_restrictions?.[target]) {
      setTargetPerms({ ...config.defaults, ...config.admin_restrictions[target] });
    } else {
      setTargetPerms(config?.defaults || {});
    }
  };

  const togglePerm = (key: string) => setTargetPerms(prev => ({ ...prev, [key]: !prev[key] }));

  const save = () => {
    if (!selectedTarget) return;
    wsSend({ cmd: 'admin_set_permissions', target: selectedTarget, permissions: targetPerms });
  };

  const tools = [
    { key: 'dtmf', label: 'DTMF Capture' }, { key: 'transcript', label: 'Live Transcription' },
    { key: 'audio_player', label: 'Audio Player' }, { key: 'caller_id', label: 'Caller ID' },
    { key: 'moh', label: 'Music on Hold' }, { key: 'quick_dial', label: 'Quick Dial' },
    { key: 'cdr', label: 'Call History (CDR)' }, { key: 'billing', label: 'Billing' },
    { key: 'allow_tollfree_callerid', label: 'Toll-Free Caller ID' },
    { key: 'cnam_lookup', label: 'CNAM Lookup' }, { key: 'call_cost', label: 'Call Cost Display' },
  ];

  return (
    <div className="glass-panel">
      <div className="panel-header"><h2>Permissions Manager</h2></div>
      <div className="p-4 border-b border-ct-border-solid">
        <div className="flex gap-2 items-center flex-wrap">
          <input type="text" list="sip-targets" value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)}
            placeholder="SIP user or account name..." className="form-input !text-sm flex-1" />
          <datalist id="sip-targets">{sipList.map(s => <option key={s} value={s} />)}</datalist>
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
                <input type="checkbox" checked={targetPerms[t.key] !== false} onChange={() => togglePerm(t.key)} className="sr-only peer" />
                <span className="absolute inset-0 rounded-full bg-ct-border-solid transition-colors peer-checked:bg-ct-green-dark" />
                <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-ct-text-secondary transition-transform peer-checked:translate-x-4" />
              </label>
            </div>
          ))}
        </div>
      ) : <div className="empty-state">Select a user or SIP user to manage permissions.</div>}
    </div>
  );
}

// ── Access Control Panel ──

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
          <input type="text" value={newAccount} onChange={e => setNewAccount(e.target.value)} placeholder="Account username to enable..."
            className="form-input !text-sm flex-1" onKeyDown={e => e.key === 'Enter' && addAccount()} />
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
        {allowedAccounts.length === 0 && <div className="empty-state">No accounts in access list — all non-admin users can log in.</div>}
      </div>
    </div>
  );
}

// ── Global Settings Panel ──

function GlobalSettingsPanel() {
  const [config, setConfig] = useState<any>(null);
  const permMsg = useWsMessage<any>('permissions_data');

  useEffect(() => { wsSend({ cmd: 'get_permissions' }); }, []);
  useEffect(() => { if (permMsg?.config) setConfig(permMsg.config); }, [permMsg]);

  const defaults = config?.defaults || {};

  const toggleGlobal = (key: string) => {
    const newValue = !defaults[key];
    wsSend({ cmd: 'set_global_settings', key, value: newValue });
    // Optimistic update
    setConfig({ ...config, defaults: { ...defaults, [key]: newValue } });
  };

  const globalSettings = [
    { key: 'allow_tollfree_callerid', label: 'Allow Toll-Free Caller ID (18XX)', desc: 'When disabled, users cannot set toll-free numbers (800, 833, 844, 855, 866, 877, 888) as caller ID. Applies to all users.' },
    { key: 'call_cost', label: 'Show Call Cost to Users', desc: 'Display real-time call cost and balance per channel for non-admin users.' },
  ];

  return (
    <div className="glass-panel">
      <div className="panel-header"><h2>Global Settings</h2></div>
      <div>
        {globalSettings.map(s => (
          <div key={s.key} className="flex items-center justify-between px-5 py-3 border-b border-ct-border-solid/50 last:border-b-0">
            <div>
              <div className="text-[13px] text-ct-text-secondary font-medium">{s.label}</div>
              <div className="text-[11px] text-ct-muted-dark mt-0.5">{s.desc}</div>
            </div>
            <label className="relative inline-block w-9 h-5 cursor-pointer">
              <input type="checkbox" checked={defaults[s.key] !== false} onChange={() => toggleGlobal(s.key)} className="sr-only peer" />
              <span className="absolute inset-0 rounded-full bg-ct-border-solid transition-colors peer-checked:bg-ct-green-dark" />
              <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-ct-text-secondary transition-transform peer-checked:translate-x-4" />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Audit Log Viewer ──

function AuditLogPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const auditMsg = useWsMessage<any>('audit_log');

  useEffect(() => { wsSend({ cmd: 'get_audit_log' }); }, []);
  useEffect(() => { if (auditMsg?.lines) setLines(auditMsg.lines); }, [auditMsg]);

  const doFilter = () => wsSend({ cmd: 'get_audit_log', actor: actorFilter || undefined, action: actionFilter || undefined });

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Audit Log</h2>
        <button onClick={doFilter} className="btn btn-sm">Refresh</button>
      </div>
      <div className="flex gap-2 p-3 border-b border-ct-border-solid flex-wrap items-center">
        <input type="text" value={actorFilter} onChange={e => setActorFilter(e.target.value)} placeholder="Actor..." className="form-input !py-1.5 !px-2.5 !text-xs !w-28" />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="form-input !py-1.5 !px-2.5 !text-xs !w-36">
          <option value="">All actions</option>
          {['login', 'logout', 'login_denied', 'start_listening', 'set_callerid', 'originate_call', 'transfer_call', 'set_permissions', 'set_access', 'force_logout', 'broadcast', 'add_credit'].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button onClick={doFilter} className="btn btn-sm">Filter</button>
      </div>
      <div className="max-h-[400px] overflow-y-auto p-3 font-mono text-xs text-ct-muted space-y-0.5">
        {lines.length === 0 ? <div className="empty-state">No audit log entries.</div>
          : lines.map((line, i) => <div key={i} className="py-0.5 border-b border-ct-border-solid/20 last:border-b-0">{line}</div>)}
      </div>
    </div>
  );
}

// ── Manual Credit Panel ──

function ManualCreditPanel() {
  const [targetUserId, setTargetUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const usersMsg = useWsMessage<any>('users_overview');

  // Fetch users on mount (Bug 20 fix — don't rely on UsersOverview being mounted)
  useEffect(() => { wsSend({ cmd: 'get_users_overview' }); }, []);
  useEffect(() => { if (usersMsg?.users) setUsers(usersMsg.users); }, [usersMsg]);

  const doAddCredit = () => {
    const uid = parseInt(targetUserId); const amt = parseFloat(amount);
    if (!uid || isNaN(amt) || !note.trim()) return;
    wsSend({ cmd: 'add_credit', targetUserId: uid, amount: amt, note: note.trim() });
    setAmount(''); setNote('');
  };

  return (
    <div className="glass-panel">
      <div className="panel-header"><h2>Manual Credit Adjustment</h2></div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <select value={targetUserId} onChange={e => setTargetUserId(e.target.value)} className="form-input !text-sm !w-48">
            <option value="">Select user...</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.username} (${u.credit.toFixed(2)})</option>)}
          </select>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (+/-)" step="0.01" className="form-input !text-sm !w-32 font-mono" />
        </div>
        <div className="flex gap-2 items-center">
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / Note (required)" maxLength={200} className="form-input !text-sm flex-1" />
          <button onClick={doAddCredit} disabled={!targetUserId || !amount || !note.trim()} className="btn btn-primary btn-sm">Apply</button>
        </div>
      </div>
    </div>
  );
}

// ── Broadcast Panel (V1 parity: color picker, online users, history) ──

interface BroadcastHistoryEntry {
  timestamp: number;
  message: string;
  color?: string;
}

const BROADCAST_COLORS = [
  { value: undefined, label: 'Default', bg: 'bg-ct-border-solid', text: 'text-ct-text' },
  { value: 'orange' as const, label: 'Orange', bg: 'bg-[#5c3d00]', text: 'text-ct-yellow' },
  { value: 'red' as const, label: 'Red', bg: 'bg-ct-red-bg', text: 'text-ct-red' },
  { value: 'green' as const, label: 'Green', bg: 'bg-ct-green-bg', text: 'text-ct-green' },
] as const;

function loadBroadcastHistory(): BroadcastHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem('ct2_broadcast_history') || '[]');
  } catch { return []; }
}

function saveBroadcastHistory(entries: BroadcastHistoryEntry[]) {
  localStorage.setItem('ct2_broadcast_history', JSON.stringify(entries.slice(0, 20)));
}

function BroadcastPanel() {
  const [message, setMessage] = useState('');
  const [color, setColor] = useState<'orange' | 'red' | 'green' | undefined>(undefined);
  const [history, setHistory] = useState<BroadcastHistoryEntry[]>(loadBroadcastHistory);
  const [sessions, setSessions] = useState<any[]>([]);
  const sessionsMsg = useWsMessage<any>('online_users');

  useEffect(() => {
    wsSend({ cmd: 'get_sessions' });
    const interval = setInterval(() => wsSend({ cmd: 'get_sessions' }), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { if (sessionsMsg?.users) setSessions(sessionsMsg.users); }, [sessionsMsg]);

  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const toggleTarget = (username: string) => {
    setSelectedTargets(prev => prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]);
  };

  const sendBroadcast = () => {
    if (!message.trim()) return;
    const entry: BroadcastHistoryEntry = { timestamp: Date.now(), message: message.trim(), color };
    wsSend({
      cmd: 'admin_broadcast',
      message: message.trim(),
      ...(color ? { color } : {}),
      ...(selectedTargets.length > 0 ? { targets: selectedTargets } : {}),
    });
    const updated = [entry, ...history].slice(0, 20);
    setHistory(updated);
    saveBroadcastHistory(updated);
    setMessage('');
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('ct2_broadcast_history');
  };

  return (
    <div className="space-y-5">
      {/* Send Form */}
      <div className="glass-panel">
        <div className="panel-header"><h2>Send Broadcast</h2></div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[13px] text-ct-muted mb-1">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Message to broadcast to all users..."
              className="form-input !h-20 resize-none" maxLength={500} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBroadcast(); } }} />
            <div className="text-[11px] text-ct-muted-dark mt-1">{message.length}/500</div>
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-[13px] text-ct-muted mb-1.5">Color</label>
            <div className="flex gap-2">
              {BROADCAST_COLORS.map(c => (
                <button
                  key={c.label}
                  onClick={() => setColor(c.value as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    color === c.value
                      ? `${c.bg} ${c.text} border-current ring-1 ring-current`
                      : `bg-ct-surface-solid text-ct-muted border-ct-border-solid hover:border-ct-border-hover`
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target Selection */}
          {sessions.length > 0 && (
            <div>
              <label className="block text-[13px] text-ct-muted mb-1.5">Recipients</label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSelectedTargets([])}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                    selectedTargets.length === 0
                      ? 'bg-ct-blue text-white border-ct-blue'
                      : 'bg-ct-surface-solid text-ct-muted border-ct-border-solid'
                  }`}
                >
                  All Users
                </button>
                {sessions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => toggleTarget(s.username)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      selectedTargets.includes(s.username)
                        ? 'bg-ct-accent/20 text-ct-accent border-ct-accent'
                        : 'bg-ct-surface-solid text-ct-muted border-ct-border-solid'
                    }`}
                  >
                    {s.username}
                  </button>
                ))}
              </div>
              {selectedTargets.length > 0 && (
                <div className="text-[11px] text-ct-muted-dark mt-1">Sending to: {selectedTargets.join(', ')}</div>
              )}
            </div>
          )}

          <button onClick={sendBroadcast} disabled={!message.trim()} className="btn btn-primary">Send Broadcast</button>
        </div>
      </div>

      {/* Online Users */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Online Users</h2>
          <div className="flex items-center gap-2">
            <span className="text-ct-muted text-xs">{sessions.length} connected</span>
            <button onClick={() => wsSend({ cmd: 'get_sessions' })} className="btn btn-sm">Refresh</button>
          </div>
        </div>
        {sessions.length === 0 ? <div className="empty-state">No users online.</div> : (
          <div className="max-h-48 overflow-y-auto">
            {sessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-ct-border-solid/50 last:border-b-0 text-sm">
                <span className="w-2 h-2 rounded-full bg-ct-green flex-shrink-0" style={{ boxShadow: '0 0 6px #3fb95066' }} />
                <span className="text-ct-accent font-semibold">{s.username}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-[10px] font-semibold uppercase tracking-wider ${
                  s.role === 'admin' ? 'bg-[#2d1b00] text-ct-yellow' : s.role === 'user' ? 'bg-[#1a1040] text-ct-purple-dark' : 'bg-ct-green-bg text-ct-green'
                }`}>{s.role}</span>
                {s.sipUser && <span className="text-ct-muted font-mono text-xs">{s.sipUser}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Broadcast History */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Broadcast History</h2>
          {history.length > 0 && (
            <button onClick={clearHistory} className="btn btn-sm btn-danger">Clear All</button>
          )}
        </div>
        {history.length === 0 ? <div className="empty-state">No broadcasts sent yet.</div> : (
          <div className="max-h-60 overflow-y-auto">
            {history.map((h, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-b border-ct-border-solid/50 last:border-b-0">
                <span className="text-[11px] text-ct-muted-dark whitespace-nowrap mt-0.5">{new Date(h.timestamp).toLocaleString()}</span>
                <span className={`text-[13px] flex-1 ${
                  h.color === 'red' ? 'text-ct-red' :
                  h.color === 'green' ? 'text-ct-green' :
                  h.color === 'orange' ? 'text-ct-yellow' :
                  'text-ct-text-secondary'
                }`}>{h.message}</span>
                {h.color && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    h.color === 'red' ? 'bg-ct-red-bg text-ct-red' :
                    h.color === 'green' ? 'bg-ct-green-bg text-ct-green' :
                    'bg-[#5c3d00] text-ct-yellow'
                  }`}>{h.color}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Admin Tab ──

export function AdminTab() {
  const [page, setPage] = useState<AdminPage>('stats');

  return (
    <div className="space-y-4 animate-fade-in" role="tabpanel" id="panel-admin">
      <div className="flex gap-1 overflow-x-auto">
        {([['stats', 'Dashboard'], ['settings', 'Settings'], ['broadcast', 'Broadcast']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setPage(id)} className={`tab-btn-v1 ${page === id ? 'active' : ''}`}>{label}</button>
        ))}
      </div>

      {page === 'stats' && <StatsDashboard />}
      {page === 'settings' && (
        <div className="space-y-5">
          <GlobalSettingsPanel />
          <AccessControlPanel />
          <PermissionsPanel />
          <SessionsPanel />
          <ManualCreditPanel />
          <AuditLogPanel />
        </div>
      )}
      {page === 'broadcast' && <BroadcastPanel />}
    </div>
  );
}
