import { useState, useEffect, useCallback } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useUiStore } from '../../stores/uiStore';

interface IpRestrictions {
  users: Record<string, string[]>;
  sip_users: Record<string, string[]>;
}

export function IpRestrictionsPanel() {
  const { addToast } = useUiStore();
  const [restrictions, setRestrictions] = useState<IpRestrictions>({ users: {}, sip_users: {} });
  const [targetType, setTargetType] = useState<'users' | 'sip_users'>('sip_users');
  const [targetName, setTargetName] = useState('');
  const [ipInput, setIpInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Listen for responses
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ip_restrictions_list') {
          setRestrictions(msg.ip_restrictions ?? { users: {}, sip_users: {} });
          setLoaded(true);
        } else if (msg.type === 'ip_restrictions_updated') {
          // Refresh the full list
          wsSend({ cmd: 'admin_get_ip_restrictions' });
          addToast(`IP restrictions updated for ${msg.target_type}/${msg.target_name}.`, 'success', 3000);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('ws_message', handler as EventListener);
    return () => window.removeEventListener('ws_message', handler as EventListener);
  }, [addToast]);

  // Load on mount
  useEffect(() => {
    wsSend({ cmd: 'admin_get_ip_restrictions' });
  }, []);

  const handleSave = useCallback(() => {
    if (!targetName.trim()) {
      addToast('Enter a target name.', 'error');
      return;
    }

    const ips = ipInput
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    wsSend({
      cmd: 'admin_set_ip_restrictions',
      targetType,
      targetName: targetName.trim(),
      ips,
    });
  }, [targetType, targetName, ipInput, addToast]);

  const handleEdit = useCallback((type: 'users' | 'sip_users', name: string, ips: string[]) => {
    setTargetType(type);
    setTargetName(name);
    setIpInput(ips.join('\n'));
  }, []);

  const handleRemove = useCallback((type: 'users' | 'sip_users', name: string) => {
    if (confirm(`Remove IP restrictions for ${type}/${name}?`)) {
      wsSend({
        cmd: 'admin_set_ip_restrictions',
        targetType: type,
        targetName: name,
        ips: [],
      });
    }
  }, []);

  const allEntries: { type: 'users' | 'sip_users'; name: string; ips: string[] }[] = [];
  for (const [name, ips] of Object.entries(restrictions.users ?? {})) {
    allEntries.push({ type: 'users', name, ips });
  }
  for (const [name, ips] of Object.entries(restrictions.sip_users ?? {})) {
    allEntries.push({ type: 'sip_users', name, ips });
  }

  return (
    <div className="glass-panel p-6">
      <h3 className="text-base font-semibold text-ct-accent mb-4">IP Restrictions</h3>
      <p className="text-ct-muted text-sm mb-4">
        Restrict login access by IP address. User restrictions cascade to their SIP users.
      </p>

      {/* Editor */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div>
          <label className="block text-xs text-ct-muted mb-1">Target Type</label>
          <select
            className="w-full bg-ct-bg-secondary border border-ct-border rounded px-3 py-1.5 text-sm"
            value={targetType}
            onChange={e => setTargetType(e.target.value as 'users' | 'sip_users')}
          >
            <option value="users">Users</option>
            <option value="sip_users">SIP Users</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-ct-muted mb-1">Target Name</label>
          <input
            type="text"
            className="w-full bg-ct-bg-secondary border border-ct-border rounded px-3 py-1.5 text-sm"
            placeholder="e.g. admin or 1001"
            value={targetName}
            onChange={e => setTargetName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-ct-muted mb-1">IPs/CIDRs (one per line)</label>
          <textarea
            className="w-full bg-ct-bg-secondary border border-ct-border rounded px-3 py-1.5 text-sm resize-none h-[34px]"
            placeholder="192.168.1.1"
            value={ipInput}
            onChange={e => setIpInput(e.target.value)}
            rows={1}
          />
        </div>
        <div className="flex items-end">
          <button
            className="w-full px-4 py-1.5 bg-ct-accent/20 text-ct-accent border border-ct-accent/30 rounded text-sm hover:bg-ct-accent/30 transition-colors"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>

      {/* Current restrictions */}
      {loaded && allEntries.length > 0 ? (
        <div className="border border-ct-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ct-bg-secondary text-ct-muted text-left">
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Allowed IPs</th>
                <th className="px-3 py-2 font-medium w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allEntries.map(e => (
                <tr key={`${e.type}-${e.name}`} className="border-t border-ct-border hover:bg-ct-bg-secondary/50">
                  <td className="px-3 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      e.type === 'users' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {e.type === 'users' ? 'User' : 'SIP'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {e.ips.map(ip => (
                        <span key={ip} className="text-xs px-1.5 py-0.5 bg-ct-bg-secondary rounded font-mono">
                          {ip}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button
                      className="text-ct-accent hover:text-ct-accent/80 text-xs"
                      onClick={() => handleEdit(e.type, e.name, e.ips)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-red-400 hover:text-red-300 text-xs"
                      onClick={() => handleRemove(e.type, e.name)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loaded ? (
        <p className="text-ct-muted text-sm italic">No IP restrictions configured.</p>
      ) : (
        <p className="text-ct-muted text-sm">Loading...</p>
      )}
    </div>
  );
}
