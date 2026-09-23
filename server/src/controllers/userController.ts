import { Response } from 'express';
import { FinancialProfile } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import { UpdateMeInput } from '../schemas/userSchemas.js';
import {
  findUserWithProfile,
  updateUserWithProfile,
  UserWithFinancialProfile,
} from '../services/prismaUserService.js';
import { AppError } from '../utils/errors.js';
import { AuthErrorCodes } from '../types/auth.js';
import { FinancialProfileData, ProfileData, UserProfile } from '../types/user.js';

function toFinancialProfileData(profile: FinancialProfile | null): FinancialProfileData {
  if (!profile) {
    return {
      currency: 'USD',
      monthlyIncomeTarget: null,
      monthlySavingsTarget: null,
    };
  }

  return {
    currency: profile.currency,
    monthlyIncomeTarget:
      profile.monthlyIncomeTarget === null ? null : Number(profile.monthlyIncomeTarget),
    monthlySavingsTarget:
      profile.monthlySavingsTarget === null ? null : Number(profile.monthlySavingsTarget),
  };
}

function toUserProfile(user: UserWithFinancialProfile): UserProfile {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    financialProfile: toFinancialProfileData(user.financialProfile),
  };
}

export async function getMyProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const user = await findUserWithProfile(userId);

  if (!user) {
    throw new AppError('User not found', 404, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const data: ProfileData = { profile: toUserProfile(user) };

  res.json({
    success: true,
    data,
  });
}

export async function updateMyProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as UpdateMeInput;

  const user = await updateUserWithProfile(userId, input);

  if (!user) {
    throw new AppError('User not found', 404, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const data: ProfileData = { profile: toUserProfile(user) };

  res.json({
    success: true,
    data,
  });
}
