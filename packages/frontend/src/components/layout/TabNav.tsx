import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';

// V1 line 1090-1106: Tab bar with regular tabs + Admin dropdown + spacer + Log button
export function TabNav() {
  const { activeTab, setActiveTab } = useUiStore();
  const { isAdmin, permissions } = useAuth();
  const role = useAuthStore(s => s.role);
  const [adminOpen, setAdminOpen] = useState(false);
  const adminRef = useRef<HTMLDivElement>(null);

  // V1: Admin dropdown - close on click outside (use mousedown to avoid race with React onClick)
  useEffect(() => {
    if (!adminOpen) return;
    const handler = (e: MouseEvent) => {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [adminOpen]);

  const showAdmin = role === 'admin' || role === 'user';
  const showBilling = isAdmin || permissions.billing !== false;
  // V1: History tab always visible (CDR permission only hides panels inside, not the tab)
  const showHistory = true;

  const adminSubPage = useUiStore(s => s.adminSubPage);
  const setAdminSubPage = useUiStore(s => s.setAdminSubPage);

  const switchAdminPage = (page: string) => {
    setAdminOpen(false);
    setActiveTab('admin');
    if (setAdminSubPage) setAdminSubPage(page);
  };

  const toggleEventLog = useUiStore(s => s.toggleEventLog);

  return (
    <nav
      className="tab-bar-gradient sticky top-[54px] z-[55] flex items-center gap-1 px-3 sm:px-6 py-2"
      role="tablist"
      aria-label="Main navigation"
      style={{ overflow: adminOpen ? 'visible' : 'auto' }}
    >
      {/* V1 line 1091-1095: Regular tabs */}
      <button onClick={() => setActiveTab('monitor')} className={`tab-btn-v1 ${activeTab === 'monitor' ? 'active' : ''}`}>Monitor</button>
      <button onClick={() => setActiveTab('tools')} className={`tab-btn-v1 ${activeTab === 'tools' ? 'active' : ''}`}>Tools</button>
      {showHistory && <button onClick={() => setActiveTab('history')} className={`tab-btn-v1 ${activeTab === 'history' ? 'active' : ''}`}>History</button>}
      <button onClick={() => setActiveTab('settings')} className={`tab-btn-v1 ${activeTab === 'settings' ? 'active' : ''}`}>Settings</button>
      {showBilling && <button onClick={() => setActiveTab('billing')} className={`tab-btn-v1 ${activeTab === 'billing' ? 'active' : ''}`}>Billing</button>}

      {/* V1 line 1096-1103: Admin DROPDOWN (not a regular tab) */}
      {showAdmin && (
        <div className="relative inline-block" ref={adminRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setAdminOpen(!adminOpen); }}
            className={`tab-btn-v1 ${activeTab === 'admin' ? 'active' : ''}`}
          >
            Admin &#9662;
          </button>
          {adminOpen && (
            <div className="absolute top-[calc(100%+4px)] left-0 z-[100] min-w-[130px] py-1 rounded-lg border border-ct-border-solid shadow-lg"
              style={{ background: '#161b22', boxShadow: '0 4px 12px rgba(0,0,0,.4)' }}
              onClick={(e) => e.stopPropagation()}>
              {/* V1 line 1099: Stats - admin only */}
              {isAdmin && (
                <div onClick={() => switchAdminPage('stats')}
                  className={`px-4 py-2 text-[13px] cursor-pointer hover:bg-ct-border-solid ${adminSubPage === 'stats' ? 'text-ct-accent font-semibold' : 'text-ct-text-secondary'}`}>
                  Stats
                </div>
              )}
              {/* V1 line 1100: Settings - both admin + user */}
              <div onClick={() => switchAdminPage('settings')}
                className={`px-4 py-2 text-[13px] cursor-pointer hover:bg-ct-border-solid ${adminSubPage === 'settings' ? 'text-ct-accent font-semibold' : 'text-ct-text-secondary'}`}>
                Settings
              </div>
              {/* V1 line 1101: Broadcast - admin only */}
              {isAdmin && (
                <div onClick={() => switchAdminPage('broadcast')}
                  className={`px-4 py-2 text-[13px] cursor-pointer hover:bg-ct-border-solid ${adminSubPage === 'broadcast' ? 'text-ct-accent font-semibold' : 'text-ct-text-secondary'}`}>
                  Broadcast
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* V1 line 1104: Spacer */}
      <div className="flex-1" />

      {/* V1 line 1105: Event Log toggle button */}
      <button
        onClick={toggleEventLog}
        className="px-3 py-1.5 rounded-2xl text-xs border border-ct-border-solid text-ct-muted hover:text-ct-text-secondary hover:border-ct-border-hover transition-all"
        style={{ background: 'rgba(255,255,255,0.04)' }}
      >
        Log
      </button>
    </nav>
  );
}
