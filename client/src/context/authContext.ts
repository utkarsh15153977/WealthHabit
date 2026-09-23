import { createContext } from 'react';
import type { LoginRequest, RegisterRequest, User } from '../types/auth';

export interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
