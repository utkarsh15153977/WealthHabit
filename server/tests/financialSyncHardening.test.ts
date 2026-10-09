import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  FinancialConnectionProvider,
  FinancialConnectionStatus,
  Role,
  AccountStatus,
  TransactionSource,
} from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  financialConnectionRouter,
  financialAccountRouter,
} from '../src/routes/financialConnectionRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import { seedDefaultCategories } from '../src/services/defaultCategoryService.js';
import {
  clearFinancialDataProviderFactories,
  setFinancialDataProviderFactory,
} from '../src/providers/financialData/registry.js';
import { isSyncInProgress } from '../src/services/prismaFinancialSyncService.js';
import type {
  ExternalFinancialAccount,
  ExternalTransaction,
  FinancialDataProvider,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderTransactionQuery,
} from '../src/providers/financialData/types.js';

type FailureMode = 'connect' | 'accounts' | 'transactions';

class FailingProvider implements FinancialDataProvider {
  public readonly provider = FinancialConnectionProvider.MOCK;

  constructor(private readonly mode: FailureMode) {}

  public async connect(_input: ProviderConnectInput): Promise<ProviderConnectResult> {
    if (this.mode === 'connect') {
      throw new Error('provider exploded on connect');
    }
    return { externalConnectionRef: 'failing-connection-ref' };
  }

  public async getAccounts(_connectionId: string): Promise<ExternalFinancialAccount[]> {
    if (this.mode === 'accounts') {
      throw new Error('provider exploded on getAccounts');
    }
    return [];
  }

  public async getTransactions(
    _input: ProviderTransactionQuery
  ): Promise<ExternalTransaction[]> {
    if (this.mode === 'transactions') {
      throw new Error('provider exploded on getTransactions');
    }
    return [];
  }

  public async disconnect(_connectionId: string): Promise<void> {
    return;
  }
}

class GatedProvider implements FinancialDataProvider {
  public readonly provider = FinancialConnectionProvider.MOCK;

  private release!: () => void;
  private readonly gate: Promise<void> = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  public async connect(_input: ProviderConnectInput): Promise<ProviderConnectResult> {
    return { externalConnectionRef: 'gated-connection-ref' };
  }

  public async getAccounts(_connectionId: string): Promise<ExternalFinancialAccount[]> {
    return [];
  }

  public async getTransactions(
    _input: ProviderTransactionQuery
  ): Promise<ExternalTransaction[]> {
    await this.gate;
    return [];
  }

  public async disconnect(_connectionId: string): Promise<void> {
    return;
  }

  public unblock(): void {
    this.release();
  }
}

