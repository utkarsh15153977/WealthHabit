import axios, { isAxiosError } from 'axios';
import type { ApiErrorPayload } from '../types/api';

interface ApiErrorBody {
  message?: string;
  errors?: Record<string, string[]>;
  error?: ApiErrorPayload;
}

const CODE_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Invalid email or password',
  ACCOUNT_SUSPENDED: 'Account suspended',
  ACCOUNT_DEACTIVATED: 'Account deactivated',
  EMAIL_EXISTS: 'An account with this email already exists',
  RATE_LIMIT_EXCEEDED: 'Too many requests, please try again later',
  VALIDATION_ERROR: 'Please check your input and try again',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again',
  TOKEN_INVALID: 'Your session is invalid. Please sign in again',
  TOKEN_REVOKED: 'Your session has ended. Please sign in again',
  UNAUTHORIZED: 'You need to sign in to continue',
  FORBIDDEN: 'You do not have permission to perform this action',
  INTERNAL_ERROR: 'Something went wrong. Please try again later',
  TRANSACTION_NOT_FOUND: 'Transaction not found',
  CATEGORY_NOT_FOUND: 'Category not found or unavailable',
  CATEGORY_IN_USE: 'This category is used by transactions and cannot be deleted',
  CATEGORY_ALREADY_EXISTS: 'A category with this name already exists',
  NOTIFICATION_NOT_FOUND: 'Notification not found',
  HABIT_NOT_FOUND: 'Habit not found',
  HABIT_INACTIVE: 'This habit is no longer active',
  HABIT_INVALID_DATE_RANGE: 'This habit is not active for the current period',
};

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Invalid request. Please check your input',
  401: 'Your session has expired. Please sign in again',
  403: 'You do not have permission to perform this action',
  404: 'Resource not found',
  409: 'This account already exists',
  429: 'Too many requests. Please try again later',
  500: 'Something went wrong. Please try again later',
  502: 'Something went wrong. Please try again later',
  503: 'Something went wrong. Please try again later',
};

function formatValidationErrors(errors: Record<string, string[]>): string {
  const first = Object.values(errors)[0]?.[0];
  return first ?? 'Please check your input and try again';
}

export function getApiErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const body = error.response?.data as ApiErrorBody | undefined;
    const code = body?.error?.code;
    const serverMessage = body?.error?.message || body?.message;

    if (code && CODE_MESSAGES[code]) {
      return CODE_MESSAGES[code];
    }

    if (status === 400 && body?.errors) {
      return formatValidationErrors(body.errors);
    }

    if (status !== undefined && STATUS_MESSAGES[status]) {
      if (status === 429) {
        return serverMessage || STATUS_MESSAGES[status];
      }
      if (status >= 500) {
        return STATUS_MESSAGES[status];
      }
      return serverMessage || STATUS_MESSAGES[status];
    }

    if (!error.response) {
      return 'Unable to connect to the server. Please check your connection and try again';
    }

    return serverMessage || error.message || 'An unexpected error occurred';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'An unexpected error occurred';
}

export function isNetworkError(error: unknown): boolean {
  return isAxiosError(error) && !error.response && axios.isAxiosError(error);
}
