import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';
import { getNotifSettings, saveNotifSettings } from '../../utils/audio';

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
              {sipUsers.length > 1 && (
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
                    maxLength={15}
                  />
                  <button
                    onClick={handleSetCallerid}
                    disabled={saving || !callerid.trim()}
                    className="btn btn-primary"
                  >
                    {saving ? 'Saving...' : 'Set Caller ID'}
                  </button>
                </div>
              </div>
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

      {/* Notification Preferences — persisted to localStorage */}
      <NotificationSettings />
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
    { key: 'dtmfSound' as const, label: 'DTMF beep sound', desc: 'Play a sound when a DTMF digit is captured' },
    { key: 'callEvents' as const, label: 'Call connect notification', desc: 'Alert when a monitored call connects' },
    { key: 'desktop' as const, label: 'Desktop notifications', desc: 'Show browser notifications for admin broadcasts' },
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
