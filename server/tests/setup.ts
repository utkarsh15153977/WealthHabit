import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const testPrisma = prisma;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.transaction.deleteMany();
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
