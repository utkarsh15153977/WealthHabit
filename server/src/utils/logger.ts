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

/**
 * Context keys whose *value* is a secret on sight alone (`accessToken`,
 * `apiKey`, `password`, ...). Such a value is replaced wholesale: it does not
 * need to look like `name=value` to be dangerous.
 */
const SENSITIVE_CONTEXT_KEY = /(?:PASSWORD|SECRET|TOKEN|KEY)/i;

function sanitizeContext(context: LogContext): LogContext {
  const safe: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (SENSITIVE_CONTEXT_KEY.test(key)) {
      safe[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      safe[key] = sanitizeErrorMessage(value);
      continue;
    }
    if (value === null || typeof value !== 'object') {
      safe[key] = value;
      continue;
    }
    // `LogContext` is primitives only at the type level, but types are not
    // runtime enforcement. If an object ever gets through, serialize it and
    // redact the serialization so a nested secret cannot reach the log as an
    // unexamined blob.
    try {
      safe[key] = sanitizeErrorMessage(JSON.stringify(value) ?? String(value));
    } catch {
      safe[key] = '[unserializable]';
    }
  }
  return safe;
}

export interface FormatOptions {
  /** Emit a single-line JSON record. Defaults to the production format. */
  json?: boolean;
}

/**
 * Builds one log record. Every string (message and context values) passes
 * through `sanitizeErrorMessage`, and context keys that name a secret have
 * their value dropped before anything is assembled — so the record is safe to
 * emit as-is, in either format. Neither branch is re-scanned afterwards: a
 * second pass over the encoded record would only be able to rewrite things
 * like `password":"x"` and would corrupt the record while doing it.
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
