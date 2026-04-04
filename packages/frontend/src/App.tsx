import { useState, useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { useWebSocket } from './hooks/useWebSocket';
import { Header } from './components/layout/Header';
import { TabNav } from './components/layout/TabNav';
import { LoginForm } from './components/layout/LoginForm';
import { Toast } from './components/shared/Toast';
import { EventLogDrawer } from './components/shared/EventLogDrawer';
import { DtmfCaptureModal } from './components/tools/DtmfCaptureModal';
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
  const [dtmfModal, setDtmfModal] = useState<{ channel: string; sipUser: string } | null>(null);

  // Initialize WebSocket connection
  useWebSocket();

  // Listen for DTMF start/done to show/hide modal
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === 'dtmf_start') {
        setDtmfModal({ channel: msg.channel || '', sipUser: msg.sipUser || '' });
      }
      // dtmf_done is handled by DtmfCaptureModal's saveAndClose which calls onClose
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, []);

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
      {dtmfModal && (
        <DtmfCaptureModal
          channel={dtmfModal.channel}
          sipUser={dtmfModal.sipUser}
          onClose={() => setDtmfModal(null)}
        />
      )}
      <EventLogDrawer />
      <Toast />
      <footer className="fixed bottom-0 left-0 w-full text-center py-3 text-xs text-[#555] tracking-wider" style={{ pointerEvents: 'none' }}>
        Created by L0Ki for Cyborg Telecom
      </footer>
    </div>
  );
}
