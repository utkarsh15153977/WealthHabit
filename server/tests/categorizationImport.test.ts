import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, TransactionSource } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  financialConnectionRouter,
  financialAccountRouter,
} from '../src/routes/financialConnectionRoutes.js';
import { syncFinancialAccount } from '../src/services/prismaFinancialSyncService.js';
import { seedDefaultCategories } from '../src/services/defaultCategoryService.js';

const FULL_WINDOW = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-10-08T00:00:00.000Z'),
};

const RECENT_WINDOW = {
  from: new Date('2026-10-05T00:00:00.000Z'),
  to: new Date('2026-10-08T00:00:00.000Z'),
};

describe('Import categorization', () => {
  let app: express.Express;
  let userA: { id: string; email: string; password: string; firstName: string; lastName: string };
  let userB: { id: string; email: string; password: string; firstName: string; lastName: string };
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    await seedDefaultCategories(testPrisma);

    const a = createTestUser();
    const b = createTestUser();
    const hashA = await hashPassword(a.password);
    const hashB = await hashPassword(b.password);

    const createdA = await testPrisma.user.create({
      data: {
        email: a.email,
        passwordHash: hashA,
        firstName: a.firstName,
        lastName: a.lastName,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });
    const createdB = await testPrisma.user.create({
      data: {
        email: b.email,
        passwordHash: hashB,
        firstName: b.firstName,
        lastName: b.lastName,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });

    userA = { ...a, id: createdA.id };
    userB = { ...b, id: createdB.id };
    tokenA = authService.generateAccessToken({ id: createdA.id, role: createdA.role });
    tokenB = authService.generateAccessToken({ id: createdB.id, role: createdB.role });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/financial-connections', financialConnectionRouter);
    app.use('/api/financial-accounts', financialAccountRouter);
    app.use(errorHandler);
  });

  async function connectMock(token: string): Promise<string[]> {
    const res = await request(app)
      .post('/api/financial-connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'MOCK' });
    expect(res.status).toBe(201);
    return res.body.data.accounts.map((account: { id: string }) => account.id);
  }

  async function categoryOfMerchant(
    userId: string,
    merchant: string
  ): Promise<string | undefined> {
    const tx = await testPrisma.transaction.findFirst({
      where: { userId, merchant },
      include: { category: true },
    });
    return tx?.category.name;
  }

  it('categorizes the first sync through the built-in merchant rules', async () => {
    const accountIds = await connectMock(tokenA);

    const result = await syncFinancialAccount(accountIds[0], userA.id, FULL_WINDOW);
    expect(result).toMatchObject({
      transactionsFetched: 19,
      transactionsImported: 19,
      transactionsSkipped: 0,
    });

    expect(await categoryOfMerchant(userA.id, 'Swiggy')).toBe('Food');
    expect(await categoryOfMerchant(userA.id, 'BigBasket')).toBe('Food');
    expect(await categoryOfMerchant(userA.id, 'Reliance Fresh')).toBe('Food');
    expect(await categoryOfMerchant(userA.id, 'Amazon')).toBe('Shopping');
    expect(await categoryOfMerchant(userA.id, 'Uber')).toBe('Transportation');
    expect(await categoryOfMerchant(userA.id, 'MSEB')).toBe('Utilities');
    expect(await categoryOfMerchant(userA.id, 'Netflix')).toBe('Entertainment');
    expect(await categoryOfMerchant(userA.id, 'HP Petrol Pump')).toBe('Transportation');
    expect(await categoryOfMerchant(userA.id, 'HDFC ATM')).toBe('Other Expense');
    expect(await categoryOfMerchant(userA.id, 'Cafe Coffee Day')).toBe('Other Expense');
    expect(await categoryOfMerchant(userA.id, 'IndiGo')).toBe('Other Expense');
    expect(await categoryOfMerchant(userA.id, 'Truffles')).toBe('Other Expense');

    const acme = await testPrisma.transaction.findFirst({
      where: { userId: userA.id, merchant: 'Acme Corp' },
      include: { category: true },
    });
    expect(acme?.type).toBe('INCOME');
    expect(acme?.category.name).toBe('Salary');
    expect(acme?.category.type).toBe('INCOME');

    const imported = await testPrisma.transaction.findMany({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
      include: { category: true },
    });
    expect(imported).toHaveLength(19);
    for (const row of imported) {
      expect(row.category).not.toBeNull();
    }
  });

  it('imports nothing on a second sync and leaves categories untouched', async () => {
    const accountIds = await connectMock(tokenA);

    await syncFinancialAccount(accountIds[0], userA.id, FULL_WINDOW);
    const before = await testPrisma.transaction.findMany({
      where: { userId: userA.id },
      select: { id: true, categoryId: true },
    });

    const second = await syncFinancialAccount(accountIds[0], userA.id, FULL_WINDOW);
    expect(second).toMatchObject({
      transactionsFetched: 19,
      transactionsImported: 0,
      transactionsSkipped: 19,
    });

    const after = await testPrisma.transaction.findMany({
      where: { userId: userA.id },
      orderBy: { id: 'asc' },
      select: { id: true, categoryId: true },
    });
    expect(after).toHaveLength(19);
    expect(after).toEqual([...before].sort((left, right) => left.id.localeCompare(right.id)));
  });

  it('applies a user learned rule to later imports for that user only', async () => {
    const accountsA = await connectMock(tokenA);
    const accountsB = await connectMock(tokenB);

    // First pass imports only 2026-10-05..2026-10-07 (5 rows), which includes
    // the HDFC Amazon row.
    const firstPass = await syncFinancialAccount(accountsA[0], userA.id, RECENT_WINDOW);
    expect(firstPass).toMatchObject({
      transactionsFetched: 5,
      transactionsImported: 5,
      transactionsSkipped: 0,
    });

    const earlyAmazon = await testPrisma.transaction.findFirst({
      where: { userId: userA.id, merchant: 'Amazon' },
      include: { category: true },
    });
    expect(earlyAmazon).not.toBeNull();
    expect(earlyAmazon?.category.name).toBe('Shopping');

    // User A learns: Amazon transactions belong to Food.
    const globalFood = await testPrisma.category.findFirst({
      where: { userId: null, name: 'Food' },
    });
    expect(globalFood).not.toBeNull();
    await testPrisma.transactionCategoryRule.create({
      data: { userId: userA.id, normalizedMerchant: 'amazon', categoryId: globalFood!.id },
    });

    // Full sync fetches all 19 provider rows and imports the remaining 14,
    // including the ICICI Amazon row.
    const secondPass = await syncFinancialAccount(accountsA[0], userA.id, FULL_WINDOW);
    expect(secondPass).toMatchObject({
      transactionsFetched: 19,
      transactionsImported: 14,
      transactionsSkipped: 5,
    });

    const amazonRows = await testPrisma.transaction.findMany({
      where: { userId: userA.id, merchant: 'Amazon' },
      include: { category: true },
      orderBy: { transactionDate: 'asc' },
    });
    expect(amazonRows).toHaveLength(2);

    // The row imported before the rule existed keeps its category: sync never
    // silently recategorizes history...
    const untouched = amazonRows.find((row) => row.id === earlyAmazon!.id);
    expect(untouched?.category.name).toBe('Shopping');

    // ...while the newly imported row is categorized through the rule.
    const newlyImported = amazonRows.find((row) => row.id !== earlyAmazon!.id);
    expect(newlyImported?.category.name).toBe('Food');

    // User B has no such rule: built-in categorization applies unchanged.
    await syncFinancialAccount(accountsB[0], userB.id, FULL_WINDOW);
    const amazonB = await testPrisma.transaction.findFirst({
      where: { userId: userB.id, merchant: 'Amazon' },
      include: { category: true },
    });
    expect(amazonB?.category.name).toBe('Shopping');
  });

  it('ignores inactive user rules during import', async () => {
    const accountIds = await connectMock(tokenA);
    const globalFood = await testPrisma.category.findFirst({
      where: { userId: null, name: 'Food' },
    });

    await testPrisma.transactionCategoryRule.create({
      data: {
        userId: userA.id,
        normalizedMerchant: 'amazon',
        categoryId: globalFood!.id,
        isActive: false,
      },
    });

    await syncFinancialAccount(accountIds[0], userA.id, FULL_WINDOW);
    expect(await categoryOfMerchant(userA.id, 'Amazon')).toBe('Shopping');
  });

  it('keeps the sync summary shape unchanged', async () => {
    const accountIds = await connectMock(tokenA);
    const result = await syncFinancialAccount(accountIds[0], userA.id, FULL_WINDOW);

    expect(result).toMatchObject({
      accountId: accountIds[0],
      transactionsFetched: 19,
      transactionsImported: 19,
      transactionsSkipped: 0,
    });
    expect(result.lastSyncedAt).toBeInstanceOf(Date);
  });
});
