export interface ApiErrorPayload {
  code: string;
  message: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: Record<string, string[]>;
  error?: ApiErrorPayload;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface HealthResponse {
  success: boolean;
  message: string;
}