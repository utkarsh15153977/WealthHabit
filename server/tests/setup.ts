import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

function resolveTestDatabaseName(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set for tests.');
  }

  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}". ` +
        'Tests require a dedicated database whose name ends with "_test". ' +
        'Run "npm run db:test:setup" and check server/vitest.config.ts.'
    );
  }

  return databaseName;
}

const testDatabaseName = resolveTestDatabaseName();

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
  await prisma.notification.deleteMany();
  await prisma.category.deleteMany();
  await prisma.session.deleteMany();
  await prisma.authToken.deleteMany();
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
