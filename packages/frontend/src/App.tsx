import { useAuthStore } from './stores/authStore';
import { useWebSocket } from './hooks/useWebSocket';
import { Header } from './components/layout/Header';
import { TabNav } from './components/layout/TabNav';
import { LoginForm } from './components/layout/LoginForm';
import { Toast } from './components/shared/Toast';
import { MonitorTab } from './components/monitor/MonitorTab';
import { ToolsTab } from './components/tools/ToolsTab';
import { HistoryTab } from './components/history/HistoryTab';
import { SettingsTab } from './components/settings/SettingsTab';
import { BillingTab } from './components/billing/BillingTab';
import { AdminTab } from './components/admin/AdminTab';
import { useUiStore } from './stores/uiStore';

export function App() {
  const { isAuthenticated } = useAuthStore();
  const { activeTab } = useUiStore();

  // Initialize WebSocket connection
  useWebSocket();

  if (!isAuthenticated) {
    return (
      <>
        <LoginForm />
        <Toast />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <TabNav />
      <main className="flex-1 p-6 max-w-[1000px] mx-auto w-full pb-16">
        {activeTab === 'monitor' && <MonitorTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'history' && <HistoryTab />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'billing' && <BillingTab />}
        {activeTab === 'admin' && <AdminTab />}
      </main>
      <Toast />
    </div>
  );
}
