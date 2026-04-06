import { create } from 'zustand';

export type TabId = 'monitor' | 'tools' | 'history' | 'settings' | 'billing' | 'admin';

interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'broadcast';
  duration: number;
  color?: string; // broadcast color: 'orange' | 'red' | 'green'
}

interface UiState {
  activeTab: TabId;
  wsConnected: boolean;
  toasts: ToastMessage[];
  eventLog: string[];
  adminSubPage: string;
  eventLogExpanded: boolean;

  setActiveTab: (tab: TabId) => void;
  setWsConnected: (connected: boolean) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'broadcast', duration?: number, color?: string) => void;
  removeToast: (id: string) => void;
  addLogEntry: (entry: string) => void;
  clearEventLog: () => void;
  setAdminSubPage: (page: string) => void;
  toggleEventLog: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: (localStorage.getItem('ct2_active_tab') as TabId) ?? 'monitor',
  wsConnected: false,
  toasts: [],
  eventLog: [],
  adminSubPage: localStorage.getItem('ct2_admin_page') ?? 'stats',
  eventLogExpanded: localStorage.getItem('ct2_log_expanded') === 'true',

  setActiveTab: (tab) => {
    localStorage.setItem('ct2_active_tab', tab);
    set({ activeTab: tab });
  },

  setWsConnected: (connected) => set({ wsConnected: connected }),

  addToast: (message, type = 'info', duration = 3000, color?: string) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration, color }] }));
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

  clearEventLog: () => set({ eventLog: [] }),

  setAdminSubPage: (page) => { localStorage.setItem('ct2_admin_page', page); set({ adminSubPage: page }); },
  toggleEventLog: () => set(s => { const next = !s.eventLogExpanded; localStorage.setItem('ct2_log_expanded', String(next)); return { eventLogExpanded: next }; }),
}));
