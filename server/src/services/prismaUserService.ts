import { Prisma, User, FinancialProfile } from '@prisma/client';
import { UpdateMeInput } from '../schemas/userSchemas.js';
import { prisma } from '../config/prisma.js';

export type UserWithFinancialProfile = User & {
  financialProfile: FinancialProfile | null;
};

export async function findUserWithProfile(userId: string): Promise<UserWithFinancialProfile | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { financialProfile: true },
  });
}

export async function updateUserWithProfile(
  userId: string,
  input: UpdateMeInput
): Promise<UserWithFinancialProfile | null> {
  const userData: Prisma.UserUpdateWithoutFinancialProfileInput = {};
  if (input.firstName !== undefined) userData.firstName = input.firstName;
  if (input.lastName !== undefined) userData.lastName = input.lastName;

  const financialData: Prisma.FinancialProfileUpdateWithoutUserInput = {};
  let hasFinancialFields = false;
  if (input.currency !== undefined) {
    financialData.currency = input.currency;
    hasFinancialFields = true;
  }
  if (input.monthlyIncomeTarget !== undefined) {
    financialData.monthlyIncomeTarget = input.monthlyIncomeTarget;
    hasFinancialFields = true;
  }
  if (input.monthlySavingsTarget !== undefined) {
    financialData.monthlySavingsTarget = input.monthlySavingsTarget;
    hasFinancialFields = true;
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length > 0) {
      await tx.user.update({
        where: { id: userId },
        data: userData,
      });
    }

    if (hasFinancialFields) {
      const existing = await tx.financialProfile.findUnique({ where: { userId } });

      if (existing) {
        await tx.financialProfile.update({
          where: { userId },
          data: financialData,
        });
      } else {
        await tx.financialProfile.create({
          data: {
            userId,
            currency:
              input.currency !== undefined
                ? input.currency
                : 'USD',
            monthlyIncomeTarget: input.monthlyIncomeTarget ?? null,
            monthlySavingsTarget: input.monthlySavingsTarget ?? null,
          },
        });
      }
    }
  });

  return findUserWithProfile(userId);
}
