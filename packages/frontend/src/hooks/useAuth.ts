import { useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { wsSend } from './useWebSocket';

export function useAuth() {
  const { isAuthenticated, username, role, sipUsers, permissions, version, logout: storeLogout } = useAuthStore();

  const login = useCallback((username: string, password: string) => {
    wsSend({ cmd: 'login', username, password });
  }, []);

  const logout = useCallback(() => {
    wsSend({ cmd: 'logout' });
    storeLogout();
  }, [storeLogout]);

  return {
    isAuthenticated,
    username,
    role,
    sipUsers,
    permissions,
    version,
    login,
    logout,
    isAdmin: role === 'admin',
  };
}
