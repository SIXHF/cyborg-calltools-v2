import { useState, useEffect, useCallback } from 'react';
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
import { LiveTranscriptModal } from './components/tools/LiveTranscriptModal';
import { useUiStore } from './stores/uiStore';
import { EventLogDrawer } from './components/shared/EventLogDrawer';

export function App() {
  const { isAuthenticated } = useAuthStore();
  const { activeTab } = useUiStore();
  const [transcriptChannel, setTranscriptChannel] = useState<string | null>(null);

  // Initialize WebSocket connection
  useWebSocket();

  const handleTranscriptStart = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    setTranscriptChannel(detail.channel);
  }, []);

  const handleTranscriptDone = useCallback(() => {
    setTranscriptChannel(null);
  }, []);

  useEffect(() => {
    window.addEventListener('transcript_start', handleTranscriptStart);
    window.addEventListener('transcript_done', handleTranscriptDone);
    return () => {
      window.removeEventListener('transcript_start', handleTranscriptStart);
      window.removeEventListener('transcript_done', handleTranscriptDone);
    };
  }, [handleTranscriptStart, handleTranscriptDone]);

  const handleCloseTranscript = useCallback(() => {
    setTranscriptChannel(null);
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <LoginForm />
        <Toast />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <TabNav />
      <main className="flex-1 mx-auto w-full" style={{ maxWidth: 1000, padding: '24px', paddingBottom: '60px' }}>
        {activeTab === 'monitor' && <MonitorTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'history' && <HistoryTab />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'billing' && <BillingTab />}
        {activeTab === 'admin' && <AdminTab />}
      </main>
      {transcriptChannel && (
        <LiveTranscriptModal channel={transcriptChannel} onClose={handleCloseTranscript} />
      )}
      <Toast />
      <EventLogDrawer />
    </div>
  );
}
