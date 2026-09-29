import type { HelmetOptions } from 'helmet';
import { env } from './index.js';

const HSTS_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/**
 * Explicit, environment-aware CSP. The API only emits JSON, so this is a
 * defence-in-depth control rather than one that governs the Vite client
 * (which runs on its own origin). `upgrade-insecure-requests` is
 * production-only: it rewrites `http://localhost:5000` navigations to
 * `https://` and would break local development.
 */
export function buildContentSecurityPolicyDirectives(
  isProduction: boolean
): Record<string, string[]> {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'font-src': ["'self'", 'https:', 'data:'],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'object-src': ["'none'"],
    'script-src': ["'self'"],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", 'https:', "'unsafe-inline'"],
  };

  if (isProduction) {
    directives['upgrade-insecure-requests'] = [];
  }

  return directives;
}

/**
 * HSTS tells browsers to treat the host as HTTPS-only for `maxAge` seconds,
 * including subdomains. It must never be emitted outside production, where
 * the API is served over plain HTTP.
 */
export function buildStrictTransportSecurityOption(
  isProduction: boolean
): { maxAge: number; includeSubDomains: boolean } | false {
  if (!isProduction) {
    return false;
  }

  return { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true };
}

/**
 * Every helmet option is pinned so a helmet upgrade cannot silently change
 * the headers this application sends.
 */
export function buildSecurityHeaderOptions(isProduction: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: buildContentSecurityPolicyDirectives(isProduction),
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
    referrerPolicy: { policy: ['no-referrer'] },
    strictTransportSecurity: buildStrictTransportSecurityOption(isProduction),
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xFrameOptions: { action: 'sameorigin' },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xPoweredBy: true,
    xXssProtection: true,
  };
}

export { HSTS_MAX_AGE_SECONDS };

export const securityHeaderOptions: HelmetOptions = buildSecurityHeaderOptions(
  env.isProduction
);
