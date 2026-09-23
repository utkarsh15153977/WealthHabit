import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  login as loginRequest,
  logout as logoutRequest,
  logoutAll as logoutAllRequest,
  me as meRequest,
  refresh as refreshRequest,
  register as registerRequest,
} from '../services/authApi';
import {
  getAccessToken,
  onAuthFailure,
  setAccessToken as setStoredAccessToken,
} from '../services/api';
import type { LoginRequest, RegisterRequest, User } from '../types/auth';
import { AuthContext } from './authContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(() => getAccessToken());
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const setToken = useCallback((token: string | null) => {
    setStoredAccessToken(token);
    setAccessTokenState(token);
  }, []);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setAccessTokenState(null);
  }, []);

  const updateUser = useCallback((nextUser: User) => {
    setUser(nextUser);
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const token = await refreshRequest();
      setAccessTokenState(token);
      const meResponse = await meRequest();
      setUser(meResponse.user);
      return true;
    } catch {
      setStoredAccessToken(null);
      clearAuthState();
      return false;
    }
  }, [clearAuthState]);

  useEffect(() => {
    return onAuthFailure(() => {
      clearAuthState();
    });
  }, [clearAuthState]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      await refreshSession();
      if (!cancelled) {
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  const login = useCallback(
    async (data: LoginRequest) => {
      const result = await loginRequest(data);
      setToken(result.accessToken);
      setUser(result.user);
    },
    [setToken]
  );

  const register = useCallback(
    async (data: RegisterRequest) => {
      const result = await registerRequest(data);
      setToken(result.accessToken);
      setUser(result.user);
    },
    [setToken]
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Continue clearing local session even if the server call fails
    }
    setToken(null);
    clearAuthState();
    navigate('/login', { replace: true });
  }, [clearAuthState, navigate, setToken]);

  const logoutAll = useCallback(async () => {
    try {
      await logoutAllRequest();
    } catch {
      // Continue clearing local session even if the server call fails
    }
    setToken(null);
    clearAuthState();
    navigate('/login', { replace: true });
  }, [clearAuthState, navigate, setToken]);

  const value = useMemo(
    () => ({
      user,
      accessToken,
      isAuthenticated: user !== null,
      isLoading,
      login,
      register,
      logout,
      logoutAll,
      refreshSession,
      updateUser,
    }),
    [user, accessToken, isLoading, login, register, logout, logoutAll, refreshSession, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
