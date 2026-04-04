import { create } from 'zustand';
import type { UserRole, Permissions } from '@calltools/shared';

interface SipGroup {
  account: string;
  sipUsers: string[];
}

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  username: string | null;
  role: UserRole | null;
  sipUsers: string[];
  sipGroups: SipGroup[];
  permissions: Partial<Permissions>;
  version: string | null;
  selectedSipUser: string | null;

  login: (data: {
    token: string;
    username: string;
    role: UserRole;
    version: string;
    permissions: Record<string, boolean>;
    sipUsers: string[];
    sipGroups?: SipGroup[];
  }) => void;
  resume: (data: { username: string; role: UserRole }) => void;
  logout: () => void;
  updatePermissions: (perms: Record<string, boolean>) => void;
  setSelectedSipUser: (sip: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  token: sessionStorage.getItem('ct2_session_token'),
  username: null,
  role: null,
  sipUsers: [],
  sipGroups: [],
  permissions: {},
  version: null,
  selectedSipUser: null,

  login: (data) => {
    sessionStorage.setItem('ct2_session_token', data.token);
    set({
      isAuthenticated: true,
      token: data.token,
      username: data.username,
      role: data.role as UserRole,
      version: data.version,
      permissions: data.permissions,
      sipUsers: data.sipUsers,
      sipGroups: data.sipGroups ?? [],
    });
  },

  resume: (data) => {
    set({
      isAuthenticated: true,
      username: data.username,
      role: data.role as UserRole,
    });
  },

  logout: () => {
    sessionStorage.removeItem('ct2_session_token');
    set({
      isAuthenticated: false,
      token: null,
      username: null,
      role: null,
      sipUsers: [],
      sipGroups: [],
      permissions: {},
      version: null,
    });
  },

  updatePermissions: (perms) => {
    set({ permissions: perms });
  },

  setSelectedSipUser: (sip) => {
    set({ selectedSipUser: sip || null });
  },
}));
