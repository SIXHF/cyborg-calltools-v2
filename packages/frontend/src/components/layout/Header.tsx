import { useAuth } from '../../hooks/useAuth';
import { useUiStore } from '../../stores/uiStore';
import { StatusBadge } from './StatusBadge';

export function Header() {
  const { username, role, version, logout } = useAuth();
  const { wsConnected } = useUiStore();

  const roleLabel = role === 'admin' ? 'Admin' : role === 'user' ? 'User' : 'SIP';

  return (
    <header className="header-gradient px-6 py-3.5 flex items-center justify-between sticky top-0 z-[60]">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-ct-accent tracking-wide">
          Call Tools <span className="beta-badge">BETA</span>{' '}
          <span className="text-ct-muted font-normal text-base">/ Cyborg Telecom</span>
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {version && (
          <span className="text-[10px] text-ct-muted-dark font-mono">v{version}</span>
        )}
        <span className="user-badge-v1">
          <span className="w-2 h-2 rounded-full bg-current" />
          {roleLabel}: {username}
        </span>
        <button
          onClick={logout}
          className="btn btn-sm btn-ghost"
        >
          Logout
        </button>
        <StatusBadge connected={wsConnected} />
      </div>
    </header>
  );
}
