import { env } from '../config/index.js';
import { sanitizeErrorMessage } from './redact.js';

export type LogLevel = 'info' | 'error';

/**
 * Log context values are primitives only. This is intentionally narrow so a
 * caller cannot accidentally serialize a request, response, headers, cookies
 * or any other object graph into the logs.
 */
export type LogContext = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

function sanitizeContext(context: LogContext): LogContext {
  const safe: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    safe[key] = typeof value === 'string' ? sanitizeErrorMessage(value) : value;
  }
  return safe;
}

export interface FormatOptions {
  /** Emit a single-line JSON record. Defaults to the production format. */
  json?: boolean;
}

/**
 * Builds one log record. Every string (message and context values) passes
 * through `sanitizeErrorMessage`, so no caller can bypass the 5G.3
 * redaction protection.
 */
export function formatLogEntry(
  level: LogLevel,
  message: string,
  context: LogContext = {},
  options: FormatOptions = {}
): string {
  const safeMessage = sanitizeErrorMessage(message);
  const safeContext = sanitizeContext(context);
  const useJson = options.json ?? env.isProduction;

  if (useJson) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: safeMessage,
      ...safeContext,
    });
  }

  const header = `${level.toUpperCase()} ${safeMessage}`;
  const lines = Object.entries(safeContext).map(([key, value]) => `  ${key}: ${String(value)}`);
  return lines.length === 0 ? header : `${header}\n${lines.join('\n')}`;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const line = formatLogEntry(level, message, context);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger: Logger = {
  info: (message, context) => emit('info', message, context),
  error: (message, context) => emit('error', message, context),
};
