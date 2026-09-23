import { config } from 'dotenv';
config();

function validateJwtSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET must be set in production');
    }
    return 'dev-secret-change-in-production';
  }

  if (secret === 'dev-secret-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET cannot be the default development value in production');
    }
    console.warn('WARNING: JWT_ACCESS_SECRET is using the default development value. Use a custom secret in production.');
    return secret;
  }

  if (secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET must be at least 32 characters in production');
    }
    console.warn('WARNING: JWT_ACCESS_SECRET is less than 32 characters. Use a stronger secret in production.');
  }

  return secret;
}

export const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  JWT_ACCESS_SECRET: validateJwtSecret(),
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  REFRESH_TOKEN_EXPIRES_DAYS: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '30', 10),
  COOKIE_NAME: process.env.COOKIE_NAME || 'wh_refresh_token',
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  COOKIE_SAME_SITE: (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};