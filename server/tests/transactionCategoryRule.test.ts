import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import {
  Role,
  AccountStatus,
  CategoryType,
  TransactionSource,
  TransactionType,
} from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import transactionCategoryRuleRoutes from '../src/routes/transactionCategoryRuleRoutes.js';

describe('Transaction category rules API', () => {
  let app: express.Express;
  let userA: { id: string; email: string; password: string; firstName: string; lastName: string };
  let userB: { id: string; email: string; password: string; firstName: string; lastName: string };
  let tokenA: string;
  let tokenB: string;
  let foodA: string;
  let shoppingA: string;
  let salaryA: string;
  let freelanceA: string;
  let otherExpenseA: string;
  let otherIncomeA: string;
  let privateCatB: string;

  beforeEach(async () => {
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

    const [food, shopping, salary, freelance, otherExpense, otherIncome, privateCat, entertainment] =
      await Promise.all([
        testPrisma.category.create({
          data: { userId: createdA.id, name: 'Food', type: CategoryType.EXPENSE },
        }),
        testPrisma.category.create({
          data: { userId: createdA.id, name: 'Shopping', type: CategoryType.EXPENSE },
        }),
        testPrisma.category.create({
          data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME },
        }),
        testPrisma.category.create({
          data: { userId: createdA.id, name: 'Freelance', type: CategoryType.INCOME },
        }),
        testPrisma.category.create({
          data: { userId: createdA.id, name: 'Other Expense', type: CategoryType.EXPENSE },
        }),
        testPrisma.category.create({
          data: { userId: createdA.id, name: 'Other Income', type: CategoryType.INCOME },
        }),
        testPrisma.category.create({
          data: { userId: createdB.id, name: 'B Private', type: CategoryType.EXPENSE },
        }),
        testPrisma.category.create({
          data: { userId: createdA.id, name: 'Entertainment', type: CategoryType.EXPENSE },
        }),
      ]);

    foodA = food.id;
    shoppingA = shopping.id;
    salaryA = salary.id;
    freelanceA = freelance.id;
    otherExpenseA = otherExpense.id;
    otherIncomeA = otherIncome.id;
    privateCatB = privateCat.id;
    void entertainment;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use('/api/transaction-category-rules', transactionCategoryRuleRoutes);
    app.use(errorHandler);
  });

  function asUser(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createRule(token: string, body: Record<string, unknown>) {
    return request(app)
      .post('/api/transaction-category-rules')
      .set(asUser(token))
      .send(body);
  }

  async function createImportedTransaction(
    userId: string,
    categoryId: string,
    overrides: Record<string, unknown> = {}
  ) {
    return testPrisma.transaction.create({
      data: {
        userId,
        categoryId,
        type: TransactionType.EXPENSE,
        amount: 100,
        transactionDate: new Date('2026-10-01T00:00:00.000Z'),
        source: TransactionSource.IMPORTED,
        merchant: 'Swiggy',
        description: 'UPI payment - Swiggy',
        ...overrides,
      },
    });
  }

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/transaction-category-rules');
    expect(res.status).toBe(401);
  });

  it('creates a rule with the merchant normalized to its stable key', async () => {
    const res = await createRule(tokenA, {
      merchant: 'SWIGGY*ORDER123',
      categoryId: foodA,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rule.merchant).toBe('swiggy');
    expect(res.body.data.rule.categoryId).toBe(foodA);
    expect(res.body.data.rule.priority).toBe(0);
    expect(res.body.data.rule.isActive).toBe(true);
    expect(res.body.data.rule.category.name).toBe('Food');

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'TRANSACTION_CATEGORY_RULE_CREATED' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(userA.id);
    expect(audit?.entityType).toBe('transaction_category_rule');
  });

  it('rejects a duplicate merchant rule regardless of raw spelling', async () => {
    const first = await createRule(tokenA, { merchant: 'Swiggy', categoryId: foodA });
    expect(first.status).toBe(201);

    const duplicate = await createRule(tokenA, {
      merchant: 'SWIGGY ORDER 9911',
      categoryId: shoppingA,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CATEGORY_RULE_ALREADY_EXISTS');

    const count = await testPrisma.transactionCategoryRule.count({
      where: { userId: userA.id },
    });
    expect(count).toBe(1);
  });

  it('lists only the authenticated user rules', async () => {
    await createRule(tokenA, { merchant: 'Swiggy', categoryId: foodA });
    await createRule(tokenA, { merchant: 'Amazon', categoryId: shoppingA });

    const resA = await request(app).get('/api/transaction-category-rules').set(asUser(tokenA));
    expect(resA.status).toBe(200);
    expect(resA.body.data.rules).toHaveLength(2);
    expect(
      resA.body.data.rules
        .map((rule: { merchant: string }) => rule.merchant)
        .sort()
    ).toEqual(['amazon', 'swiggy']);

    const resB = await request(app).get('/api/transaction-category-rules').set(asUser(tokenB));
    expect(resB.status).toBe(200);
    expect(resB.body.data.rules).toHaveLength(0);
  });

  it('rejects creation against a foreign category', async () => {
    const res = await createRule(tokenA, { merchant: 'Zomato', categoryId: privateCatB });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects merchants without merchantable text', async () => {
    const res = await createRule(tokenA, { merchant: '***', categoryId: foodA });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body.merchant']).toBeDefined();
  });

  it('rejects unknown fields on create', async () => {
    const res = await createRule(tokenA, {
      merchant: 'Swiggy',
      categoryId: foodA,
      userId: userB.id,
    });
    expect(res.status).toBe(400);
  });

  it('updates rule category, merchant and flags', async () => {
    const created = await createRule(tokenA, { merchant: 'Swiggy', categoryId: foodA });
    const ruleId = created.body.data.rule.id;

    const categoryUpdate = await request(app)
      .patch(`/api/transaction-category-rules/${ruleId}`)
      .set(asUser(tokenA))
      .send({ categoryId: shoppingA, priority: 5, isActive: false });
    expect(categoryUpdate.status).toBe(200);
    expect(categoryUpdate.body.data.rule.categoryId).toBe(shoppingA);
    expect(categoryUpdate.body.data.rule.priority).toBe(5);
    expect(categoryUpdate.body.data.rule.isActive).toBe(false);

    const merchantUpdate = await request(app)
      .patch(`/api/transaction-category-rules/${ruleId}`)
      .set(asUser(tokenA))
      .send({ merchant: 'Amazon Order #55' });
    expect(merchantUpdate.status).toBe(200);
    expect(merchantUpdate.body.data.rule.merchant).toBe('amazon');

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'TRANSACTION_CATEGORY_RULE_UPDATED' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects renaming onto another rule merchant and updating foreign rules', async () => {
    const first = await createRule(tokenA, { merchant: 'Swiggy', categoryId: foodA });
    await createRule(tokenA, { merchant: 'Amazon', categoryId: shoppingA });

    const conflict = await request(app)
      .patch(`/api/transaction-category-rules/${first.body.data.rule.id}`)
      .set(asUser(tokenA))
      .send({ merchant: 'AMAZON' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('CATEGORY_RULE_ALREADY_EXISTS');

    const foreign = await request(app)
      .patch(`/api/transaction-category-rules/${first.body.data.rule.id}`)
      .set(asUser(tokenB))
      .send({ categoryId: privateCatB });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('CATEGORY_RULE_NOT_FOUND');
  });

  it('rejects empty and malformed rule updates', async () => {
    const created = await createRule(tokenA, { merchant: 'Swiggy', categoryId: foodA });
    const ruleId = created.body.data.rule.id;

    const empty = await request(app)
      .patch(`/api/transaction-category-rules/${ruleId}`)
      .set(asUser(tokenA))
      .send({});
    expect(empty.status).toBe(400);

    const unknownId = await request(app)
      .patch('/api/transaction-category-rules/does-not-exist')
      .set(asUser(tokenA))
      .send({ isActive: false });
    expect(unknownId.status).toBe(404);
    expect(unknownId.body.error.code).toBe('CATEGORY_RULE_NOT_FOUND');
  });

  it('deletes a rule and reports missing rules as 404 afterwards', async () => {
    const created = await createRule(tokenA, { merchant: 'Swiggy', categoryId: foodA });
    const ruleId = created.body.data.rule.id;

    const deleted = await request(app)
      .delete(`/api/transaction-category-rules/${ruleId}`)
      .set(asUser(tokenA));
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ ruleId, deleted: true });

    const again = await request(app)
      .delete(`/api/transaction-category-rules/${ruleId}`)
      .set(asUser(tokenA));
    expect(again.status).toBe(404);

    const foreign = await createRule(tokenB, { merchant: 'Swiggy', categoryId: privateCatB });
    const foreignDelete = await request(app)
      .delete(`/api/transaction-category-rules/${foreign.body.data.rule.id}`)
      .set(asUser(tokenA));
    expect(foreignDelete.status).toBe(404);

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'TRANSACTION_CATEGORY_RULE_DELETED' },
    });
    expect(audit).not.toBeNull();
  });

  it('previews built-in categorization with reason and confidence without mutating', async () => {
    const before = {
      transactions: await testPrisma.transaction.count(),
      rules: await testPrisma.transactionCategoryRule.count(),
      audits: await testPrisma.auditLog.count(),
    };

    const res = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'EXPENSE', merchant: 'SWIGGY*ORDER777' });

    expect(res.status).toBe(200);
    expect(res.body.data.category.id).toBe(foodA);
    expect(res.body.data.reason).toBe('MERCHANT_RULE');
    expect(res.body.data.matchedRule).toBe('swiggy');
    expect(res.body.data.confidence).toBe(0.95);

    expect(await testPrisma.transaction.count()).toBe(before.transactions);
    expect(await testPrisma.transactionCategoryRule.count()).toBe(before.rules);
    expect(await testPrisma.auditLog.count()).toBe(before.audits);
  });

  it('previews a user learned rule above the built-in rules', async () => {
    await createRule(tokenA, { merchant: 'Amazon', categoryId: shoppingA });

    const res = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'EXPENSE', merchant: 'Amazon' });

    expect(res.status).toBe(200);
    expect(res.body.data.category.id).toBe(shoppingA);
    expect(res.body.data.reason).toBe('USER_RULE');
    expect(res.body.data.matchedRule).toBe('amazon');
    expect(res.body.data.confidence).toBe(0.98);

    const otherUser = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenB))
      .send({ type: 'EXPENSE', merchant: 'Amazon' });
    expect(otherUser.status).toBe(404);
    expect(otherUser.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('skips user rules whose category type does not match at application time', async () => {
    await createRule(tokenA, { merchant: 'Netflix', categoryId: salaryA });

    const res = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'EXPENSE', merchant: 'Netflix' });

    expect(res.status).toBe(200);
    expect(res.body.data.category.name).toBe('Entertainment');
    expect(res.body.data.reason).toBe('MERCHANT_RULE');
    expect(res.body.data.matchedRule).toBe('netflix');
  });

  it('previews the type default when nothing matches', async () => {
    const res = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'EXPENSE', paymentChannel: 'GOOGLEPAY' });

    expect(res.status).toBe(200);
    expect(res.body.data.category.id).toBe(otherExpenseA);
    expect(res.body.data.reason).toBe('DEFAULT_CATEGORY');
    expect(res.body.data.matchedRule).toBeNull();
    expect(res.body.data.confidence).toBe(0.5);
  });

  it('previews an income default for income transactions', async () => {
    const res = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'INCOME', merchant: 'Uber' });

    expect(res.status).toBe(200);
    expect(res.body.data.category.id).toBe(otherIncomeA);
    expect(res.body.data.reason).toBe('DEFAULT_CATEGORY');
  });

  it('rejects invalid preview payloads', async () => {
    const missingType = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ merchant: 'Swiggy' });
    expect(missingType.status).toBe(400);

    const unknownField = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'EXPENSE', merchant: 'Swiggy', categoryId: foodA });
    expect(unknownField.status).toBe(400);

    const unauthenticated = await request(app)
      .post('/api/transactions/categorization-preview')
      .send({ type: 'EXPENSE', merchant: 'Swiggy' });
    expect(unauthenticated.status).toBe(401);
  });

  it('remembers the merchant mapping on recategorization when asked', async () => {
    const tx = await createImportedTransaction(userA.id, foodA, {
      merchant: 'SWIGGY*ORDER777',
    });

    const res = await request(app)
      .patch(`/api/transactions/${tx.id}/category`)
      .set(asUser(tokenA))
      .send({ categoryId: shoppingA, rememberForMerchant: true });
    expect(res.status).toBe(200);

    const rule = await testPrisma.transactionCategoryRule.findFirst({
      where: { userId: userA.id, normalizedMerchant: 'swiggy' },
    });
    expect(rule).not.toBeNull();
    expect(rule?.categoryId).toBe(shoppingA);

    const preview = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'EXPENSE', merchant: 'Swiggy Bazaar' });
    expect(preview.body.data.category.id).toBe(shoppingA);
    expect(preview.body.data.reason).toBe('USER_RULE');

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'IMPORTED_TRANSACTION_RECATEGORIZED' },
    });
    expect(audit?.metadata).toMatchObject({
      normalizedMerchant: 'swiggy',
      ruleId: rule?.id,
    });
  });

  it('creates no rule when rememberForMerchant is false', async () => {
    const tx = await createImportedTransaction(userA.id, foodA, {
      merchant: 'SWIGGY*ORDER777',
    });

    const res = await request(app)
      .patch(`/api/transactions/${tx.id}/category`)
      .set(asUser(tokenA))
      .send({ categoryId: shoppingA, rememberForMerchant: false });
    expect(res.status).toBe(200);

    const row = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(row?.categoryId).toBe(shoppingA);

    const ruleCount = await testPrisma.transactionCategoryRule.count({
      where: { userId: userA.id },
    });
    expect(ruleCount).toBe(0);
  });

  it('rejects remembering a transaction without a merchant before mutating anything', async () => {
    const tx = await createImportedTransaction(userA.id, foodA, { merchant: null });

    const res = await request(app)
      .patch(`/api/transactions/${tx.id}/category`)
      .set(asUser(tokenA))
      .send({ categoryId: shoppingA, rememberForMerchant: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body.rememberForMerchant']).toBeDefined();

    const unchanged = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(unchanged?.categoryId).toBe(foodA);
    const ruleCount = await testPrisma.transactionCategoryRule.count({
      where: { userId: userA.id },
    });
    expect(ruleCount).toBe(0);
  });

  it('recategorizes a list of imported transactions atomically', async () => {
    const t1 = await createImportedTransaction(userA.id, foodA, { merchant: 'Swiggy' });
    const t2 = await createImportedTransaction(userA.id, foodA, { merchant: 'Amazon' });

    const res = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({ transactionIds: [t1.id, t2.id], categoryId: shoppingA });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ transactionCount: 2, categoryId: shoppingA });

    const rows = await testPrisma.transaction.findMany({
      where: { id: { in: [t1.id, t2.id] } },
    });
    for (const row of rows) {
      expect(row.categoryId).toBe(shoppingA);
    }

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'TRANSACTION_BULK_RECATEGORIZED' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.metadata).toMatchObject({ transactionCount: 2, categoryId: shoppingA });
  });

  it('bulk-recategorizes a single imported transaction without rules by default', async () => {
    const tx = await createImportedTransaction(userA.id, foodA, { merchant: 'Swiggy' });

    const res = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({ transactionIds: [tx.id], categoryId: shoppingA });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ transactionCount: 1, categoryId: shoppingA });

    const row = await testPrisma.transaction.findUnique({ where: { id: tx.id } });
    expect(row?.categoryId).toBe(shoppingA);

    const ruleCount = await testPrisma.transactionCategoryRule.count({
      where: { userId: userA.id },
    });
    expect(ruleCount).toBe(0);
  });

  it('never touches any row when one id in the batch is foreign', async () => {
    const t1 = await createImportedTransaction(userA.id, foodA, { merchant: 'Swiggy' });
    const foreign = await createImportedTransaction(userB.id, privateCatB);

    const res = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({ transactionIds: [t1.id, foreign.id], categoryId: shoppingA });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');

    const unchanged = await testPrisma.transaction.findUnique({ where: { id: t1.id } });
    expect(unchanged?.categoryId).toBe(foodA);
  });

  it('rejects non-imported, mismatched-type and malformed batches without changes', async () => {
    const imported = await createImportedTransaction(userA.id, foodA);
    const manual = await createImportedTransaction(userA.id, foodA, {
      source: TransactionSource.MANUAL,
    });
    const income = await createImportedTransaction(userA.id, otherExpenseA, {
      type: TransactionType.INCOME,
      categoryId: salaryA,
    });

    const notImported = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({ transactionIds: [imported.id, manual.id], categoryId: shoppingA });
    expect(notImported.status).toBe(400);
    expect(notImported.body.error.code).toBe('TRANSACTION_NOT_IMPORTED');

    const typeMismatch = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({ transactionIds: [income.id], categoryId: shoppingA });
    expect(typeMismatch.status).toBe(400);
    expect(typeMismatch.body.errors['body.categoryId']).toBeDefined();

    const duplicates = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({ transactionIds: [imported.id, imported.id], categoryId: shoppingA });
    expect(duplicates.status).toBe(400);

    const tooMany = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({
        transactionIds: Array.from({ length: 101 }, (_, index) => `tx-${index}`),
        categoryId: shoppingA,
      });
    expect(tooMany.status).toBe(400);

    const unchanged = await testPrisma.transaction.findUnique({
      where: { id: imported.id },
    });
    expect(unchanged?.categoryId).toBe(foodA);
  });

  it('remembers merchant mappings for the distinct merchants of a batch', async () => {
    const t1 = await createImportedTransaction(userA.id, foodA, { merchant: 'Swiggy' });
    const t2 = await createImportedTransaction(userA.id, foodA, { merchant: 'Swiggy Order 991' });
    const t3 = await createImportedTransaction(userA.id, foodA, { merchant: 'Amazon' });

    const res = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({
        transactionIds: [t1.id, t2.id, t3.id],
        categoryId: shoppingA,
        rememberForMerchant: true,
      });

    expect(res.status).toBe(200);

    const rules = await testPrisma.transactionCategoryRule.findMany({
      where: { userId: userA.id },
      orderBy: { normalizedMerchant: 'asc' },
    });
    expect(rules.map((rule) => rule.normalizedMerchant)).toEqual(['amazon', 'swiggy']);
    for (const rule of rules) {
      expect(rule.categoryId).toBe(shoppingA);
    }
  });

  it('rejects an empty batch and unauthenticated bulk requests', async () => {
    const empty = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .set(asUser(tokenA))
      .send({ transactionIds: [], categoryId: shoppingA });
    expect(empty.status).toBe(400);

    const unauthenticated = await request(app)
      .post('/api/transactions/bulk-recategorize')
      .send({ transactionIds: ['tx-1'], categoryId: shoppingA });
    expect(unauthenticated.status).toBe(401);
  });

  it('keeps freelance available for income rules created through the API', async () => {
    const res = await createRule(tokenA, { merchant: 'Upwork', categoryId: freelanceA });
    expect(res.status).toBe(201);

    const preview = await request(app)
      .post('/api/transactions/categorization-preview')
      .set(asUser(tokenA))
      .send({ type: 'INCOME', merchant: 'Upwork' });
    expect(preview.status).toBe(200);
    expect(preview.body.data.category.id).toBe(freelanceA);
    expect(preview.body.data.reason).toBe('USER_RULE');
  });
});