describe('Sync and import hardening', () => {
  let app: express.Express;
  let userA: { id: string; email: string; password: string; firstName: string; lastName: string };
  let userB: { id: string; email: string; password: string; firstName: string; lastName: string };
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    clearFinancialDataProviderFactories();
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
    app.use('/api/transactions', transactionRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    clearFinancialDataProviderFactories();
  });

  function createConnection(token: string) {
    return request(app)
      .post('/api/financial-connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'MOCK' });
  }

  function syncAccount(accountId: string, token: string) {
    return request(app)
      .post(`/api/financial-accounts/${accountId}/sync`)
      .set('Authorization', `Bearer ${token}`);
  }

  function getImported(token: string, query = '') {
    return request(app)
      .get(`/api/transactions/imported${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function importedCount(userId: string): Promise<number> {
    return testPrisma.transaction.count({
      where: { userId, source: TransactionSource.IMPORTED },
    });
  }

  async function firstImportedTransaction() {
    const row = await testPrisma.transaction.findFirst({
      where: { source: TransactionSource.IMPORTED, type: 'EXPENSE' },
      orderBy: { transactionDate: 'asc' },
    });
    if (!row) {
      throw new Error('expected an imported expense transaction');
    }
    return row;
  }

  describe('connection reactivation', () => {
    it('reactivates a disconnected connection and restores its accounts', async () => {
      const created = await createConnection(tokenA);
      const connectionId = created.body.data.id;
      await request(app)
        .delete(`/api/financial-connections/${connectionId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      const reactivated = await createConnection(tokenA);
      expect(reactivated.status).toBe(200);
      expect(reactivated.body.success).toBe(true);
      expect(reactivated.body.data.id).toBe(connectionId);
      expect(reactivated.body.data.status).toBe(FinancialConnectionStatus.ACTIVE);
      expect(reactivated.body.data.revokedAt).toBeNull();
      expect(reactivated.body.data.consentGivenAt).not.toBeNull();
      expect(reactivated.body.data.lastSyncError).toBeNull();
      expect(reactivated.body.data.accounts.length).toBe(3);
      expect(
        reactivated.body.data.accounts.every(
          (account: { isActive: boolean }) => account.isActive === true
        )
      ).toBe(true);

      const connection = await testPrisma.financialConnection.findUnique({
        where: { id: connectionId },
        include: { accounts: true },
      });
      expect(connection?.status).toBe(FinancialConnectionStatus.ACTIVE);
      expect(connection?.revokedAt).toBeNull();
      expect(connection?.accounts.length).toBe(3);

      const actions = (await testPrisma.auditLog.findMany({ where: { actorUserId: userA.id } })).map(
        (log) => log.action
      );
      expect(actions).toContain('FINANCIAL_CONNECTION_REACTIVATED');
    });

    it('does not re-import previously imported rows after reactivation', async () => {
      const created = await createConnection(tokenA);
      const firstAccountId = created.body.data.accounts[0].id;
      const firstSync = await syncAccount(firstAccountId, tokenA);
      expect(firstSync.body.data.transactionsImported).toBe(19);

      await request(app)
        .delete(`/api/financial-connections/${created.body.data.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(await importedCount(userA.id)).toBe(19);

      const reactivated = await createConnection(tokenA);
      expect(reactivated.status).toBe(200);
      const newAccountId = reactivated.body.data.accounts[0].id;

      const resync = await syncAccount(newAccountId, tokenA);
      expect(resync.status).toBe(200);
      expect(resync.body.data.transactionsFetched).toBe(19);
      expect(resync.body.data.transactionsImported).toBe(0);
      expect(resync.body.data.transactionsSkipped).toBe(19);
      expect(await importedCount(userA.id)).toBe(19);

      // Known limitation: rows orphaned by disconnect are not re-attached to
      // the recreated accounts (an unlinked-by-disconnect row and a row the
      // user deliberately unlinked are indistinguishable). They must never be
      // imported a second time.
      const unlinkedRows = await testPrisma.transaction.count({
        where: {
          userId: userA.id,
          source: TransactionSource.IMPORTED,
          financialAccountId: null,
        },
      });
      expect(unlinkedRows).toBe(19);
    });

    it('still rejects a duplicate connection while the connection is active', async () => {
      const created = await createConnection(tokenA);
      expect(created.status).toBe(201);

      const duplicate = await createConnection(tokenA);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('CONNECTION_ALREADY_EXISTS');

      await request(app)
        .delete(`/api/financial-connections/${created.body.data.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      const reactivated = await createConnection(tokenA);
      expect(reactivated.status).toBe(200);

      const duplicateAfterReactivate = await createConnection(tokenA);
      expect(duplicateAfterReactivate.status).toBe(409);
    });

    it('keeps reactivation scoped to the connection owner', async () => {
      const created = await createConnection(tokenA);
      await request(app)
        .delete(`/api/financial-connections/${created.body.data.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      const otherUserCreate = await createConnection(tokenB);
      expect(otherUserCreate.status).toBe(201);
      expect(otherUserCreate.body.data.id).not.toBe(created.body.data.id);

      const ownerConnection = await testPrisma.financialConnection.findUnique({
        where: { id: created.body.data.id },
      });
      expect(ownerConnection?.status).toBe(FinancialConnectionStatus.DISCONNECTED);
      expect(ownerConnection?.userId).toBe(userA.id);
    });
  });

  describe('provider failure handling', () => {
    it('leaves no orphan connection when account discovery fails', async () => {
      setFinancialDataProviderFactory(FinancialConnectionProvider.MOCK, () => {
        return new FailingProvider('accounts');
      });

      const res = await createConnection(tokenA);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('PROVIDER_ERROR');
      expect(res.body.error.message).not.toMatch(/provider exploded/i);

      const connections = await testPrisma.financialConnection.findMany({
        where: { userId: userA.id },
      });
      expect(connections.length).toBe(0);
    });

    it('returns PROVIDER_ERROR when reactivation fails and stays disconnected', async () => {
      const created = await createConnection(tokenA);
      await request(app)
        .delete(`/api/financial-connections/${created.body.data.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      setFinancialDataProviderFactory(FinancialConnectionProvider.MOCK, () => {
        return new FailingProvider('accounts');
      });

      const res = await createConnection(tokenA);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('PROVIDER_ERROR');
      expect(res.body.error.message).not.toMatch(/provider exploded/i);

      const connection = await testPrisma.financialConnection.findUnique({
        where: { id: created.body.data.id },
        include: { accounts: true },
      });
      expect(connection?.status).toBe(FinancialConnectionStatus.DISCONNECTED);
      expect(connection?.accounts.length).toBe(0);

      clearFinancialDataProviderFactories();
      const retry = await createConnection(tokenA);
      expect(retry.status).toBe(200);
      expect(retry.body.data.status).toBe(FinancialConnectionStatus.ACTIVE);
    });

    it('records a sanitized sync failure on account and connection', async () => {
      const created = await createConnection(tokenA);
      const connectionId = created.body.data.id;
      const accountId = created.body.data.accounts[0].id;

      setFinancialDataProviderFactory(FinancialConnectionProvider.MOCK, () => {
        return new FailingProvider('transactions');
      });

      const res = await syncAccount(accountId, tokenA);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('SYNC_FAILED');
      expect(res.body.error.message).not.toMatch(/provider exploded/i);

      const account = await testPrisma.financialAccount.findUnique({ where: { id: accountId } });
      expect(account?.lastSyncError).toBe('Sync failed');
      expect(account?.lastSyncedAt).toBeNull();

      const connection = await testPrisma.financialConnection.findUnique({
        where: { id: connectionId },
      });
      expect(connection?.lastSyncError).toBe('Sync failed');

      const failureLog = await testPrisma.auditLog.findFirst({
        where: { actorUserId: userA.id, action: 'FINANCIAL_SYNC_FAILED' },
      });
      expect(failureLog).not.toBeNull();

      const summary = await request(app)
        .get(`/api/financial-accounts/${accountId}/sync-summary`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(summary.status).toBe(200);
      expect(summary.body.data.lastSyncError).toBe('Sync failed');
      expect(summary.body.data.lastSync).toBeNull();
      expect(summary.body.data.lastSyncedAt).toBeNull();
    });

    it('clears the sync error and stores a summary after a successful sync', async () => {
      const created = await createConnection(tokenA);
      const accountId = created.body.data.accounts[0].id;

      setFinancialDataProviderFactory(FinancialConnectionProvider.MOCK, () => {
        return new FailingProvider('transactions');
      });
      await syncAccount(accountId, tokenA);
      clearFinancialDataProviderFactories();

      const sync = await syncAccount(accountId, tokenA);
      expect(sync.status).toBe(200);
      expect(sync.body.data.transactionsImported).toBe(19);

      const summary = await request(app)
        .get(`/api/financial-accounts/${accountId}/sync-summary`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(summary.status).toBe(200);
      expect(summary.body.data.accountId).toBe(accountId);
      expect(summary.body.data.accountName).toBe('HDFC Savings');
      expect(summary.body.data.status).toBe(FinancialConnectionStatus.ACTIVE);
      expect(summary.body.data.isActive).toBe(true);
      expect(summary.body.data.lastSyncError).toBeNull();
      expect(summary.body.data.lastSyncedAt).not.toBeNull();
      expect(summary.body.data.lastSync).toEqual({
        transactionsFetched: 19,
        transactionsImported: 19,
        transactionsSkipped: 0,
        syncedAt: expect.any(String),
      });
    });
  });

  describe('sync summary endpoint', () => {
    it('returns no summary before the first sync', async () => {
      const created = await createConnection(tokenA);
      const accountId = created.body.data.accounts[0].id;

      const res = await request(app)
        .get(`/api/financial-accounts/${accountId}/sync-summary`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.lastSyncedAt).toBeNull();
      expect(res.body.data.lastSyncError).toBeNull();
      expect(res.body.data.lastSync).toBeNull();
    });

    it('enforces ownership on the sync summary', async () => {
      const created = await createConnection(tokenA);
      const accountId = created.body.data.accounts[0].id;

      const foreign = await request(app)
        .get(`/api/financial-accounts/${accountId}/sync-summary`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(foreign.status).toBe(404);

      const missing = await request(app)
        .get('/api/financial-accounts/nonexistent-id/sync-summary')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(missing.status).toBe(404);

      const anonymous = await request(app).get(
        `/api/financial-accounts/${accountId}/sync-summary`
      );
      expect(anonymous.status).toBe(401);
    });
  });

  describe('imported transaction review', () => {
    let accountId: string;

    beforeEach(async () => {
      const created = await createConnection(tokenA);
      accountId = created.body.data.accounts[0].id;
      const sync = await syncAccount(accountId, tokenA);
      expect(sync.body.data.transactionsImported).toBe(19);
    });

    it('lists imported transactions with account and category context', async () => {
      const res = await getImported(tokenA);
      expect(res.status).toBe(200);
      expect(res.body.data.transactions.length).toBe(19);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 19,
        totalPages: 1,
      });

      for (const tx of res.body.data.transactions) {
        expect(tx.source).toBe(TransactionSource.IMPORTED);
        expect(tx.merchant).toBeTruthy();
        expect(tx.category).toBeTruthy();
        expect(tx.financialAccountId).toBeTruthy();
        expect(tx.financialAccount).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          currency: 'INR',
        });
        expect(tx.externalTransactionId).toBeTruthy();
        expect(tx.importedAt).toBeTruthy();
        expect(tx.amount).toBeGreaterThan(0);
      }

      const accounts = await testPrisma.financialAccount.findMany({
        where: { userId: userA.id },
        orderBy: { createdAt: 'asc' },
      });
      const byAccount = await getImported(tokenA, `?financialAccountId=${accounts[0].id}`);
      expect(byAccount.body.data.transactions.length).toBe(9);
      const secondAccount = await getImported(tokenA, `?financialAccountId=${accounts[1].id}`);
      expect(secondAccount.body.data.transactions.length).toBe(5);

      const expenses = await getImported(tokenA, '?type=EXPENSE');
      expect(expenses.status).toBe(200);
      expect(expenses.body.data.transactions.length).toBe(17);
      for (const tx of expenses.body.data.transactions) {
        expect(tx.type).toBe('EXPENSE');
      }

      const incomes = await getImported(tokenA, '?type=INCOME');
      expect(incomes.body.data.transactions.length).toBe(2);

      const ranged = await getImported(tokenA, '?dateFrom=2026-10-01&dateTo=2026-10-07');
      expect(ranged.body.data.pagination.total).toBe(12);
      for (const tx of ranged.body.data.transactions) {
        expect(new Date(tx.transactionDate).getTime()).toBeGreaterThanOrEqual(
          new Date('2026-10-01T00:00:00.000Z').getTime()
        );
        expect(new Date(tx.transactionDate).getTime()).toBeLessThanOrEqual(
          new Date('2026-10-07T00:00:00.000Z').getTime()
        );
      }

      const paged = await getImported(tokenA, '?page=2&limit=10');
      expect(paged.body.data.transactions.length).toBe(9);
      expect(paged.body.data.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 19,
        totalPages: 2,
      });
    });

    it('filters by category and hides other users and manual rows', async () => {
      const shopping = await testPrisma.category.findFirst({ where: { name: 'Shopping' } });
      expect(shopping).not.toBeNull();

      const filtered = await getImported(tokenA, `?categoryId=${shopping!.id}`);
      expect(filtered.status).toBe(200);
      expect(filtered.body.data.transactions.length).toBeGreaterThan(0);
      for (const tx of filtered.body.data.transactions) {
        expect(tx.category.id).toBe(shopping!.id);
      }

      const manual = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          categoryId: shopping!.id,
          type: 'EXPENSE',
          amount: '10.00',
          transactionDate: '2026-10-01',
          description: 'Manual row',
        });
      expect(manual.status).toBe(201);

      const afterManual = await getImported(tokenA);
      expect(afterManual.body.data.pagination.total).toBe(19);

      const foreign = await getImported(tokenB);
      expect(foreign.status).toBe(200);
      expect(foreign.body.data.transactions.length).toBe(0);

      const foreignFiltered = await getImported(tokenB, `?categoryId=${shopping!.id}`);
      expect(foreignFiltered.body.data.transactions.length).toBe(0);
    });

    it('recategorizes an imported transaction', async () => {
      const imported = await firstImportedTransaction();
      const shopping = await testPrisma.category.findFirst({ where: { name: 'Shopping' } });
      const salary = await testPrisma.category.findFirst({ where: { name: 'Salary' } });

      const res = await request(app)
        .patch(`/api/transactions/${imported.id}/category`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: shopping!.id });
      expect(res.status).toBe(200);
      expect(res.body.data.transaction.category.id).toBe(shopping!.id);
      expect(res.body.data.transaction.source).toBe(TransactionSource.IMPORTED);
      expect(res.body.data.transaction.financialAccountId).toBe(imported.financialAccountId);
      expect(res.body.data.transaction.externalTransactionId).toBe(
        imported.externalTransactionId
      );
      expect(res.body.data.transaction.importedAt).not.toBeNull();

      const audit = await testPrisma.auditLog.findFirst({
        where: { actorUserId: userA.id, action: 'IMPORTED_TRANSACTION_RECATEGORIZED' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.entityId).toBe(imported.id);

      const mismatch = await request(app)
        .patch(`/api/transactions/${imported.id}/category`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: salary!.id });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.error.code).toBe('VALIDATION_ERROR');

      const unknown = await request(app)
        .patch(`/api/transactions/${imported.id}/category`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: 'no-such-category' });
      expect(unknown.status).toBe(404);

      const foreignCategory = await testPrisma.category.create({
        data: {
          userId: userB.id,
          name: 'Foreign Category',
          type: 'EXPENSE',
        },
      });
      const foreign = await request(app)
        .patch(`/api/transactions/${imported.id}/category`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: foreignCategory.id });
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe('CATEGORY_NOT_FOUND');

      const foreignTransaction = await request(app)
        .patch(`/api/transactions/${imported.id}/category`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ categoryId: shopping!.id });
      expect(foreignTransaction.status).toBe(404);

      // Deduplication safety (Step 8): a recategorized row is still the same
      // provider transaction and must never be imported a second time.
      const resync = await syncAccount(accountId, tokenA);
      expect(resync.status).toBe(200);
      expect(resync.body.data.transactionsImported).toBe(0);
      expect(await importedCount(userA.id)).toBe(19);
    });

    it('rejects review actions on manual transactions', async () => {
      const shopping = await testPrisma.category.findFirst({ where: { name: 'Shopping' } });
      const manual = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          categoryId: shopping!.id,
          type: 'EXPENSE',
          amount: '25.00',
          transactionDate: '2026-10-02',
        });
      const manualId = manual.body.data.transaction.id;

      const recategorize = await request(app)
        .patch(`/api/transactions/${manualId}/category`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: shopping!.id });
      expect(recategorize.status).toBe(400);
      expect(recategorize.body.error.code).toBe('TRANSACTION_NOT_IMPORTED');

      const unlink = await request(app)
        .post(`/api/transactions/${manualId}/unlink`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(unlink.status).toBe(400);
      expect(unlink.body.error.code).toBe('TRANSACTION_NOT_IMPORTED');

      const convert = await request(app)
        .post(`/api/transactions/${manualId}/convert-to-manual`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(convert.status).toBe(400);
      expect(convert.body.error.code).toBe('TRANSACTION_NOT_IMPORTED');
    });

    it('unlinks an imported transaction without re-importing it on the next sync', async () => {
      const imported = await firstImportedTransaction();

      const unlink = await request(app)
        .post(`/api/transactions/${imported.id}/unlink`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(unlink.status).toBe(200);
      expect(unlink.body.data.transaction.financialAccountId).toBeNull();
      expect(unlink.body.data.transaction.source).toBe(TransactionSource.IMPORTED);
      expect(unlink.body.data.transaction.externalTransactionId).toBe(
        imported.externalTransactionId
      );

      const repeat = await request(app)
        .post(`/api/transactions/${imported.id}/unlink`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(repeat.status).toBe(200);
      expect(repeat.body.data.transaction.financialAccountId).toBeNull();

      const audit = await testPrisma.auditLog.findFirst({
        where: { actorUserId: userA.id, action: 'IMPORTED_TRANSACTION_UNLINKED' },
      });
      expect(audit).not.toBeNull();

      const foreign = await request(app)
        .post(`/api/transactions/${imported.id}/unlink`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(foreign.status).toBe(404);

      // The row leaves no account but stays in the normal transaction history.
      const history = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(history.status).toBe(200);
      const historyIds = history.body.data.transactions.map(
        (tx: { id: string }) => tx.id
      );
      expect(historyIds).toContain(imported.id);

      const resync = await syncAccount(accountId, tokenA);
      expect(resync.status).toBe(200);
      expect(resync.body.data.transactionsFetched).toBe(19);
      expect(resync.body.data.transactionsImported).toBe(0);
      expect(resync.body.data.transactionsSkipped).toBe(19);
      expect(await importedCount(userA.id)).toBe(19);
    });

    it('converts an imported transaction into an editable manual one', async () => {
      const imported = await firstImportedTransaction();

      const foreign = await request(app)
        .post(`/api/transactions/${imported.id}/convert-to-manual`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(foreign.status).toBe(404);

      const convert = await request(app)
        .post(`/api/transactions/${imported.id}/convert-to-manual`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(convert.status).toBe(200);
      expect(convert.body.data.transaction.source).toBe(TransactionSource.MANUAL);
      // Only the source changes: the account link and provenance stay intact
      // unless the user explicitly unlinks the row.
      expect(convert.body.data.transaction.financialAccountId).toBe(imported.financialAccountId);
      expect(convert.body.data.transaction.importedAt).toBeTruthy();
      expect(convert.body.data.transaction.merchant).toBe(imported.merchant);
      expect(convert.body.data.transaction.paymentChannel).toBe(imported.paymentChannel);
      expect(convert.body.data.transaction.category.id).toBe(imported.categoryId);
      expect(convert.body.data.transaction.amount).toBe(Number(imported.amount));
      expect(convert.body.data.transaction.externalTransactionId).toBe(
        imported.externalTransactionId
      );

      const audit = await testPrisma.auditLog.findFirst({
        where: { actorUserId: userA.id, action: 'IMPORTED_TRANSACTION_CONVERTED_TO_MANUAL' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({
        transactionId: imported.id,
        previousSource: TransactionSource.IMPORTED,
        newSource: TransactionSource.MANUAL,
      });

      const repeat = await request(app)
        .post(`/api/transactions/${imported.id}/convert-to-manual`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(repeat.status).toBe(400);
      expect(repeat.body.error.code).toBe('TRANSACTION_NOT_IMPORTED');

      const edited = await request(app)
        .patch(`/api/transactions/${imported.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ notes: 'Converted by the user' });
      expect(edited.status).toBe(200);
      expect(edited.body.data.transaction.notes).toBe('Converted by the user');

      const afterConvert = await getImported(tokenA);
      expect(afterConvert.body.data.pagination.total).toBe(18);

      const resync = await syncAccount(accountId, tokenA);
      expect(resync.status).toBe(200);
      expect(resync.body.data.transactionsFetched).toBe(19);
      expect(resync.body.data.transactionsImported).toBe(0);
      expect(await importedCount(userA.id)).toBe(18);
    });
  });

  describe('sync concurrency and ownership', () => {
    it('answers 404 to a foreign user and 409 to the owner while a sync is in flight', async () => {
      const created = await createConnection(tokenA);
      expect(created.status).toBe(201);
      const accountId = created.body.data.accounts[0].id;

      const gated = new GatedProvider();
      setFinancialDataProviderFactory(FinancialConnectionProvider.MOCK, () => gated);

      const inflight = syncAccount(accountId, tokenA);
      // Supertest only starts the request once it is then-ed. Capturing the
      // outcome also lets the assertion below distinguish "the lock was never
      // taken" from "the sync already finished".
      let settledStatus: number | undefined;
      let settledBody: unknown;
      void inflight.then((res) => {
        settledStatus = res.status;
        settledBody = res.body;
      });

      const deadline = Date.now() + 5000;
      while (!isSyncInProgress(accountId) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect({
        locked: isSyncInProgress(accountId),
        settledStatus,
        settledBody,
      }).toEqual({ locked: true, settledStatus: undefined, settledBody: undefined });

      try {
        // Ownership is resolved before the lock is consulted, so another user
        // learns nothing about this account's existence or activity: the
        // answer is 404 even while the owner's sync holds the lock.
        const foreign = await syncAccount(accountId, tokenB);
        expect(foreign.status).toBe(404);
        expect(foreign.body.error.code).toBe('FINANCIAL_ACCOUNT_NOT_FOUND');
        // ...and the foreign attempt must not squat on the victim's lock slot.
        expect(isSyncInProgress(accountId)).toBe(true);

        // The owner gets the truthful answer instead.
        const owner = await syncAccount(accountId, tokenA);
        expect(owner.status).toBe(409);
        expect(owner.body.error.code).toBe('SYNC_ALREADY_IN_PROGRESS');
      } finally {
        gated.unblock();
      }

      const finished = await inflight;
      expect(finished.status).toBe(200);
      expect(isSyncInProgress(accountId)).toBe(false);
    });
  });
});
