const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s@/]+@/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
const NAMED_SECRET =
  /\b([A-Za-z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY)[A-Za-z0-9_]*)\s*[=:]\s*[^\s&"']+/gi;

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(URL_CREDENTIALS, '$1[redacted]@')
    .replace(BEARER_TOKEN, 'Bearer [redacted]')
    .replace(JWT_VALUE, '[redacted-jwt]')
    .replace(NAMED_SECRET, '$1=[redacted]');
}
