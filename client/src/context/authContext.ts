import { createContext } from 'react';
import type {
  LoginRequest,
  LoginResult,
  MfaChallengeRequest,
  MfaRecoveryRequest,
  RegisterRequest,
  User,
} from '../types/auth';

export interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Resolves to a 2FA challenge when the account requires one. */
  login: (data: LoginRequest) => Promise<LoginResult>;
  /** Completes a 2FA login with a TOTP code returned by login. */
  completeTwoFactorChallenge: (data: MfaChallengeRequest) => Promise<User>;
  /** Completes a 2FA login with a recovery code returned by login. */
  completeTwoFactorRecovery: (data: MfaRecoveryRequest) => Promise<User>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  updateUser: (user: User) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
