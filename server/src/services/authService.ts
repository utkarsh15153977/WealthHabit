import argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { env } from '../config/index.js';
import { JwtPayload, AuthenticatedUser } from '../types/auth.js';
import { Role, AccountStatus } from '@prisma/client';
import { SignOptions } from 'jsonwebtoken';

const ACCESS_TOKEN_TYPE = 'access' as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function generateAccessToken(user: { id: string; role: Role }): string {
  const payload: JwtPayload = {
    sub: user.id,
    role: user.role,
    type: ACCESS_TOKEN_TYPE,
  };
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

function generateRefreshToken(): string {
  return randomBytes(64).toString('hex');
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function calculateRefreshExpiry(): Date {
  const now = new Date();
  return new Date(now.getTime() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}

function validateCookieConfig(): void {
  if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
    throw new Error('SameSite=None requires Secure=true (COOKIE_SECURE=true)');
  }
}

function setRefreshCookie(res: Response, token: string): void {
  validateCookieConfig();
  const cookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
  };
  res.cookie(env.COOKIE_NAME, token, cookieOptions);
}

function clearRefreshCookie(res: Response): void {
  validateCookieConfig();
  const cookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none',
    path: '/api/auth',
    maxAge: 0,
  };
  res.cookie(env.COOKIE_NAME, '', cookieOptions);
}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: AccountStatus;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
  };
}

export const authService = {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  calculateRefreshExpiry,
  setRefreshCookie,
  clearRefreshCookie,
  toAuthenticatedUser,
};