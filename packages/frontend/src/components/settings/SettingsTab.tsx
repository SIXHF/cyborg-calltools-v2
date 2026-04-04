import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';
import { getNotifSettings, saveNotifSettings } from '../../utils/audio';

const TOLL_FREE_PREFIXES = ['1800', '1833', '1844', '1855', '1866', '1877', '1888'];

export function SettingsTab() {
  const { sipUsers, role, permissions } = useAuthStore();
  const globalSelectedSip = useAuthStore(s => s.selectedSipUser);
  const [callerid, setCallerid] = useState('');
  const [selectedSip, setSelectedSip] = useState(globalSelectedSip || sipUsers[0] || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const calleridUpdate = useWsMessage<any>('callerid_updated');
  const calleridInfo = useWsMessage<any>('callerid_info');

  useEffect(() => {
    if (calleridUpdate) {
      setSaving(false);
      setSavedMsg(`Saved: ${calleridUpdate.callerid || '(cleared)'}`);
      setTimeout(() => setSavedMsg(''), 3000);
    }
  }, [calleridUpdate]);

  // Sync with global SIP selector
  useEffect(() => {
    if (globalSelectedSip) setSelectedSip(globalSelectedSip);
  }, [globalSelectedSip]);

  // Fetch current caller ID on mount and when SIP user changes (Bug 3.1 fix)
  useEffect(() => {
    if (selectedSip) {
      wsSend({ cmd: 'get_callerid', sipUser: selectedSip });
    }
  }, [selectedSip]);

  // Update input when callerid is fetched (callerid_info = read, callerid_updated = write)
  useEffect(() => {
    if (calleridInfo && calleridInfo.sipUser === selectedSip) {
      setCallerid(calleridInfo.callerid || '');
    }
  }, [calleridInfo, selectedSip]);

  const handleSetCallerid = () => {
    if (!selectedSip) return;
    setSaving(true);
    setSavedMsg('');
    wsSend({ cmd: 'set_callerid', sipUser: selectedSip, callerid: callerid.trim() });
  };

  const canEditCallerid = role === 'admin' || permissions.caller_id !== false;

  const isTollFree = useMemo(() => {
    const trimmed = callerid.trim();
    return TOLL_FREE_PREFIXES.some(prefix => trimmed.startsWith(prefix));
  }, [callerid]);

  const showTollFreeWarning = isTollFree && permissions.allow_tollfree_callerid === false;

  return (
    <div className="space-y-5 animate-fade-in" role="tabpanel" id="panel-settings">
      {/* Caller ID Management */}
      <div className="glass-panel">
        <div className="panel-header">
          <h2>Caller ID</h2>
        </div>
        <div className="p-5 space-y-4">
          {!canEditCallerid ? (
            <p className="text-ct-muted text-sm">Caller ID management is disabled for your account.</p>
          ) : (
            <>
              {/* Only show SIP selector for 'user' role with multiple SIPs.
                  Admin uses the global header SIP selector. sip_user has only one. */}
              {role === 'user' && sipUsers.length > 1 && (
                <div>
                  <label className="block text-[13px] text-ct-muted mb-1.5">SIP User</label>
                  <select
                    value={selectedSip}
                    onChange={e => setSelectedSip(e.target.value)}
                    className="form-input"
                  >
                    {sipUsers.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
              {(role === 'admin' || role === 'sip_user') && selectedSip && (
                <div className="text-[13px] text-ct-muted">Managing: <span className="text-ct-accent font-mono font-semibold">{selectedSip}</span></div>
              )}
              <div>
                <label className="block text-[13px] text-ct-muted mb-1.5">
                  New Caller ID <span className="text-ct-muted-dark">(US/CA: 11 digits starting with 1)</span>
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={callerid}
                    onChange={e => setCallerid(e.target.value)}
                    placeholder="e.g. 18478603211"
                    className="form-input flex-1"
                    maxLength={11}
                    inputMode="numeric"
                    onInput={(e) => { (e.target as HTMLInputElement).value = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, ''); }}
                  />
                  <button
                    onClick={handleSetCallerid}
                    disabled={saving || !callerid.trim() || showTollFreeWarning}
                    className="btn btn-primary"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              {showTollFreeWarning && (
                <div
                  className="flex items-start gap-2 px-4 py-3 rounded-lg text-[13px]"
                  style={{ background: 'rgba(210, 153, 34, 0.15)', border: '1px solid rgba(210, 153, 34, 0.4)', color: '#d29922' }}
                >
                  <span className="text-base leading-none mt-0.5">{'\u26A0'}</span>
                  <span>Toll-free caller IDs (800, 833, 844, 855, 866, 877, 888) are not allowed for this account.</span>
                </div>
              )}
              {savedMsg && <div className="text-ct-green text-xs">{savedMsg}</div>}
              {!selectedSip && (role === 'admin' || role === 'user') && (
                <div className="text-ct-yellow text-xs">Select a specific SIP user to edit Caller ID.</div>
              )}
              <button
                onClick={() => { setCallerid(''); wsSend({ cmd: 'set_callerid', sipUser: selectedSip, callerid: '' }); }}
                className="btn btn-sm"
                disabled={!selectedSip}
              >
                Clear Caller ID
              </button>
            </>
          )}
        </div>
      </div>

      {/* SIP Account Info — hidden for admin (V1 line 3298) */}
      {role !== 'admin' && <SipAccountInfo />}

      {/* Notification Preferences — persisted to localStorage */}
      <NotificationSettings />
    </div>
  );
}

interface SipExtension {
  name: string;
  callerid: string;
  host: string;
  codecs: string;
  secret: string;
  registered: boolean;
}

function SipAccountInfo() {
  const sipInfoMsg = useWsMessage<{ type: string; extensions: SipExtension[] }>('sip_info');
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    wsSend({ cmd: 'get_sip_info' });
  }, []);

  useEffect(() => {
    if (sipInfoMsg) setLoaded(true);
  }, [sipInfoMsg]);

  const extensions = sipInfoMsg?.extensions ?? [];

  const toggleSecret = (name: string) => {
    setShowSecrets(prev => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>SIP Account Info</h2>
      </div>
      <div className="p-5">
        {!loaded ? (
          <p className="text-ct-muted text-sm">Loading SIP info...</p>
        ) : extensions.length === 0 ? (
          <p className="text-ct-muted text-sm">No SIP extensions found.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {extensions.map(ext => (
              <div
                key={ext.name}
                className="rounded-lg border border-ct-border-solid p-4 space-y-2"
                style={{ background: 'rgba(21, 26, 35, 0.5)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-ct-accent font-mono text-sm font-semibold">{ext.name}</span>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={ext.registered
                      ? { background: 'rgba(63, 185, 80, 0.15)', color: '#3fb950' }
                      : { background: 'rgba(248, 81, 73, 0.15)', color: '#f85149' }
                    }
                  >
                    {ext.registered ? 'Registered' : 'Unregistered'}
                  </span>
                </div>
                <div className="space-y-1 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-ct-muted">Caller ID</span>
                    <span className="text-ct-text-secondary font-mono">{ext.callerid || '(none)'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ct-muted">Codecs</span>
                    <span className="text-ct-text-secondary font-mono">{ext.codecs || '(default)'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ct-muted">Host</span>
                    <span className="text-ct-text-secondary font-mono">{ext.host || 'dynamic'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ct-muted">Password</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-ct-text-secondary font-mono">
                        {showSecrets[ext.name] ? ext.secret : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                      </span>
                      <button
                        onClick={() => toggleSecret(ext.name)}
                        className="text-[11px] text-ct-accent hover:underline"
                      >
                        {showSecrets[ext.name] ? 'hide' : 'show'}
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationSettings() {
  const [settings, setSettings] = useState(getNotifSettings);

  const toggle = (key: 'dtmfSound' | 'callEvents' | 'desktop') => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    saveNotifSettings(updated);
    if (key === 'desktop' && updated.desktop && 'Notification' in window) {
      Notification.requestPermission();
    }
  };

  const items = [
    { key: 'dtmfSound' as const, label: 'DTMF Sounds', desc: 'Play a beep when a DTMF digit is captured' },
    { key: 'callEvents' as const, label: 'Call Events', desc: 'Play a sound on call connect/hangup' },
    { key: 'desktop' as const, label: 'Desktop Notifications', desc: 'Show browser notifications for important events' },
  ];

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Notifications</h2>
      </div>
      <div className="p-0">
        {items.map(item => (
          <div key={item.key} className="flex items-center justify-between px-5 py-3 border-b border-ct-border-solid/50 last:border-b-0">
            <div>
              <div className="text-[13px] text-ct-text-secondary">{item.label}</div>
              <div className="text-[11px] text-ct-muted-dark">{item.desc}</div>
            </div>
            <label className="relative inline-block w-9 h-5 cursor-pointer">
              <input type="checkbox" checked={settings[item.key]} onChange={() => toggle(item.key)} className="sr-only peer" />
              <span className="absolute inset-0 rounded-full bg-ct-border-solid transition-colors peer-checked:bg-ct-green-dark" />
              <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-ct-text-secondary transition-transform peer-checked:translate-x-4" />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
