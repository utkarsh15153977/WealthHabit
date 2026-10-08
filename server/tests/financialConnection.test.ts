import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, TransactionSource, FinancialConnectionStatus } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { financialConnectionRouter, financialAccountRouter } from '../src/routes/financialConnectionRoutes.js';
import { syncFinancialAccount } from '../src/services/prismaFinancialSyncService.js';
import { seedDefaultCategories } from '../src/services/defaultCategoryService.js';

describe('Financial Connections API', () => {
  let app: express.Express;
  let userA: { id: string; email: string; password: string; firstName: string; lastName: string };
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
    tokenA = authService.generateAccessToken({ id: createdA.id, role: createdA.role });
    tokenB = authService.generateAccessToken({ id: createdB.id, role: createdB.role });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/financial-connections', financialConnectionRouter);
    app.use('/api/financial-accounts', financialAccountRouter);
    app.use(errorHandler);
  });

  async function createMockConnection(token: string) {
    return request(app)
      .post('/api/financial-connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'MOCK' });
  }

  it('creates a MOCK connection and creates financial accounts', async () => {
    const res = await createMockConnection(tokenA);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.provider).toBe('MOCK');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
    expect(res.body.data.accounts.length).toBe(3);
  });

  it('prevents duplicate MOCK connection for same user', async () => {
    await createMockConnection(tokenA);
    const res = await createMockConnection(tokenA);
    expect(res.status).toBe(409);
  });

  it('lists only authenticated user connections', async () => {
    await createMockConnection(tokenA);
    const resA = await request(app).get('/api/financial-connections').set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(200);
    expect(resA.body.data.length).toBe(1);

    const resB = await request(app).get('/api/financial-connections').set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.length).toBe(0);
  });

  it('gets connection details', async () => {
    const createRes = await createMockConnection(tokenA);
    const connId = createRes.body.data.id;
    const res = await request(app).get(`/api/financial-connections/${connId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(connId);
    expect(res.body.data.accounts.length).toBe(3);
  });

  it('enforces user isolation on get connection', async () => {
    const createRes = await createMockConnection(tokenA);
    const connId = createRes.body.data.id;
    const res = await request(app).get(`/api/financial-connections/${connId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it('disconnects connection without deleting transactions', async () => {
    const createRes = await createMockConnection(tokenA);
    const connId = createRes.body.data.id;
    const accountId = createRes.body.data.accounts[0].id;

    await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);

    const txCountBefore = await testPrisma.transaction.count({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });

    const res = await request(app).delete(`/api/financial-connections/${connId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);

    const conn = await testPrisma.financialConnection.findUnique({ where: { id: connId } });
    expect(conn?.status).toBe(FinancialConnectionStatus.DISCONNECTED);
    expect(conn?.revokedAt).not.toBeNull();

    const txCountAfter = await testPrisma.transaction.count({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });
    expect(txCountAfter).toBe(txCountBefore);

    const disconnectedTxns = await testPrisma.transaction.findMany({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });
    for (const t of disconnectedTxns) {
      expect(t.financialAccountId).toBeNull();
    }
  });

  it('lists accounts with filtering', async () => {
    const createRes = await createMockConnection(tokenA);
    const connId = createRes.body.data.id;

    const resAll = await request(app).get('/api/financial-accounts').set('Authorization', `Bearer ${tokenA}`);
    expect(resAll.status).toBe(200);
    expect(resAll.body.data.accounts.length).toBe(3);

    const resFiltered = await request(app).get(`/api/financial-accounts?connectionId=${connId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(resFiltered.status).toBe(200);
    expect(resFiltered.body.data.accounts.length).toBe(3);

    const resB = await request(app).get('/api/financial-accounts').set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.accounts.length).toBe(0);
  });

  it('gets account by id with ownership check', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    const res = await request(app).get(`/api/financial-accounts/${accountId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(accountId);

    const resB = await request(app).get(`/api/financial-accounts/${accountId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(404);
  });

  it('rejects filtered by other user connectionId', async () => {
    await createMockConnection(tokenA);
    const createResB = await createMockConnection(tokenB);
    const connIdB = createResB.body.data.id;

    const res = await request(app).get(`/api/financial-accounts?connectionId=${connIdB}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('sync first and second - idempotent', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    const first = await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);
    expect(first.status).toBe(200);
    expect(first.body.data.transactionsFetched).toBe(19);
    expect(first.body.data.transactionsImported).toBe(19);
    expect(first.body.data.transactionsSkipped).toBe(0);

    const importedCountBefore = await testPrisma.transaction.count({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });

    const second = await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);
    expect(second.status).toBe(200);
    expect(second.body.data.transactionsFetched).toBe(19);
    expect(second.body.data.transactionsImported).toBe(0);
    expect(second.body.data.transactionsSkipped).toBe(19);

    const importedCountAfter = await testPrisma.transaction.count({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });
    expect(importedCountAfter).toBe(importedCountBefore);
  });

  it('validates imported transaction fields and UPI channels', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);

    const imported = await testPrisma.transaction.findMany({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });
    expect(imported.length).toBe(19);

    const connectionAccountIds = createRes.body.data.accounts.map(
      (account: { id: string }) => account.id
    );
    const perAccountCounts = new Map<string, number>();
    for (const t of imported) {
      expect(t.source).toBe(TransactionSource.IMPORTED);
      expect(t.financialAccountId).not.toBeNull();
      expect(connectionAccountIds).toContain(t.financialAccountId);
      expect(t.merchant).toBeTruthy();
      expect(t.categoryId).not.toBeNull();
      expect(Number(t.amount)).toBeGreaterThan(0);
      perAccountCounts.set(
        t.financialAccountId!,
        (perAccountCounts.get(t.financialAccountId!) ?? 0) + 1
      );
    }

    // 19 provider rows split across the 3 mock accounts (9 savings / 5 debit / 5 credit),
    // each linked to the FinancialAccount owning its externalAccountId.
    expect(perAccountCounts.get(connectionAccountIds[0])).toBe(9);
    expect(perAccountCounts.get(connectionAccountIds[1])).toBe(5);
    expect(perAccountCounts.get(connectionAccountIds[2])).toBe(5);

    const upiTxns = await testPrisma.transaction.findMany({
      where: {
        userId: userA.id,
        source: TransactionSource.IMPORTED,
        paymentMethod: 'UPI',
      },
    });
    const channels = upiTxns.map((t) => t.paymentChannel).filter(Boolean);
    expect(channels.some((c) => c === 'GOOGLEPAY')).toBe(true);
    expect(channels.some((c) => c === 'PHONEPE')).toBe(true);
  });

  it('category mappings work', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);

    const imported = await testPrisma.transaction.findMany({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
      include: { category: true },
    });

    const swiggy = imported.find((t) => t.merchant?.toLowerCase().includes('swiggy'));
    expect(swiggy).toBeDefined();
    expect(swiggy!.category.name).toBe('Food');
    expect(swiggy!.category.type).toBe('EXPENSE');

    const amazon = imported.find((t) => t.merchant?.toLowerCase().includes('amazon'));
    expect(amazon).toBeDefined();
    expect(amazon!.category.name).toBe('Shopping');

    const uber = imported.find((t) => t.merchant?.toLowerCase().includes('uber'));
    expect(uber).toBeDefined();
    expect(uber!.category.name).toBe('Transportation');

    const salary = imported.find((t) => t.type === 'INCOME');
    expect(salary).toBeDefined();
    expect(salary!.category.name).toBe('Salary');
    expect(salary!.category.type).toBe('INCOME');

    const electricity = imported.find((t) => t.merchant?.toLowerCase().includes('mseb'));
    expect(electricity).toBeDefined();
    expect(electricity!.category.name).toBe('Utilities');

    const netflix = imported.find((t) => t.merchant?.toLowerCase().includes('netflix'));
    expect(netflix).toBeDefined();
    expect(netflix!.category.name).toBe('Entertainment');

    const fuel = imported.find((t) => t.merchant?.toLowerCase().includes('hp petrol'));
    expect(fuel).toBeDefined();
    expect(fuel!.category.name).toBe('Transportation');
  });

  it('writes audit events for create, sync and disconnect', async () => {
    const createRes = await createMockConnection(tokenA);
    const connId = createRes.body.data.id;
    const accountId = createRes.body.data.accounts[0].id;

    await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);
    await request(app).delete(`/api/financial-connections/${connId}`).set('Authorization', `Bearer ${tokenA}`);

    const actions = (await testPrisma.auditLog.findMany({ where: { actorUserId: userA.id } })).map(
      (log) => log.action
    );
    expect(actions).toContain('FINANCIAL_CONNECTION_CREATED');
    expect(actions).toContain('FINANCIAL_SYNC_COMPLETED');
    expect(actions).toContain('FINANCIAL_CONNECTION_DISCONNECTED');

    const syncLog = await testPrisma.auditLog.findFirst({
      where: { actorUserId: userA.id, action: 'FINANCIAL_SYNC_COMPLETED' },
    });
    expect(syncLog).not.toBeNull();
    const metadata = syncLog!.metadata as Record<string, unknown>;
    expect(metadata.transactionsFetched).toBe(19);
    expect(metadata.transactionsImported).toBe(19);
    expect(metadata.provider).toBe('MOCK');
    const metadataString = JSON.stringify(metadata);
    expect(metadataString).not.toMatch(/token|credential|secret/i);
  });

  it('updates lastSyncedAt on account and connection after sync', async () => {
    const createRes = await createMockConnection(tokenA);
    const connId = createRes.body.data.id;
    const accountId = createRes.body.data.accounts[0].id;
    expect(createRes.body.data.lastSyncedAt).toBeNull();

    await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);

    const account = await testPrisma.financialAccount.findUnique({ where: { id: accountId } });
    expect(account?.lastSyncedAt).not.toBeNull();

    const connection = await testPrisma.financialConnection.findUnique({ where: { id: connId } });
    expect(connection?.lastSyncedAt).not.toBeNull();
  });

  it('rejects sync on a disconnected connection', async () => {
    const createRes = await createMockConnection(tokenA);
    const connId = createRes.body.data.id;
    const accountId = createRes.body.data.accounts[0].id;

    await request(app).delete(`/api/financial-connections/${connId}`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);
    // account rows are removed on disconnect, so the account itself is gone
    expect(res.status).toBe(404);
  });

  it('rejects sync for a connection whose status is not ACTIVE', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    await testPrisma.financialConnection.update({
      where: { id: createRes.body.data.id },
      data: { status: 'REVOKED' },
    });

    const res = await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONNECTION_REVOKED');
  });

  it('returns SYNC_ALREADY_IN_PROGRESS for concurrent syncs', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    const first = syncFinancialAccount(accountId, userA.id);
    const second = syncFinancialAccount(accountId, userA.id);

    await expect(second).rejects.toMatchObject({
      code: 'SYNC_ALREADY_IN_PROGRESS',
      statusCode: 409,
    });

    const result = await first;
    expect(result.transactionsFetched).toBe(19);
    expect(result.transactionsImported).toBe(19);

    const count = await testPrisma.transaction.count({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });
    expect(count).toBe(19);
  });

  it('releases the sync lock after a sync finishes', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    const first = await syncFinancialAccount(accountId, userA.id);
    expect(first.transactionsImported).toBe(19);

    const second = await syncFinancialAccount(accountId, userA.id);
    expect(second.transactionsFetched).toBe(19);
    expect(second.transactionsImported).toBe(0);
    expect(second.transactionsSkipped).toBe(19);

    const count = await testPrisma.transaction.count({
      where: { userId: userA.id, source: TransactionSource.IMPORTED },
    });
    expect(count).toBe(19);
  });

  it('honours an explicit sync date range and rejects inverted ranges', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    const narrow = await request(app)
      .post(`/api/financial-accounts/${accountId}/sync?from=2026-10-01&to=2026-10-07`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(narrow.status).toBe(200);
    // 12 of the 19 provider rows fall inside 2026-10-01..2026-10-07, spread
    // across all three mock accounts (6 savings / 3 debit / 3 credit).
    expect(narrow.body.data.transactionsFetched).toBe(12);
    expect(narrow.body.data.transactionsImported).toBe(12);
    expect(narrow.body.data.transactionsSkipped).toBe(0);

    const inverted = await request(app)
      .post(`/api/financial-accounts/${accountId}/sync?from=2026-10-07&to=2026-10-01`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unsupported provider and invalid payloads', async () => {
    const unsupported = await request(app)
      .post('/api/financial-connections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ provider: 'ACCOUNT_AGGREGATOR' });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe('PROVIDER_NOT_SUPPORTED');

    const invalidProvider = await request(app)
      .post('/api/financial-connections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ provider: 'NOT_A_PROVIDER' });
    expect(invalidProvider.status).toBe(400);
    expect(invalidProvider.body.error.code).toBe('VALIDATION_ERROR');

    const missingProvider = await request(app)
      .post('/api/financial-connections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(missingProvider.status).toBe(400);

    const noAuth = await request(app).post('/api/financial-connections').send({ provider: 'MOCK' });
    expect(noAuth.status).toBe(401);
  });

  it('ownership and error cases', async () => {
    const createRes = await createMockConnection(tokenA);
    const accountId = createRes.body.data.accounts[0].id;

    const resSyncOther = await request(app).post(`/api/financial-accounts/${accountId}/sync`).set('Authorization', `Bearer ${tokenB}`);
    expect(resSyncOther.status).toBe(404);

    const resInvalid = await request(app).post('/api/financial-accounts/nonexistent-id/sync').set('Authorization', `Bearer ${tokenA}`);
    expect(resInvalid.status).toBe(404);

    const resConnOther = await request(app).get(`/api/financial-connections/${createRes.body.data.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(resConnOther.status).toBe(404);

    const resDelOther = await request(app).delete(`/api/financial-connections/${createRes.body.data.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(resDelOther.status).toBe(404);
  });
});
