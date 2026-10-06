import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertSafeTestDatabaseUrl } from '../scripts/lib/dbSafety.js';

const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');

const prisma = new PrismaClient();

export const testPrisma = prisma;
export const testDatabase = testDatabaseName;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.budgetCategory.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.recurringTransaction.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.habitCompletion.deleteMany();
  await prisma.financialHabit.deleteMany();
  await prisma.challengeParticipantHabit.deleteMany();
  await prisma.challengeParticipant.deleteMany();
  await prisma.challengeHabitRequirement.deleteMany();
  await prisma.challenge.deleteMany();
  await prisma.goalContribution.deleteMany();
  await prisma.savingsGoal.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.liability.deleteMany();
  await prisma.wealthSnapshot.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.category.deleteMany();
  await prisma.session.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.recoveryCode.deleteMany();
  await prisma.userMfa.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.financialProfile.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(async () => {
  // Reserved for per-test cleanup if needed
});

export function createTestUser(overrides = {}) {
  const suffix = Math.random().toString(36).substring(7);
  return {
    email: `test-${suffix}@example.com`,
    password: 'StrongPassword123!',
    firstName: 'John',
    lastName: 'Doe',
    ...overrides,
  };
}

export function generateTestToken(): string {
  return 'test-token-' + Math.random().toString(36).substring(7);
}
