import { useAuth } from '../../hooks/useAuth';
import { useUiStore } from '../../stores/uiStore';
import { StatusBadge } from './StatusBadge';

export function Header() {
  const { username, role, version, logout } = useAuth();
  const { wsConnected } = useUiStore();

  return (
    <header className="glass-panel m-4 mb-0 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-ct-accent">
          CallTools <span className="text-ct-muted text-sm font-normal">v2 beta</span>
        </h1>
        <StatusBadge connected={wsConnected} />
      </div>

      <div className="flex items-center gap-4">
        {version && (
          <span className="text-xs text-ct-muted font-mono">v{version}</span>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm">
            <span className="text-ct-muted">{role === 'admin' ? 'Admin' : role === 'user' ? 'User' : 'SIP'}:</span>{' '}
            <span className="text-ct-text font-medium">{username}</span>
          </span>
          <button
            onClick={logout}
            className="text-xs px-3 py-1 rounded bg-ct-red/10 text-ct-red hover:bg-ct-red/20 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
