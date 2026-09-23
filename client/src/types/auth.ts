export type Role = 'USER' | 'ADMIN';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: AccountStatus;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface MeResponse {
  user: User;
}

export interface LogoutResponse {
  message: string;
}
