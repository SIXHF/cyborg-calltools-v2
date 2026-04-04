import { create } from 'zustand';

export type TabId = 'monitor' | 'tools' | 'history' | 'settings' | 'billing' | 'admin';

interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration: number;
}

interface UiState {
  activeTab: TabId;
  wsConnected: boolean;
  toasts: ToastMessage[];
  eventLog: string[];

  setActiveTab: (tab: TabId) => void;
  setWsConnected: (connected: boolean) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  removeToast: (id: string) => void;
  addLogEntry: (entry: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: (localStorage.getItem('ct2_active_tab') as TabId) ?? 'monitor',
  wsConnected: false,
  toasts: [],
  eventLog: [],

  setActiveTab: (tab) => {
    localStorage.setItem('ct2_active_tab', tab);
    set({ activeTab: tab });
  },

  setWsConnected: (connected) => set({ wsConnected: connected }),

  addToast: (message, type = 'info', duration = 3000) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  addLogEntry: (entry) =>
    set((s) => {
      const log = [`[${new Date().toLocaleTimeString()}] ${entry}`, ...s.eventLog];
      return { eventLog: log.slice(0, 500) }; // Cap at 500 entries
    }),
}));
