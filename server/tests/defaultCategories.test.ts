import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { DEFAULT_CATEGORIES, seedDefaultCategories } from '../src/services/defaultCategoryService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRoutes from '../src/routes/authRoutes.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';

describe('Default categories', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use(errorHandler);
  });

  async function registerUser() {
    const user = createTestUser();
    const res = await request(app).post('/api/auth/register').send(user);
    expect(res.status).toBe(201);
    return {
      token: res.body.data.accessToken as string,
      userId: res.body.data.user.id as string,
    };
  }

  async function getDefaultCategory(name: string) {
    return testPrisma.category.findFirst({
      where: { userId: null, name },
    });
  }

  it('seeds the complete default category catalog', async () => {
    const result = await seedDefaultCategories(testPrisma);

    expect(result.created).toBe(DEFAULT_CATEGORIES.length);
    expect(result.existing).toBe(0);

    const defaults = await testPrisma.category.findMany({ where: { userId: null } });
    expect(defaults).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(defaults.every((category) => category.userId === null)).toBe(true);
    expect(defaults.every((category) => category.isDefault === true)).toBe(true);
    expect(defaults.filter((category) => category.type === 'INCOME')).toHaveLength(5);
    expect(defaults.filter((category) => category.type === 'EXPENSE')).toHaveLength(10);

    const names = defaults.map((category) => category.name).sort();
    const expected = DEFAULT_CATEGORIES.map((definition) => definition.name).sort();
    expect(names).toEqual(expected);
  });

  it('is idempotent across repeated runs', async () => {
    const first = await seedDefaultCategories(testPrisma);
    const second = await seedDefaultCategories(testPrisma);

    expect(first.created).toBe(DEFAULT_CATEGORIES.length);
    expect(second.created).toBe(0);
    expect(second.existing).toBe(DEFAULT_CATEGORIES.length);

    const count = await testPrisma.category.count({ where: { userId: null } });
    expect(count).toBe(DEFAULT_CATEGORIES.length);
  });

  it('returns default categories to a newly registered user', async () => {
    await seedDefaultCategories(testPrisma);
    const { token } = await registerUser();

    const res = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const categories = res.body.data.categories as {
      name: string;
      type: string;
      isDefault: boolean;
    }[];
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(categories.every((category) => category.isDefault === true)).toBe(true);
    expect(categories.map((category) => category.name).sort()).toEqual(
      DEFAULT_CATEGORIES.map((definition) => definition.name).sort()
    );

    const filtered = await request(app)
      .get('/api/categories?type=INCOME')
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.categories).toHaveLength(5);
  });

  it('does not expose default categories to unauthenticated callers', async () => {
    await seedDefaultCategories(testPrisma);

    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
  });

  it('prevents modification of a seeded system category', async () => {
    await seedDefaultCategories(testPrisma);
    const { token } = await registerUser();
    const food = await getDefaultCategory('Food');
    expect(food).not.toBeNull();

    const res = await request(app)
      .patch(`/api/categories/${food!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const unchanged = await getDefaultCategory('Food');
    expect(unchanged?.name).toBe('Food');
  });

  it('prevents deletion of a seeded system category', async () => {
    await seedDefaultCategories(testPrisma);
    const { token } = await registerUser();
    const salary = await getDefaultCategory('Salary');
    expect(salary).not.toBeNull();

    const res = await request(app)
      .delete(`/api/categories/${salary!.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const stillThere = await getDefaultCategory('Salary');
    expect(stillThere).not.toBeNull();
  });

  it('applies system category protection to every user', async () => {
    await seedDefaultCategories(testPrisma);
    const { token: tokenA } = await registerUser();
    const { token: tokenB } = await registerUser();
    const housing = await getDefaultCategory('Housing');
    expect(housing).not.toBeNull();

    for (const token of [tokenA, tokenB]) {
      const res = await request(app)
        .delete(`/api/categories/${housing!.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }

    const stillThere = await getDefaultCategory('Housing');
    expect(stillThere).not.toBeNull();
  });

  it('lets a newly registered user create a transaction using a default category', async () => {
    await seedDefaultCategories(testPrisma);
    const { token } = await registerUser();

    const food = await getDefaultCategory('Food');
    expect(food).not.toBeNull();

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        categoryId: food!.id,
        type: 'EXPENSE',
        amount: '25.50',
        transactionDate: '2026-09-25',
        description: 'Groceries',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.amount).toBe(25.5);
    expect(res.body.data.transaction.category.name).toBe('Food');
    expect(res.body.data.transaction.category.isDefault).toBe(true);

    const stored = await testPrisma.transaction.findFirst({
      where: { categoryId: food!.id },
    });
    expect(stored).not.toBeNull();
  });

  it('lets a newly registered user create a transaction using an income default category', async () => {
    await seedDefaultCategories(testPrisma);
    const { token } = await registerUser();

    const salary = await getDefaultCategory('Salary');
    expect(salary).not.toBeNull();

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        categoryId: salary!.id,
        type: 'INCOME',
        amount: '5000.00',
        transactionDate: '2026-09-25',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.type).toBe('INCOME');
    expect(res.body.data.transaction.amount).toBe(5000);
  });

  it('keeps user-owned categories working alongside defaults', async () => {
    await seedDefaultCategories(testPrisma);
    const { token } = await registerUser();

    const created = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pet Care', type: 'EXPENSE' });

    expect(created.status).toBe(201);
    const customId = created.body.data.category.id;

    const list = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.categories).toHaveLength(DEFAULT_CATEGORIES.length + 1);

    const updated = await request(app)
      .patch(`/api/categories/${customId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pets' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.category.name).toBe('Pets');

    const deleted = await request(app)
      .delete(`/api/categories/${customId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(200);
  });
});
