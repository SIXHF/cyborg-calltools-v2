import { useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { useChannelStore } from '../../stores/channelStore';
import { StatusBadge } from './StatusBadge';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

export function Header() {
  const { username, role, version, logout, sipUsers, permissions } = useAuth();
  const { wsConnected } = useUiStore();
  const selectedSip = useAuthStore(s => s.selectedSipUser);
  const setSelectedSip = useAuthStore(s => s.setSelectedSipUser);
  const sipGroups = useAuthStore(s => s.sipGroups);
  const balanceMsg = useWsMessage<any>('billing_update');

  const roleLabel = role === 'admin' ? 'Admin' : role === 'user' ? 'User' : 'SIP';
  const showSipSelector = (role === 'admin' || role === 'user') && sipUsers.length > 0;
  const showBalance = permissions.billing !== false;

  // Fetch balance on mount and when SIP user changes
  useEffect(() => {
    if (showBalance) wsSend({ cmd: 'get_balance' });
  }, [showBalance, selectedSip]);

  const balance = balanceMsg?.balance;

  const handleSipChange = (value: string) => {
    // Send WS commands FIRST so server updates before frontend re-fetches
    if (value.startsWith('account:')) {
      const accountName = value.slice('account:'.length);
      wsSend({ cmd: 'switch_sip_user', sipUser: '', account: accountName });
      wsSend({ cmd: 'get_channels' });
    } else {
      wsSend({ cmd: 'switch_sip_user', sipUser: value || '' });
      wsSend({ cmd: 'get_channels', targetSip: value || undefined });
    }
    // THEN update frontend store (triggers tab re-fetches)
    setSelectedSip(value);
  };

  return (
    <header className="header-gradient flex items-center justify-between sticky top-0 z-[60] flex-wrap gap-2" style={{ padding: '14px 24px' }}>
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-ct-accent tracking-wide">
          Call Tools <span className="beta-badge">BETA</span>{' '}
          <span className="text-ct-muted font-normal text-base hidden sm:inline">/ Cyborg Telecom</span>
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        {/* SIP User Selector */}
        {showSipSelector && (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-ct-border-solid" style={{ background: 'rgba(21,26,35,0.6)' }}>
            <span className="text-[11px] text-ct-muted">SIP:</span>
            <select
              value={selectedSip ?? ''}
              onChange={e => handleSipChange(e.target.value)}
              className="bg-transparent border-none text-ct-accent text-[13px] font-mono outline-none cursor-pointer"
              style={{ background: 'transparent' }}
            >
              <option value="" style={{ background: '#161b22', color: '#c9d1d9' }}>All</option>
              {sipGroups && sipGroups.length > 0 ? (
                <>
                  {/* V1 line 3239-3248: "Accounts" optgroup with account-level entries */}
                  <optgroup label="Accounts" style={{ background: '#161b22', color: '#c9d1d9' }}>
                    {sipGroups.map(group => (
                      <option key={`acct-${group.account}`} value={`account:${group.account}`} style={{ background: '#161b22', color: '#c9d1d9' }}>
                        {group.account} ({group.sipUsers.length} SIPs)
                      </option>
                    ))}
                  </optgroup>
                  {/* V1 line 3250-3261: per-account optgroups with individual SIP users */}
                  {sipGroups.map(group => (
                    <optgroup key={group.account} label={group.account} style={{ background: '#161b22', color: '#c9d1d9' }}>
                      {group.sipUsers.map(s => (
                        <option key={s} value={s} style={{ background: '#161b22', color: '#c9d1d9' }}>{s}</option>
                      ))}
                    </optgroup>
                  ))}
                </>
              ) : (
                sipUsers.map(s => (
                  <option key={s} value={s} style={{ background: '#161b22', color: '#c9d1d9' }}>{s}</option>
                ))
              )}
            </select>
          </span>
        )}

        {/* V1 header-right order: SIP selector, User badge, Balance, Logout, Status, Version */}

        {/* 1. User badge (V1 line 984) */}
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-2xl text-[13px] font-medium"
          style={{
            background: role === 'admin' ? '#2d1b00' : role === 'user' ? '#1a1040' : '#0d2818',
            color: role === 'admin' ? '#d29922' : role === 'user' ? '#8b5cf6' : '#3fb950',
          }}>
          <span className="w-2 h-2 rounded-full bg-current" />
          {role === 'sip_user' ? `SIP/${username}` : `${roleLabel}: ${username}`}
        </span>

        {/* 2. Balance (V1 line 985-988) */}
        {showBalance && balance !== undefined && (
          <span
            className="inline-flex items-center gap-1 px-3 py-1 rounded-2xl text-[13px] font-semibold font-mono"
            style={{ background: '#0d2818', color: '#3fb950' }}
          >
            <span>${typeof balance === 'number' ? balance.toFixed(2) : '—'}</span>
            <button
              onClick={() => useUiStore.getState().setActiveTab('billing')}
              className="w-[22px] h-[22px] rounded-full bg-ct-green-dark text-white border-none text-base font-bold leading-none flex items-center justify-center hover:bg-[#2ea043] transition-colors"
              title="Recharge"
            >
              +
            </button>
          </span>
        )}

        {/* 3. Logout (V1 line 989) */}
        <button onClick={logout} className="btn btn-sm btn-ghost">Logout</button>

        {/* 4. Status badge (V1 line 990-993) */}
        <StatusBadge connected={wsConnected} />

        {/* 5. Version (V1 line 994) */}
        {version && (
          <span className="text-[10px] text-ct-muted-dark font-mono hidden sm:inline" style={{ marginLeft: 4 }}>v{version}</span>
        )}
      </div>
    </header>
  );
}
