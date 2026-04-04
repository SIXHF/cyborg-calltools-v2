import { create } from 'zustand';
import type { UserRole, Permissions } from '@calltools/shared';

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  username: string | null;
  role: UserRole | null;
  sipUsers: string[];
  permissions: Partial<Permissions>;
  version: string | null;

  login: (data: {
    token: string;
    username: string;
    role: UserRole;
    version: string;
    permissions: Record<string, boolean>;
    sipUsers: string[];
  }) => void;
  resume: (data: { username: string; role: UserRole }) => void;
  logout: () => void;
  updatePermissions: (perms: Record<string, boolean>) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  token: sessionStorage.getItem('ct2_session_token'),
  username: null,
  role: null,
  sipUsers: [],
  permissions: {},
  version: null,

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
      permissions: {},
      version: null,
    });
  },

  updatePermissions: (perms) => {
    set({ permissions: perms });
  },
}));
