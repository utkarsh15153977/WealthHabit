import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, CategoryType } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';

describe('Categories API', () => {
  let app: express.Express;
  let userA: { id: string; email: string; password: string; firstName: string; lastName: string };
  let userB: { id: string; email: string; password: string; firstName: string; lastName: string };
  let tokenA: string;
  let tokenB: string;

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

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use(errorHandler);
  });

  async function createCategory(token: string, body: Record<string, unknown>) {
    return request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('rejects unauthenticated list', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
  });

  it('lists only system + own categories', async () => {
    await testPrisma.category.create({
      data: { userId: null, name: 'System Food', type: CategoryType.EXPENSE, isDefault: true },
    });
    await createCategory(tokenA, { name: 'My Custom', type: 'EXPENSE' });
    await createCategory(tokenB, { name: 'Other Private', type: 'EXPENSE' });

    const res = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const names = res.body.data.categories.map((c: { name: string }) => c.name);
    expect(names).toContain('System Food');
    expect(names).toContain('My Custom');
    expect(names).not.toContain('Other Private');
  });

  it('filters by type', async () => {
    await createCategory(tokenA, { name: 'Salary Cat', type: 'INCOME' });
    await createCategory(tokenA, { name: 'Grocery Cat', type: 'EXPENSE' });

    const res = await request(app)
      .get('/api/categories?type=INCOME')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.categories).toHaveLength(1);
    expect(res.body.data.categories[0].name).toBe('Salary Cat');
    expect(res.body.data.categories[0].type).toBe('INCOME');
  });

  it('creates a valid custom category', async () => {
    const res = await createCategory(tokenA, {
      name: 'Freelance',
      type: 'INCOME',
      icon: 'briefcase',
      color: '#10b981',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.category.name).toBe('Freelance');
    expect(res.body.data.category.type).toBe('INCOME');
    expect(res.body.data.category.isDefault).toBe(false);
    expect(res.body.data.category.userId).toBeUndefined();
  });

  it('rejects validation failure (missing name)', async () => {
    const res = await createCategory(tokenA, { type: 'EXPENSE' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown fields (userId)', async () => {
    const res = await createCategory(tokenA, {
      name: 'Hacked',
      type: 'EXPENSE',
      userId: userB.id,
      isDefault: true,
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate category name for same user', async () => {
    await createCategory(tokenA, { name: 'Duplicate', type: 'EXPENSE' });
    const res = await createCategory(tokenA, { name: 'Duplicate', type: 'INCOME' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATEGORY_ALREADY_EXISTS');
  });

  it('allows same name for different users', async () => {
    const a = await createCategory(tokenA, { name: 'Shared Name', type: 'EXPENSE' });
    const b = await createCategory(tokenB, { name: 'Shared Name', type: 'EXPENSE' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('updates own category', async () => {
    const created = await createCategory(tokenA, { name: 'Old Name', type: 'EXPENSE' });
    const id = created.body.data.category.id;

    const res = await request(app)
      .patch(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.category.name).toBe('New Name');
  });

  it('cannot modify another user category', async () => {
    const created = await createCategory(tokenA, { name: 'Private A', type: 'EXPENSE' });
    const id = created.body.data.category.id;

    const res = await request(app)
      .patch(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Stolen' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('cannot modify system category', async () => {
    const system = await testPrisma.category.create({
      data: { userId: null, name: 'System Cat', type: CategoryType.EXPENSE, isDefault: true },
    });

    const res = await request(app)
      .patch(`/api/categories/${system.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot delete another user category', async () => {
    const created = await createCategory(tokenA, { name: 'Delete A', type: 'EXPENSE' });
    const id = created.body.data.category.id;

    const res = await request(app)
      .delete(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('cannot delete system category', async () => {
    const system = await testPrisma.category.create({
      data: { userId: null, name: 'System Del', type: CategoryType.EXPENSE, isDefault: true },
    });

    const res = await request(app)
      .delete(`/api/categories/${system.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot delete category with transactions', async () => {
    const created = await createCategory(tokenA, { name: 'Used Cat', type: 'EXPENSE' });
    const id = created.body.data.category.id;

    await testPrisma.transaction.create({
      data: {
        userId: userA.id,
        categoryId: id,
        type: 'EXPENSE',
        amount: '10.00',
        transactionDate: new Date(),
      },
    });

    const res = await request(app)
      .delete(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATEGORY_IN_USE');
  });

  it('deletes own unused category', async () => {
    const created = await createCategory(tokenA, { name: 'Temp Cat', type: 'EXPENSE' });
    const id = created.body.data.category.id;

    const res = await request(app)
      .delete(`/api/categories/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const found = await testPrisma.category.findUnique({ where: { id } });
    expect(found).toBeNull();
  });
});
