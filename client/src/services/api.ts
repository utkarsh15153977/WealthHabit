import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let accessToken: string | null = null;
let authFailureListeners: (() => void)[] = [];

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const NO_REFRESH_URLS = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/logout'];

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function onAuthFailure(listener: () => void): () => void {
  authFailureListeners.push(listener);
  return () => {
    authFailureListeners = authFailureListeners.filter((l) => l !== listener);
  };
}

function notifyAuthFailure(): void {
  accessToken = null;
  authFailureListeners.forEach((listener) => listener());
}

const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let refreshPromise: Promise<string> | null = null;

export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await refreshClient.post<{ success?: boolean; data?: { accessToken?: string } }>(
          '/auth/refresh',
          {}
        );
        const token = response.data?.data?.accessToken;
        if (!token) {
          throw new Error('Refresh response missing access token');
        }
        accessToken = token;
        return token;
      } catch (error) {
        accessToken = null;
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryableConfig | undefined;
    const url = original?.url ?? '';

    const shouldAttemptRefresh =
      error.response?.status === 401 &&
      original !== undefined &&
      original._retry !== true &&
      !NO_REFRESH_URLS.some((noRefreshUrl) => url.includes(noRefreshUrl));

    if (shouldAttemptRefresh && original) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshError) {
        notifyAuthFailure();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
