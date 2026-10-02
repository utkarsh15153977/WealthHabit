import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import argon2 from 'argon2';

vi.mock('../src/services/prismaAuthService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/prismaAuthService.js')>();
  return { ...actual, findUserByEmail: vi.fn() };
});

import { login } from '../src/controllers/authController.js';
import { findUserByEmail } from '../src/services/prismaAuthService.js';
import { authService, DUMMY_PASSWORD_HASH } from '../src/services/authService.js';
import { AuthErrorCodes } from '../src/types/auth.js';
import { AppError } from '../src/utils/errors.js';
import type { AuthenticatedRequest } from '../src/middleware/authMiddleware.js';

const findUserByEmailMock = vi.mocked(findUserByEmail);

function loginRequest(password = 'WrongPassword123!'): AuthenticatedRequest {
  return {
    body: { email: 'someone@example.com', password },
  } as unknown as AuthenticatedRequest;
}

const emptyResponse = () => ({}) as Response;

beforeEach(() => {
  vi.restoreAllMocks();
  findUserByEmailMock.mockReset();
  vi.spyOn(authService, 'verifyPassword').mockResolvedValue(false);
});

describe('Login timing enumeration mitigation (H-8)', () => {
  it('burns exactly one Argon2 verification against the dummy hash when the account does not exist', async () => {
    findUserByEmailMock.mockResolvedValue(null);
    const verifySpy = vi.mocked(authService.verifyPassword);

    await expect(login(loginRequest(), emptyResponse())).rejects.toMatchObject({
      statusCode: 401,
      code: AuthErrorCodes.INVALID_CREDENTIALS,
      message: 'Invalid email or password',
    });

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith(DUMMY_PASSWORD_HASH, 'WrongPassword123!');
  });

  it('performs exactly one Argon2 verification against the stored hash when the password is wrong', async () => {
    findUserByEmailMock.mockResolvedValue({
      id: 'user-1',
      email: 'someone@example.com',
      firstName: 'Some',
      lastName: 'One',
      passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$stored$hash',
      role: 'USER',
      status: 'ACTIVE',
    } as Awaited<ReturnType<typeof findUserByEmail>>);
    const verifySpy = vi.mocked(authService.verifyPassword);

    await expect(login(loginRequest(), emptyResponse())).rejects.toMatchObject({
      statusCode: 401,
      code: AuthErrorCodes.INVALID_CREDENTIALS,
      message: 'Invalid email or password',
    });

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith('$argon2id$v=19$m=65536,p=1,t=3$stored$hash', 'WrongPassword123!');
  });

  it('keeps the externally visible failure identical for unknown accounts and wrong passwords', async () => {
    findUserByEmailMock.mockResolvedValue(null);
    const unknownError = await login(loginRequest(), emptyResponse()).catch((error: unknown) => error);

    findUserByEmailMock.mockResolvedValue({
      id: 'user-1',
      email: 'someone@example.com',
      firstName: 'Some',
      lastName: 'One',
      passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$stored$hash',
      role: 'USER',
      status: 'ACTIVE',
    } as Awaited<ReturnType<typeof findUserByEmail>>);
    const wrongPasswordError = await login(loginRequest(), emptyResponse()).catch((error: unknown) => error);

    expect(unknownError).toBeInstanceOf(AppError);
    expect(wrongPasswordError).toBeInstanceOf(AppError);

    const left = unknownError as AppError;
    const right = wrongPasswordError as AppError;

    expect(left.message).toBe(right.message);
    expect(left.statusCode).toBe(right.statusCode);
    expect(left.code).toBe(right.code);
  });

  it('uses a well-formed argon2id dummy hash with the exact hashPassword parameters', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);

    // Raw argon2 (uncaught) rejects on malformed hashes: resolving false proves
    // the dummy hash is well-formed while never verifying any password.
    await expect(argon2.verify(DUMMY_PASSWORD_HASH, 'anything')).resolves.toBe(false);
    await expect(argon2.verify(DUMMY_PASSWORD_HASH, '')).resolves.toBe(false);
  });
});
