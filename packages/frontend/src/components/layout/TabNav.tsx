import { useAuth } from '../../hooks/useAuth';
import { useUiStore, type TabId } from '../../stores/uiStore';

interface Tab {
  id: TabId;
  label: string;
  adminOnly?: boolean;
}

const TABS: Tab[] = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'tools', label: 'Tools' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
  { id: 'billing', label: 'Billing' },
  { id: 'admin', label: 'Admin', adminOnly: true },
];

export function TabNav() {
  const { activeTab, setActiveTab } = useUiStore();
  const { isAdmin } = useAuth();

  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <nav className="px-4 pt-3" role="tablist" aria-label="Main navigation">
      <div className="flex gap-1 overflow-x-auto">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-ct-surface text-ct-accent border border-ct-border border-b-transparent'
                : 'text-ct-muted hover:text-ct-text hover:bg-ct-surface/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
