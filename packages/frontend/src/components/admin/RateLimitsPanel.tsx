import { useState, useEffect, useCallback } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useUiStore } from '../../stores/uiStore';

interface RateLimitEntry {
  ip: string;
  username: string;
  attempts: number;
  last_attempt: number;
  expires_at: number;
  rate_key: string;
}

export function RateLimitsPanel() {
  const { addToast } = useUiStore();
  const [rateLimits, setRateLimits] = useState<RateLimitEntry[]>([]);
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [maxAttempts, setMaxAttempts] = useState(5);
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [newWhitelistIp, setNewWhitelistIp] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Listen for responses
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'rate_limits_list') {
          setRateLimits(msg.rate_limits ?? []);
          setWhitelist(msg.whitelist ?? []);
          setMaxAttempts(msg.max_attempts ?? 5);
          setWindowSeconds(msg.window_seconds ?? 60);
          setLoaded(true);
        } else if (msg.type === 'rate_limit_cleared') {
          // Refresh
          wsSend({ cmd: 'admin_get_rate_limits' });
          addToast(msg.clear_all ? 'All rate limits cleared.' : `Rate limit cleared for ${msg.rate_key}.`, 'success', 3000);
        } else if (msg.type === 'rate_whitelist_updated') {
          setWhitelist(msg.whitelist ?? []);
          addToast('Rate limit whitelist updated.', 'success', 3000);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('ws_message', handler as EventListener);
    return () => window.removeEventListener('ws_message', handler as EventListener);
  }, [addToast]);

  // Load on mount
  useEffect(() => {
    wsSend({ cmd: 'admin_get_rate_limits' });
  }, []);

  const handleClear = useCallback((rateKey: string) => {
    wsSend({ cmd: 'admin_clear_rate_limit', rateKey, clearAll: false });
  }, []);

  const handleClearAll = useCallback(() => {
    if (confirm('Clear all rate limits?')) {
      wsSend({ cmd: 'admin_clear_rate_limit', clearAll: true });
    }
  }, []);

  const handleAddWhitelist = useCallback(() => {
    const ip = newWhitelistIp.trim();
    if (!ip) return;
    // Basic IP validation
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some(p => isNaN(Number(p)) || Number(p) < 0 || Number(p) > 255)) {
      addToast('Invalid IP address.', 'error');
      return;
    }
    wsSend({ cmd: 'admin_set_rate_limit_whitelist', action: 'add', ip });
    setNewWhitelistIp('');
  }, [newWhitelistIp, addToast]);

  const handleRemoveWhitelist = useCallback((ip: string) => {
    wsSend({ cmd: 'admin_set_rate_limit_whitelist', action: 'remove', ip });
  }, []);

  const formatTime = (epochSec: number) => {
    return new Date(epochSec * 1000).toLocaleTimeString();
  };

  const formatCountdown = (epochSec: number) => {
    const remaining = Math.max(0, Math.ceil(epochSec - Date.now() / 1000));
    return `${remaining}s`;
  };

  return (
    <div className="glass-panel p-6">
      <h3 className="text-base font-semibold text-ct-accent mb-4">Rate Limits</h3>
      <p className="text-ct-muted text-sm mb-4">
        Login rate limiting: max {maxAttempts} attempts per {windowSeconds}s window.
      </p>

      {/* Active rate limits */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium">Active Rate Limits ({rateLimits.length})</h4>
          {rateLimits.length > 0 && (
            <button
              className="text-xs px-3 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
              onClick={handleClearAll}
            >
              Clear all
            </button>
          )}
        </div>

        {loaded && rateLimits.length > 0 ? (
          <div className="border border-ct-border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ct-bg-secondary text-ct-muted text-left">
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium text-center">Attempts</th>
                  <th className="px-3 py-2 font-medium">Last Attempt</th>
                  <th className="px-3 py-2 font-medium">Expires In</th>
                  <th className="px-3 py-2 font-medium w-20 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rateLimits.map(rl => (
                  <tr key={rl.rate_key} className="border-t border-ct-border hover:bg-ct-bg-secondary/50">
                    <td className="px-3 py-2 font-mono text-xs">{rl.ip}</td>
                    <td className="px-3 py-2 font-mono text-xs">{rl.username}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        rl.attempts >= maxAttempts
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {rl.attempts}/{maxAttempts}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ct-muted text-xs">{formatTime(rl.last_attempt)}</td>
                    <td className="px-3 py-2 text-ct-muted text-xs">{formatCountdown(rl.expires_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="text-red-400 hover:text-red-300 text-xs"
                        onClick={() => handleClear(rl.rate_key)}
                      >
                        Clear
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loaded ? (
          <p className="text-ct-muted text-sm italic">No active rate limits.</p>
        ) : (
          <p className="text-ct-muted text-sm">Loading...</p>
        )}
      </div>

      {/* Whitelist */}
      <div>
        <h4 className="text-sm font-medium mb-2">IP Whitelist</h4>
        <p className="text-ct-muted text-xs mb-3">
          Whitelisted IPs bypass login rate limiting. Existing rate limits for an IP are cleared when added.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            className="flex-1 max-w-xs bg-ct-bg-secondary border border-ct-border rounded px-3 py-1.5 text-sm font-mono"
            placeholder="IP address"
            value={newWhitelistIp}
            onChange={e => setNewWhitelistIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddWhitelist()}
          />
          <button
            className="px-4 py-1.5 bg-ct-accent/20 text-ct-accent border border-ct-accent/30 rounded text-sm hover:bg-ct-accent/30 transition-colors"
            onClick={handleAddWhitelist}
          >
            Add
          </button>
        </div>

        {whitelist.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {whitelist.map(ip => (
              <span key={ip} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 bg-ct-bg-secondary rounded border border-ct-border font-mono">
                {ip}
                <button
                  className="text-red-400 hover:text-red-300 ml-1"
                  onClick={() => handleRemoveWhitelist(ip)}
                  title="Remove from whitelist"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-ct-muted text-sm italic">No IPs whitelisted.</p>
        )}
      </div>
    </div>
  );
}
