import { useAuth } from '../../hooks/useAuth';
import { useUiStore, type TabId } from '../../stores/uiStore';

interface Tab {
  id: TabId;
  label: string;
  adminOnly?: boolean;
  permissionKey?: string;
}

const TABS: Tab[] = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'tools', label: 'Tools' },
  { id: 'history', label: 'History', permissionKey: 'cdr' },
  { id: 'settings', label: 'Settings' },
  { id: 'billing', label: 'Billing', permissionKey: 'billing' },
  { id: 'admin', label: 'Admin', adminOnly: true },
];

export function TabNav() {
  const { activeTab, setActiveTab } = useUiStore();
  const { isAdmin, permissions } = useAuth();

  const visibleTabs = TABS.filter((tab) => {
    if (tab.adminOnly && !isAdmin) return false;
    // Hide tabs based on permissions (unless admin)
    if (tab.permissionKey && !isAdmin && (permissions as any)[tab.permissionKey] === false) return false;
    return true;
  });

  return (
    <nav
      className="tab-bar-gradient sticky top-[54px] z-[55] flex items-center gap-1 px-3 sm:px-6 py-2 overflow-x-auto"
      role="tablist"
      aria-label="Main navigation"
    >
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`panel-${tab.id}`}
          onClick={() => setActiveTab(tab.id)}
          className={`tab-btn-v1 ${activeTab === tab.id ? 'active' : ''}`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
