import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useChannelStore } from '../../stores/channelStore';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';
import { getNotifSettings, saveNotifSettings } from '../../utils/audio';

const TOLL_FREE_PREFIXES = ['1800', '1833', '1844', '1855', '1866', '1877', '1888'];

export function SettingsTab() {
  const { sipUsers, role, permissions } = useAuthStore();
  const globalSelectedSip = useAuthStore(s => s.selectedSipUser);
  const sipGroups = useAuthStore(s => s.sipGroups);
  const [callerid, setCallerid] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  // Resolve the effective SIP user — account prefix means pick the first SIP under that account
  const resolveEffectiveSip = (global: string | undefined): string => {
    if (!global) return sipUsers[0] || '';
    if (global.startsWith('account:')) {
      const accountName = global.slice('account:'.length);
      const group = sipGroups?.find(g => g.account === accountName);
      return group?.sipUsers?.[0] || sipUsers[0] || '';
    }
    return global;
  };

  const [selectedSip, setSelectedSip] = useState(() => resolveEffectiveSip(globalSelectedSip));

  // Get SIP users for current account selection (for dropdown)
  const accountSipUsers = useMemo(() => {
    if (globalSelectedSip?.startsWith('account:')) {
      const accountName = globalSelectedSip.slice('account:'.length);
      const group = sipGroups?.find(g => g.account === accountName);
      return group?.sipUsers || [];
    }
    return [];
  }, [globalSelectedSip, sipGroups]);

  const calleridUpdate = useWsMessage<any>('callerid_updated');
  const calleridInfo = useWsMessage<any>('callerid_info');

  useEffect(() => {
    if (calleridUpdate) {
      setSaving(false);
      // Show fraud score feedback like V1
      const score = calleridUpdate.fraud_score;
      if (score !== undefined && score !== null && calleridUpdate.callerid) {
        const label = score <= 30 ? 'Low risk' : score <= 59 ? 'Medium risk' : 'High risk';
        const color = score <= 30 ? '#3fb950' : score <= 59 ? '#d29922' : '#f85149';
        setSavedMsg(`Saved · ● ${score}/100 ${label}`);
      } else {
        setSavedMsg(`Saved: ${calleridUpdate.callerid || '(cleared)'}`);
      }
      setTimeout(() => setSavedMsg(''), 5000);
    }
  }, [calleridUpdate]);

  // Sync with global SIP selector — resolve account prefix to actual SIP
  // Also re-resolve when sipUsers loads (sip_user role: sipUsers may arrive after mount)
  useEffect(() => {
    const resolved = resolveEffectiveSip(globalSelectedSip);
    if (resolved) setSelectedSip(resolved);
  }, [globalSelectedSip, sipUsers]);

  // Fetch current caller ID on mount and when SIP user changes
  useEffect(() => {
    if (selectedSip) {
      wsSend({ cmd: 'get_callerid', sipUser: selectedSip });
    }
  }, [selectedSip, sipUsers]);

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
              {/* Show SIP dropdown when account selected or user has multiple SIPs */}
              {(accountSipUsers.length > 1 || (role === 'user' && sipUsers.length > 1)) && (
                <div>
                  <label className="block text-[13px] text-ct-muted mb-1.5">SIP User</label>
                  <select
                    value={selectedSip}
                    onChange={e => setSelectedSip(e.target.value)}
                    className="form-input"
                  >
                    {(accountSipUsers.length > 0 ? accountSipUsers : sipUsers).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
              {selectedSip && (
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
              {savedMsg && <div className="text-xs" style={{ color: savedMsg.includes('High risk') ? '#f85149' : savedMsg.includes('Medium risk') ? '#d29922' : '#3fb950' }}>{savedMsg}</div>}
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

      {/* Hold Music — gated by moh permission */}
      {(role === 'admin' || permissions.moh !== false) && <MohPanel />}

      {/* SIP Account Info — hidden for admin (V1 line 3298) */}
      {role !== 'admin' && <SipAccountInfo />}

      {/* Notification Preferences — persisted to localStorage */}
      <NotificationSettings />
    </div>
  );
}

// ── Hold Music Panel (V1 lines 1438-1469, 4633-4733) ──

interface MohFile {
  name: string;
  size: number;
}

function MohPanel() {
  const { role, permissions } = useAuthStore();
  const globalSelectedSip = useAuthStore(s => s.selectedSipUser);
  const sipGroups = useAuthStore(s => s.sipGroups);
  const sipUsers = useAuthStore(s => s.sipUsers);
  const channels = useChannelStore(s => s.channels);

  // Resolve account:prefix to actual SIP user for MOH commands
  // For sip_user role, use their own SIP user if nothing selected
  const resolvedSip = useMemo(() => {
    if (!globalSelectedSip) {
      return role === 'sip_user' ? (sipUsers[0] || '') : '';
    }
    if (globalSelectedSip.startsWith('account:')) {
      const acct = globalSelectedSip.slice('account:'.length);
      const group = sipGroups?.find(g => g.account === acct);
      return group?.sipUsers?.[0] || sipUsers[0] || '';
    }
    return globalSelectedSip;
  }, [globalSelectedSip, sipGroups, sipUsers, role]);

  const [mohInfo, setMohInfo] = useState<{ using_default: boolean; moh_class: string; files: MohFile[] } | null>(null);
  const [audioFiles, setAudioFiles] = useState<{ name: string }[]>([]);
  const [selectedAudio, setSelectedAudio] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mohMsg = useWsMessage<any>('moh_info');
  const mohUpdated = useWsMessage<any>('moh_updated');
  const audioListMsg = useWsMessage<any>('audio_list');

  const isNoSipSelected = (role === 'admin' || role === 'user') && !resolvedSip;
  // V1 line 4686: disable controls during active call
  const inCall = channels.length > 0;

  // Fetch MOH info on mount and when SIP changes
  useEffect(() => {
    if (!isNoSipSelected && resolvedSip) {
      wsSend({ cmd: 'get_moh', targetSip: resolvedSip });
    }
    wsSend({ cmd: 'list_audio' });
  }, [resolvedSip, isNoSipSelected]);

  useEffect(() => {
    if (mohMsg) setMohInfo({ using_default: mohMsg.using_default, moh_class: mohMsg.moh_class, files: mohMsg.files ?? [] });
  }, [mohMsg]);

  useEffect(() => {
    if (mohUpdated) setMohInfo({ using_default: mohUpdated.using_default, moh_class: mohUpdated.moh_class, files: mohUpdated.files ?? [] });
  }, [mohUpdated]);

  useEffect(() => {
    if (audioListMsg) {
      setAudioFiles((audioListMsg.files ?? []).filter((f: any) => f.status === 'approved' || f.status === undefined));
    }
  }, [audioListMsg]);

  const handleSetFromAudio = () => {
    if (!selectedAudio || !resolvedSip) return;
    wsSend({ cmd: 'set_moh', targetSip: resolvedSip, filename: selectedAudio });
  };

  const handleUseDefault = () => {
    if (!resolvedSip) return;
    wsSend({ cmd: 'set_moh', targetSip: resolvedSip, useDefault: true });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resolvedSip) return;
    if (file.size > 10 * 1024 * 1024) {
      // V1 line 4715: max 10MB
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      wsSend({ cmd: 'upload_moh', targetSip: resolvedSip, filename: file.name, data: base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleDelete = (filename: string) => {
    if (!resolvedSip) return;
    if (!confirm(`Remove ${filename} from hold music?`)) return;
    wsSend({ cmd: 'delete_moh', targetSip: resolvedSip, filename });
  };

  const disabled = isNoSipSelected || inCall;

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2>Hold Music</h2>
        <span className="text-[11px]">
          {isNoSipSelected ? (
            <span style={{ color: '#d29922' }}>Select a SIP user</span>
          ) : mohInfo?.using_default ? (
            <span style={{ color: '#3fb950' }}>Using default</span>
          ) : mohInfo ? (
            <span style={{ color: '#da6d28' }}>Custom: {mohInfo.moh_class}</span>
          ) : null}
        </span>
      </div>
      <div className="p-4 space-y-3">
        {/* Current info */}
        <div className="text-[13px] text-ct-muted">
          {isNoSipSelected
            ? 'Select a specific SIP user to manage hold music.'
            : !mohInfo
              ? 'Loading...'
              : mohInfo.using_default
                ? `Using the system default hold music (${mohInfo.files.length} tracks).`
                : `Custom hold music (${mohInfo.files.length} file${mohInfo.files.length !== 1 ? 's' : ''}):`
          }
        </div>

        {/* File list (custom only) */}
        {mohInfo && !mohInfo.using_default && mohInfo.files.length > 0 && (
          <div className="space-y-1">
            {mohInfo.files.map(f => (
              <div key={f.name} className="flex items-center justify-between py-1.5 px-2 rounded bg-ct-surface-solid border border-ct-border-solid/50">
                <span className="text-[13px] text-ct-text-secondary font-mono">{f.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ct-muted">{Math.round(f.size / 1024)} KB</span>
                  <button
                    className="text-[11px] px-2 py-0.5 rounded text-ct-red hover:bg-ct-red-bg transition-colors"
                    onClick={() => handleDelete(f.name)}
                    disabled={disabled}
                    style={disabled ? { opacity: 0.4 } : {}}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Set from audio library */}
        <div className="flex gap-2.5 items-center flex-wrap">
          <label className="text-[12px] text-ct-muted">Set from audio library:</label>
          <select
            value={selectedAudio}
            onChange={e => setSelectedAudio(e.target.value)}
            className="form-input flex-1 min-w-0 !py-1.5 !px-2.5 !text-[13px]"
            disabled={disabled}
            style={disabled ? { opacity: 0.4 } : {}}
          >
            <option value="">-- Select from audio library --</option>
            {audioFiles.map(f => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
          <button
            onClick={handleSetFromAudio}
            disabled={disabled || !selectedAudio}
            className="btn btn-sm btn-success"
            style={disabled ? { opacity: 0.4 } : {}}
          >
            Set as Hold Music
          </button>
        </div>

        {/* Upload / Use Default row */}
        <div className="flex gap-2.5 items-center flex-wrap">
          <label
            className="btn btn-sm cursor-pointer"
            style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : {}}
          >
            Upload New
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.ogg,.m4a,.flac"
              className="hidden"
              onChange={handleUpload}
              disabled={disabled}
            />
          </label>
          <button
            onClick={handleUseDefault}
            disabled={disabled}
            className="btn btn-sm"
            style={disabled ? { opacity: 0.4 } : {}}
          >
            Use Default
          </button>
        </div>
      </div>

      {/* Active call warning — V1 line 4462 */}
      {inCall && !isNoSipSelected && (
        <div
          className="px-4 py-2 text-[12px]"
          style={{ background: '#2d1b00', borderTop: '1px solid #da6d28', color: '#da6d28' }}
        >
          Cannot change hold music during an active call. Changes only take effect on the next call.
        </div>
      )}

      {/* Footer meta — V1 line 4465-4468 */}
      <div className="px-4 py-2.5 border-t border-ct-border-solid/50 space-y-0.5">
        <div className="text-[11px] text-ct-muted-dark">Changes hold music for your SIP extension only</div>
        <div className="text-[11px] text-ct-muted-dark">Changes take effect on the next call, not the current one</div>
      </div>
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
  regIp?: string;
  balance?: number;
  sipDomain?: string;
}

function SipAccountInfo() {
  const selectedSipForInfo = useAuthStore(s => s.selectedSipUser);
  const sipInfoMsg = useWsMessage<{ type: string; extensions: SipExtension[] }>('sip_info');
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    wsSend({ cmd: 'get_sip_info', targetSip: selectedSipForInfo || undefined });
  }, [selectedSipForInfo]);

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
                  {ext.balance !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-ct-muted">Balance</span>
                      <span className="font-mono font-semibold" style={{ color: ext.balance >= 1 ? '#3fb950' : '#f85149' }}>${ext.balance.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-ct-muted">Caller ID</span>
                    <span className="text-ct-text-secondary font-mono">{ext.callerid || 'Not set'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ct-muted">Codecs</span>
                    <span className="text-ct-text-secondary font-mono">{ext.codecs}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ct-muted">Host</span>
                    <span className="text-ct-text-secondary font-mono">{ext.host}</span>
                  </div>
                  {ext.regIp && (
                    <div className="flex justify-between">
                      <span className="text-ct-muted">Registration IP</span>
                      <span className="text-ct-text-secondary font-mono">{ext.regIp}</span>
                    </div>
                  )}
                  {ext.sipDomain && (
                    <div className="flex justify-between">
                      <span className="text-ct-muted">SIP Domain</span>
                      <span className="text-ct-text-secondary font-mono">{ext.sipDomain}</span>
                    </div>
                  )}
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
