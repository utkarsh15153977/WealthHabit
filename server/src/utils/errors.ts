export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errors?: Record<string, string[]>;
  public readonly code?: string;

  constructor(message: string, statusCode = 500, errors?: Record<string, string[]>, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errors = errors;
    this.code = code;

    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message = 'Bad Request', errors?: Record<string, string[]>, code?: string) {
    return new AppError(message, 400, errors, code);
  }

  static unauthorized(message = 'Unauthorized', code?: string) {
    return new AppError(message, 401, undefined, code);
  }

  static forbidden(message = 'Forbidden', code?: string) {
    return new AppError(message, 403, undefined, code);
  }

  static notFound(message = 'Not Found', code?: string) {
    return new AppError(message, 404, undefined, code);
  }

  static internal(message = 'Internal Server Error', code?: string) {
    return new AppError(message, 500, undefined, code);
  }
}

export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError;
};