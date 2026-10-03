import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, CategoryType, TransactionType, Prisma } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  assetRouter,
  liabilityRouter,
  summaryRouter,
} from '../src/routes/assetLiabilityRoutes.js';
import goalRoutes from '../src/routes/goalRoutes.js';
import { prisma } from '../src/config/prisma.js';
import { getAssetsLiabilitiesAggregate } from '../src/services/prismaAssetLiabilityService.js';

describe('Assets & Liabilities API', () => {
  let app: express.Express;
  let userA: { id: string };
  let userB: { id: string };
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

    userA = { id: createdA.id };
    userB = { id: createdB.id };
    tokenA = authService.generateAccessToken({
      id: createdA.id,
      role: createdA.role,
    });
    tokenB = authService.generateAccessToken({
      id: createdB.id,
      role: createdB.role,
    });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/assets', assetRouter);
    app.use('/api/liabilities', liabilityRouter);
    app.use('/api/assets-liabilities', summaryRouter);
    app.use('/api/goals', goalRoutes);
    app.use(errorHandler);
  });

  function assetPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Bank account',
      currentValue: '150000.00',
      ...overrides,
    };
  }

  function liabilityPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Credit card',
      outstandingAmount: '35000.00',
      ...overrides,
    };
  }

  async function createAsset(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await post('/api/assets', token).send(assetPayload(overrides));
    expect(res.status).toBe(201);
    return res.body.data.asset.id as string;
  }

  async function createLiability(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await post('/api/liabilities', token).send(
      liabilityPayload(overrides)
    );
    expect(res.status).toBe(201);
    return res.body.data.liability.id as string;
  }

  function post(url: string, token: string = tokenA) {
    return request(app).post(url).set('Authorization', `Bearer ${token}`);
  }

  function get(url: string, token: string = tokenA) {
    return request(app).get(url).set('Authorization', `Bearer ${token}`);
  }

  function patch(url: string, token: string = tokenA) {
    return request(app).patch(url).set('Authorization', `Bearer ${token}`);
  }

  function del(url: string, token: string = tokenA) {
    return request(app).delete(url).set('Authorization', `Bearer ${token}`);
  }

  describe('authentication', () => {
    it('requires a token on every asset and liability endpoint', async () => {
      const assetId = await createAsset();
      const liabilityId = await createLiability();

      expect((await request(app).get('/api/assets')).status).toBe(401);
      expect(
        (await request(app).post('/api/assets').send(assetPayload())).status
      ).toBe(401);
      expect((await request(app).get(`/api/assets/${assetId}`)).status).toBe(401);
      expect(
        (await request(app).patch(`/api/assets/${assetId}`).send({ name: 'x' }))
          .status
      ).toBe(401);
      expect((await request(app).delete(`/api/assets/${assetId}`)).status).toBe(401);

      expect((await request(app).get('/api/liabilities')).status).toBe(401);
      expect(
        (await request(app).post('/api/liabilities').send(liabilityPayload()))
          .status
      ).toBe(401);
      expect(
        (await request(app).get(`/api/liabilities/${liabilityId}`)).status
      ).toBe(401);
      expect(
        (await request(app)
          .patch(`/api/liabilities/${liabilityId}`)
          .send({ name: 'x' })).status
      ).toBe(401);
      expect(
        (await request(app).delete(`/api/liabilities/${liabilityId}`)).status
      ).toBe(401);

      expect((await request(app).get('/api/assets-liabilities/summary')).status).toBe(
        401
      );
    });
  });

  describe('create asset', () => {
    it('creates an asset with documented defaults', async () => {
      const res = await post('/api/assets').send(assetPayload());

      expect(res.status).toBe(201);
      const asset = res.body.data.asset;
      expect(asset.name).toBe('Bank account');
      expect(asset.type).toBe('OTHER');
      expect(asset.currentValue).toBe(150000);
      expect(asset.notes).toBeNull();
      expect(asset.status).toBe('ACTIVE');
      expect(asset.userId).toBeUndefined();
      expect(asset.createdAt).toBeDefined();
      expect(asset.updatedAt).toBeDefined();
    });

    it('creates an asset with every supported field', async () => {
      const res = await post('/api/assets').send(
        assetPayload({
          name: 'Fixed deposit',
          type: 'FIXED_DEPOSIT',
          currentValue: '250000.50',
          notes: 'Matures next year',
        })
      );

      expect(res.status).toBe(201);
      const asset = res.body.data.asset;
      expect(asset.type).toBe('FIXED_DEPOSIT');
      expect(asset.currentValue).toBe(250000.5);
      expect(asset.notes).toBe('Matures next year');
    });

    it('accepts a numeric current value', async () => {
      const res = await post('/api/assets').send(
        assetPayload({ currentValue: 25000 })
      );

      expect(res.status).toBe(201);
      expect(res.body.data.asset.currentValue).toBe(25000);
    });

    it('allows a zero-valued asset', async () => {
      const res = await post('/api/assets').send(
        assetPayload({ name: 'Empty wallet', currentValue: '0' })
      );

      expect(res.status).toBe(201);
      expect(res.body.data.asset.currentValue).toBe(0);

      const row = await testPrisma.asset.findUnique({
        where: { id: res.body.data.asset.id },
      });
      expect(Number(row?.currentValue)).toBe(0);
    });

    it('rejects a missing name', async () => {
      const res = await post('/api/assets').send(
        assetPayload({ name: undefined })
      );

      expect(res.status).toBe(400);
      expect(res.body.errors['body.name']).toBeDefined();
    });

    it('rejects a missing current value', async () => {
      const res = await post('/api/assets').send({ name: 'No value' });

      expect(res.status).toBe(400);
      expect(res.body.errors['body.currentValue']).toBeDefined();
    });

    it('rejects negative, malformed and over-precise values', async () => {
      const negative = await post('/api/assets').send(
        assetPayload({ currentValue: '-10.00' })
      );
      expect(negative.status).toBe(400);
      expect(negative.body.errors['body.currentValue']).toBeDefined();

      const malformed = await post('/api/assets').send(
        assetPayload({ currentValue: 'abc' })
      );
      expect(malformed.status).toBe(400);

      const tooManyDecimals = await post('/api/assets').send(
        assetPayload({ currentValue: '10.123' })
      );
      expect(tooManyDecimals.status).toBe(400);

      const missing = await post('/api/assets').send(
        assetPayload({ currentValue: undefined })
      );
      expect(missing.status).toBe(400);

      expect(await testPrisma.asset.count()).toBe(0);
    });

    it('rejects an amount above the money cap', async () => {
      const res = await post('/api/assets').send(
        assetPayload({ currentValue: '10000000000000.00' })
      );

      expect(res.status).toBe(400);
      expect(res.body.errors['body.currentValue']).toBeDefined();
    });

    it('rejects an unsupported asset type', async () => {
      const res = await post('/api/assets').send(
        assetPayload({ type: 'CRYPTO_WALLET' })
      );

      expect(res.status).toBe(400);
      expect(res.body.errors['body.type']).toBeDefined();
    });

    it('rejects an over-long name or notes', async () => {
      const longName = await post('/api/assets').send(
        assetPayload({ name: 'x'.repeat(101) })
      );
      expect(longName.status).toBe(400);
      expect(longName.body.errors['body.name']).toBeDefined();

      const longNotes = await post('/api/assets').send(
        assetPayload({ notes: 'x'.repeat(1001) })
      );
      expect(longNotes.status).toBe(400);
      expect(longNotes.body.errors['body.notes']).toBeDefined();
    });

    it('blocks mass assignment of protected fields', async () => {
      const res = await post('/api/assets').send(
        assetPayload({
          id: 'forged-id',
          userId: userB.id,
          status: 'ARCHIVED',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        })
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body']).toBeDefined();
      expect(await testPrisma.asset.count()).toBe(0);
    });
  });

  describe('get asset', () => {
    it('returns the asset', async () => {
      const assetId = await createAsset({ type: 'BANK_ACCOUNT' });

      const res = await get(`/api/assets/${assetId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.asset.id).toBe(assetId);
      expect(res.body.data.asset.type).toBe('BANK_ACCOUNT');
      expect(res.body.data.asset.currentValue).toBe(150000);
    });

    it('returns 404 ASSET_NOT_FOUND for an unknown asset', async () => {
      const res = await get('/api/assets/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ASSET_NOT_FOUND');
    });

    it('does not leak another user\'s asset', async () => {
      const assetId = await createAsset();

      const res = await get(`/api/assets/${assetId}`, tokenB);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ASSET_NOT_FOUND');
    });
  });

  describe('list assets', () => {
    it('returns an empty page', async () => {
      const res = await get('/api/assets');

      expect(res.status).toBe(200);
      expect(res.body.data.assets).toEqual([]);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      expect(res.body.data.total).toBe(0);
    });

    it('keeps assets isolated per user', async () => {
      const mine = await createAsset({ name: 'Mine' });
      await createAsset({ name: 'Theirs' }, tokenB);

      const mineList = await get('/api/assets');
      expect(mineList.body.data.total).toBe(1);
      expect(mineList.body.data.assets[0].id).toBe(mine);
      expect(mineList.body.data.assets[0].name).toBe('Mine');

      const theirs = await get('/api/assets', tokenB);
      expect(theirs.body.data.total).toBe(1);
      expect(theirs.body.data.assets[0].name).toBe('Theirs');
    });

    it('returns the newest asset first', async () => {
      const first = await createAsset({ name: 'First' });
      const second = await createAsset({ name: 'Second' });
      const third = await createAsset({ name: 'Third' });

      const res = await get('/api/assets');

      const ids = res.body.data.assets.map((asset: { id: string }) => asset.id);
      expect(ids).toEqual([third, second, first]);
    });

    it('paginates assets', async () => {
      await createAsset({ name: 'One' });
      await createAsset({ name: 'Two' });
      await createAsset({ name: 'Three' });

      const first = await get('/api/assets?page=1&pageSize=2');
      expect(first.body.data.assets).toHaveLength(2);
      expect(first.body.data.total).toBe(3);
      expect(first.body.data.page).toBe(1);

      const second = await get('/api/assets?page=2&pageSize=2');
      expect(second.body.data.assets).toHaveLength(1);
      expect(second.body.data.total).toBe(3);
      expect(second.body.data.page).toBe(2);
    });

    it('rejects an out-of-range page size', async () => {
      const res = await get('/api/assets?pageSize=500');

      expect(res.status).toBe(400);
      expect(res.body.errors['query.pageSize']).toBeDefined();
    });

    it('filters assets by type and rejects an unknown type filter', async () => {
      const bank = await createAsset({ name: 'Bank', type: 'BANK_ACCOUNT' });
      await createAsset({ name: 'Gold', type: 'GOLD' });

      const filtered = await get('/api/assets?type=BANK_ACCOUNT');
      expect(
        filtered.body.data.assets.map((asset: { id: string }) => asset.id)
      ).toEqual([bank]);
      expect(filtered.body.data.total).toBe(1);

      const invalid = await get('/api/assets?type=SPACECRAFT');
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors['query.type']).toBeDefined();
    });
  });

  describe('update asset', () => {
    it('updates editable fields', async () => {
      const assetId = await createAsset();

      const res = await patch(`/api/assets/${assetId}`).send({
        name: 'Savings account',
        type: 'BANK_ACCOUNT',
        currentValue: '175000.00',
        notes: 'Primary account',
      });

      expect(res.status).toBe(200);
      const asset = res.body.data.asset;
      expect(asset.name).toBe('Savings account');
      expect(asset.type).toBe('BANK_ACCOUNT');
      expect(asset.currentValue).toBe(175000);
      expect(asset.notes).toBe('Primary account');
    });

    it('updates only the current value', async () => {
      const assetId = await createAsset({ currentValue: '100000.00' });

      const res = await patch(`/api/assets/${assetId}`).send({
        currentValue: '120000.00',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.asset.currentValue).toBe(120000);
      expect(res.body.data.asset.name).toBe('Bank account');
    });

    it('allows the current value to be zeroed out', async () => {
      const assetId = await createAsset({ currentValue: '900.00' });

      const res = await patch(`/api/assets/${assetId}`).send({
        currentValue: '0',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.asset.currentValue).toBe(0);
      expect(res.body.data.asset.status).toBe('ACTIVE');
    });

    it('clears a nullable note', async () => {
      const assetId = await createAsset({ notes: 'temporary' });

      const res = await patch(`/api/assets/${assetId}`).send({ notes: null });

      expect(res.status).toBe(200);
      expect(res.body.data.asset.notes).toBeNull();
    });

    it('rejects an empty update body', async () => {
      const assetId = await createAsset();

      const res = await patch(`/api/assets/${assetId}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.errors['body']).toBeDefined();
    });

    it('rejects unknown fields on update', async () => {
      const assetId = await createAsset();

      const res = await patch(`/api/assets/${assetId}`).send({
        userId: userB.id,
        purchaseValue: '1.00',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body']).toBeDefined();
    });

    it('rejects an invalid value on update', async () => {
      const assetId = await createAsset();

      const res = await patch(`/api/assets/${assetId}`).send({
        currentValue: '-5',
      });

      expect(res.status).toBe(400);
      expect(res.body.errors['body.currentValue']).toBeDefined();
    });

    it('does not allow updating another user\'s asset', async () => {
      const assetId = await createAsset();

      const res = await patch(`/api/assets/${assetId}`, tokenB).send({
        currentValue: '1.00',
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ASSET_NOT_FOUND');
      const row = await testPrisma.asset.findUnique({ where: { id: assetId } });
      expect(Number(row?.currentValue)).toBe(150000);
    });

    it('does not allow reassigning ownership', async () => {
      const assetId = await createAsset();

      const res = await patch(`/api/assets/${assetId}`).send({
        userId: userB.id,
      });

      expect(res.status).toBe(400);
      const row = await testPrisma.asset.findUnique({ where: { id: assetId } });
      expect(row?.userId).toBe(userA.id);
    });

    it('returns 404 for an unknown asset', async () => {
      const res = await patch('/api/assets/nope').send({ name: 'Ghost' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ASSET_NOT_FOUND');
    });
  });

  describe('delete asset', () => {
    it('deletes an asset', async () => {
      const assetId = await createAsset();

      const res = await del(`/api/assets/${assetId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Asset deleted');
      expect(await testPrisma.asset.count()).toBe(0);
    });

    it('returns 404 on repeated delete', async () => {
      const assetId = await createAsset();
      await del(`/api/assets/${assetId}`);

      const res = await del(`/api/assets/${assetId}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ASSET_NOT_FOUND');
    });

    it('does not allow deleting another user\'s asset', async () => {
      const assetId = await createAsset();

      const res = await del(`/api/assets/${assetId}`, tokenB);

      expect(res.status).toBe(404);
      expect(await testPrisma.asset.count()).toBe(1);
    });
  });

  describe('create liability', () => {
    it('creates a liability with documented defaults', async () => {
      const res = await post('/api/liabilities').send(liabilityPayload());

      expect(res.status).toBe(201);
      const liability = res.body.data.liability;
      expect(liability.name).toBe('Credit card');
      expect(liability.type).toBe('OTHER');
      expect(liability.outstandingAmount).toBe(35000);
      expect(liability.notes).toBeNull();
      expect(liability.status).toBe('ACTIVE');
      expect(liability.userId).toBeUndefined();
    });

    it('creates a liability with every supported field', async () => {
      const res = await post('/api/liabilities').send(
        liabilityPayload({
          name: 'Home loan',
          type: 'HOME_LOAN',
          outstandingAmount: '3500000.00',
          notes: 'Bank of example',
        })
      );

      expect(res.status).toBe(201);
      const liability = res.body.data.liability;
      expect(liability.type).toBe('HOME_LOAN');
      expect(liability.outstandingAmount).toBe(3500000);
      expect(liability.notes).toBe('Bank of example');
    });

    it('accepts a numeric outstanding amount', async () => {
      const res = await post('/api/liabilities').send(
        liabilityPayload({ outstandingAmount: 2500 })
      );

      expect(res.status).toBe(201);
      expect(res.body.data.liability.outstandingAmount).toBe(2500);
    });

    it('allows a fully repaid liability with a zero balance', async () => {
      const res = await post('/api/liabilities').send(
        liabilityPayload({ name: 'Cleared card', outstandingAmount: '0' })
      );

      expect(res.status).toBe(201);
      expect(res.body.data.liability.outstandingAmount).toBe(0);
      expect(res.body.data.liability.status).toBe('PAID_OFF');
    });

    it('rejects a missing name or amount', async () => {
      const noName = await post('/api/liabilities').send(
        liabilityPayload({ name: undefined })
      );
      expect(noName.status).toBe(400);
      expect(noName.body.errors['body.name']).toBeDefined();

      const noAmount = await post('/api/liabilities').send({ name: 'Card' });
      expect(noAmount.status).toBe(400);
      expect(noAmount.body.errors['body.outstandingAmount']).toBeDefined();
    });

    it('rejects negative, malformed and over-precise amounts', async () => {
      const negative = await post('/api/liabilities').send(
        liabilityPayload({ outstandingAmount: '-1' })
      );
      expect(negative.status).toBe(400);
      expect(negative.body.errors['body.outstandingAmount']).toBeDefined();

      const malformed = await post('/api/liabilities').send(
        liabilityPayload({ outstandingAmount: 'ten' })
      );
      expect(malformed.status).toBe(400);

      const tooManyDecimals = await post('/api/liabilities').send(
        liabilityPayload({ outstandingAmount: '1.999' })
      );
      expect(tooManyDecimals.status).toBe(400);

      expect(await testPrisma.liability.count()).toBe(0);
    });

    it('rejects an unsupported liability type', async () => {
      const res = await post('/api/liabilities').send(
        liabilityPayload({ type: 'STUDENT_DEBT' })
      );

      expect(res.status).toBe(400);
      expect(res.body.errors['body.type']).toBeDefined();
    });

    it('blocks mass assignment of protected fields', async () => {
      const res = await post('/api/liabilities').send(
        liabilityPayload({
          id: 'forged',
          userId: userB.id,
          status: 'PAID_OFF',
          interestRate: '99.99',
          createdAt: '2020-01-01T00:00:00.000Z',
        })
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body']).toBeDefined();
      expect(await testPrisma.liability.count()).toBe(0);
    });
  });

  describe('get liability', () => {
    it('returns the liability', async () => {
      const liabilityId = await createLiability({ type: 'CREDIT_CARD' });

      const res = await get(`/api/liabilities/${liabilityId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.liability.id).toBe(liabilityId);
      expect(res.body.data.liability.type).toBe('CREDIT_CARD');
      expect(res.body.data.liability.outstandingAmount).toBe(35000);
    });

    it('returns 404 LIABILITY_NOT_FOUND for an unknown liability', async () => {
      const res = await get('/api/liabilities/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LIABILITY_NOT_FOUND');
    });

    it('does not leak another user\'s liability', async () => {
      const liabilityId = await createLiability();

      const res = await get(`/api/liabilities/${liabilityId}`, tokenB);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LIABILITY_NOT_FOUND');
    });
  });

  describe('list liabilities', () => {
    it('returns an empty page', async () => {
      const res = await get('/api/liabilities');

      expect(res.status).toBe(200);
      expect(res.body.data.liabilities).toEqual([]);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      expect(res.body.data.total).toBe(0);
    });

    it('keeps liabilities isolated per user', async () => {
      const mine = await createLiability({ name: 'My card' });
      await createLiability({ name: 'Their card' }, tokenB);

      const mineList = await get('/api/liabilities');
      expect(mineList.body.data.total).toBe(1);
      expect(mineList.body.data.liabilities[0].id).toBe(mine);

      const theirs = await get('/api/liabilities', tokenB);
      expect(theirs.body.data.total).toBe(1);
      expect(theirs.body.data.liabilities[0].name).toBe('Their card');
    });

    it('paginates liabilities', async () => {
      await createLiability({ name: 'One' });
      await createLiability({ name: 'Two' });
      await createLiability({ name: 'Three' });

      const first = await get('/api/liabilities?page=1&pageSize=2');
      expect(first.body.data.liabilities).toHaveLength(2);
      expect(first.body.data.total).toBe(3);

      const second = await get('/api/liabilities?page=2&pageSize=2');
      expect(second.body.data.liabilities).toHaveLength(1);
      expect(second.body.data.page).toBe(2);
    });

    it('rejects an out-of-range page size', async () => {
      const res = await get('/api/liabilities?pageSize=0');

      expect(res.status).toBe(400);
      expect(res.body.errors['query.pageSize']).toBeDefined();
    });

    it('filters liabilities by type', async () => {
      const card = await createLiability({ name: 'Card', type: 'CREDIT_CARD' });
      await createLiability({ name: 'Loan', type: 'PERSONAL_LOAN' });

      const filtered = await get('/api/liabilities?type=CREDIT_CARD');
      expect(
        filtered.body.data.liabilities.map(
          (liability: { id: string }) => liability.id
        )
      ).toEqual([card]);

      const invalid = await get('/api/liabilities?type=PAYDAY_LOAN');
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors['query.type']).toBeDefined();
    });
  });

  describe('update liability', () => {
    it('updates editable fields', async () => {
      const liabilityId = await createLiability();

      const res = await patch(`/api/liabilities/${liabilityId}`).send({
        name: 'Platinum card',
        type: 'CREDIT_CARD',
        outstandingAmount: '40000.00',
        notes: 'Updated note',
      });

      expect(res.status).toBe(200);
      const liability = res.body.data.liability;
      expect(liability.name).toBe('Platinum card');
      expect(liability.type).toBe('CREDIT_CARD');
      expect(liability.outstandingAmount).toBe(40000);
      expect(liability.notes).toBe('Updated note');
      expect(liability.status).toBe('ACTIVE');
    });

    it('updates only the outstanding balance', async () => {
      const liabilityId = await createLiability({
        outstandingAmount: '50000.00',
      });

      const res = await patch(`/api/liabilities/${liabilityId}`).send({
        outstandingAmount: '45000.00',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.liability.outstandingAmount).toBe(45000);
      expect(res.body.data.liability.name).toBe('Credit card');
    });

    it('derives PAID_OFF once the balance reaches zero', async () => {
      const liabilityId = await createLiability({
        outstandingAmount: '100.00',
      });

      const zeroed = await patch(`/api/liabilities/${liabilityId}`).send({
        outstandingAmount: '0',
      });
      expect(zeroed.body.data.liability.status).toBe('PAID_OFF');

      const reopened = await patch(`/api/liabilities/${liabilityId}`).send({
        outstandingAmount: '25.00',
      });
      expect(reopened.body.data.liability.status).toBe('ACTIVE');

      const row = await testPrisma.liability.findUnique({
        where: { id: liabilityId },
      });
      expect(row).not.toHaveProperty('status');
    });

    it('rejects an empty update body', async () => {
      const liabilityId = await createLiability();

      const res = await patch(`/api/liabilities/${liabilityId}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.errors['body']).toBeDefined();
    });

    it('rejects unknown fields on update', async () => {
      const liabilityId = await createLiability();

      const res = await patch(`/api/liabilities/${liabilityId}`).send({
        originalAmount: '999.00',
        status: 'ARCHIVED',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body']).toBeDefined();
    });

    it('rejects an invalid balance on update', async () => {
      const liabilityId = await createLiability();

      const res = await patch(`/api/liabilities/${liabilityId}`).send({
        outstandingAmount: '-10',
      });

      expect(res.status).toBe(400);
      expect(res.body.errors['body.outstandingAmount']).toBeDefined();
    });

    it('does not allow updating another user\'s liability', async () => {
      const liabilityId = await createLiability();

      const res = await patch(`/api/liabilities/${liabilityId}`, tokenB).send({
        outstandingAmount: '0',
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LIABILITY_NOT_FOUND');
      const row = await testPrisma.liability.findUnique({
        where: { id: liabilityId },
      });
      expect(Number(row?.outstandingAmount)).toBe(35000);
    });

    it('returns 404 for an unknown liability', async () => {
      const res = await patch('/api/liabilities/nope').send({ name: 'Ghost' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LIABILITY_NOT_FOUND');
    });
  });

  describe('delete liability', () => {
    it('deletes a liability', async () => {
      const liabilityId = await createLiability();

      const res = await del(`/api/liabilities/${liabilityId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Liability deleted');
      expect(await testPrisma.liability.count()).toBe(0);
    });

    it('returns 404 on repeated delete', async () => {
      const liabilityId = await createLiability();
      await del(`/api/liabilities/${liabilityId}`);

      const res = await del(`/api/liabilities/${liabilityId}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LIABILITY_NOT_FOUND');
    });

    it('does not allow deleting another user\'s liability', async () => {
      const liabilityId = await createLiability();

      const res = await del(`/api/liabilities/${liabilityId}`, tokenB);

      expect(res.status).toBe(404);
      expect(await testPrisma.liability.count()).toBe(1);
    });
  });

  describe('summary', () => {
    it('returns zeroed totals for a user with no records', async () => {
      const res = await get('/api/assets-liabilities/summary');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        assetCount: 0,
        liabilityCount: 0,
      });
    });

    it('totals assets and liabilities independently with counts', async () => {
      await createAsset({ name: 'Cash', currentValue: '25000.00' });
      await createAsset({ name: 'Property', currentValue: '5000000.00' });
      await createLiability({ name: 'Card', outstandingAmount: '35000.00' });
      await createLiability({
        name: 'Car loan',
        outstandingAmount: '250000.00',
      });

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.totalAssets).toBe(5025000);
      expect(res.body.data.assetCount).toBe(2);
      expect(res.body.data.totalLiabilities).toBe(285000);
      expect(res.body.data.liabilityCount).toBe(2);
      expect(res.body.data.netWorth).toBe(4740000);
    });

    it('sums decimal amounts without floating point drift', async () => {
      await createAsset({ name: 'A', currentValue: '0.10' });
      await createAsset({ name: 'B', currentValue: '0.20' });
      await createAsset({ name: 'C', currentValue: '33.33' });
      await createLiability({ name: 'L1', outstandingAmount: '0.10' });
      await createLiability({ name: 'L2', outstandingAmount: '0.20' });

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.totalAssets).toBe(33.63);
      expect(res.body.data.totalLiabilities).toBe(0.3);
    });

    it('counts zero-valued records in their totals', async () => {
      await createAsset({ name: 'Empty', currentValue: '0' });
      await createLiability({ name: 'Repaid', outstandingAmount: '0' });

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.assetCount).toBe(1);
      expect(res.body.data.totalAssets).toBe(0);
      expect(res.body.data.liabilityCount).toBe(1);
      expect(res.body.data.totalLiabilities).toBe(0);
    });

    it('keeps summaries isolated per user', async () => {
      await createAsset({ name: 'Mine', currentValue: '1000.00' });
      await createLiability({ name: 'Mine', outstandingAmount: '400.00' });
      await createAsset({ name: 'Theirs', currentValue: '9999.00' }, tokenB);

      const mine = await get('/api/assets-liabilities/summary');
      expect(mine.body.data.totalAssets).toBe(1000);
      expect(mine.body.data.assetCount).toBe(1);
      expect(mine.body.data.totalLiabilities).toBe(400);
      expect(mine.body.data.liabilityCount).toBe(1);

      const theirs = await get('/api/assets-liabilities/summary', tokenB);
      expect(theirs.body.data.totalAssets).toBe(9999);
      expect(theirs.body.data.assetCount).toBe(1);
      expect(theirs.body.data.totalLiabilities).toBe(0);
      expect(theirs.body.data.liabilityCount).toBe(0);
    });

    it('derives net worth as assets minus liabilities without drift', async () => {
      await createAsset({ currentValue: '1000.00' });
      await createLiability({ outstandingAmount: '400.00' });

      const res = await get('/api/assets-liabilities/summary');

      expect(Object.keys(res.body.data).sort()).toEqual([
        'assetCount',
        'liabilityCount',
        'netWorth',
        'totalAssets',
        'totalLiabilities',
      ]);
      expect(res.body.data.netWorth).toBe(600);
      expect(res.body.data.netWorth).toBe(
        res.body.data.totalAssets - res.body.data.totalLiabilities
      );
      expect(res.body.data).not.toHaveProperty('netWorthAmount');
    });
  });

  describe('transaction isolation', () => {
    it('reads both aggregates in a single RepeatableRead transaction', async () => {
      await createAsset({ currentValue: '150000.00' });
      await createAsset({ currentValue: '5000.00' });
      await createLiability({ outstandingAmount: '35000.00' });

      const transactionSpy = vi.spyOn(prisma, '$transaction');

      try {
        const aggregate = await getAssetsLiabilitiesAggregate(userA.id);

        expect(transactionSpy).toHaveBeenCalledTimes(1);
        expect(transactionSpy).toHaveBeenCalledWith(expect.any(Function), {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });

        expect(aggregate.totalAssets.toNumber()).toBe(155000);
        expect(aggregate.assetCount).toBe(2);
        expect(aggregate.totalLiabilities.toNumber()).toBe(35000);
        expect(aggregate.liabilityCount).toBe(1);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  describe('transaction separation', () => {
    async function createCategory(): Promise<string> {
      const category = await testPrisma.category.create({
        data: {
          userId: userA.id,
          name: 'Groceries',
          type: CategoryType.EXPENSE,
          isDefault: false,
        },
      });
      return category.id;
    }

    async function createTransaction(categoryId: string): Promise<string> {
      const transaction = await testPrisma.transaction.create({
        data: {
          userId: userA.id,
          categoryId,
          type: TransactionType.EXPENSE,
          amount: '1000.00',
          transactionDate: new Date(),
          description: 'Weekly groceries',
        },
      });
      return transaction.id;
    }

    it('never creates transactions during an asset lifecycle', async () => {
      const categoryId = await createCategory();
      const transactionId = await createTransaction(categoryId);
      expect(await testPrisma.transaction.count()).toBe(1);

      const assetId = await createAsset({ currentValue: '100000.00' });
      await patch(`/api/assets/${assetId}`).send({ currentValue: '120000.00' });
      await patch(`/api/assets/${assetId}`).send({ currentValue: '90000.00' });
      await del(`/api/assets/${assetId}`);

      const transactions = await testPrisma.transaction.findMany();
      expect(transactions).toHaveLength(1);
      expect(transactions[0].id).toBe(transactionId);
      expect(Number(transactions[0].amount)).toBe(1000);
    });

    it('never creates transactions during a liability lifecycle', async () => {
      const categoryId = await createCategory();
      await createTransaction(categoryId);

      const liabilityId = await createLiability({
        outstandingAmount: '40000.00',
      });
      await patch(`/api/liabilities/${liabilityId}`).send({
        outstandingAmount: '30000.00',
      });
      await patch(`/api/liabilities/${liabilityId}`).send({
        outstandingAmount: '0',
      });
      await del(`/api/liabilities/${liabilityId}`);

      expect(await testPrisma.transaction.count()).toBe(1);
    });

    it('never creates notifications, budgets, bills or subscriptions', async () => {
      await createAsset();
      await createLiability();
      await patch('/api/assets-liabilities/summary').send({});

      const [notifications, budgets, bills, subscriptions, recurring] =
        await Promise.all([
          testPrisma.notification.count(),
          testPrisma.budget.count(),
          testPrisma.bill.count(),
          testPrisma.subscription.count(),
          testPrisma.recurringTransaction.count(),
        ]);

      expect(notifications).toBe(0);
      expect(budgets).toBe(0);
      expect(bills).toBe(0);
      expect(subscriptions).toBe(0);
      expect(recurring).toBe(0);
    });
  });

  describe('savings goal separation', () => {
    async function createGoalWithContribution(): Promise<{
      goalId: string;
      contributionId: string;
    }> {
      const created = await post('/api/goals').send({
        name: 'Emergency fund',
        targetAmount: '200000.00',
        targetDate: '2027-01-01',
      });
      expect(created.status).toBe(201);
      const goalId = created.body.data.goal.id as string;

      const contribution = await post(`/api/goals/${goalId}/contributions`).send(
        { amount: '20000.00' }
      );
      expect(contribution.status).toBe(201);

      return { goalId, contributionId: contribution.body.data.contribution.id };
    }

    it('a goal contribution does not change any asset balance', async () => {
      const { goalId } = await createGoalWithContribution();
      await createAsset({ name: 'Bank', currentValue: '100000.00' });

      const before = await get('/api/assets-liabilities/summary');
      expect(before.body.data.totalAssets).toBe(100000);

      await post(`/api/goals/${goalId}/contributions`).send({
        amount: '5000.00',
      });

      const after = await get('/api/assets-liabilities/summary');
      expect(after.body.data.totalAssets).toBe(100000);
      expect(after.body.data.assetCount).toBe(1);
      expect(await testPrisma.asset.count()).toBe(1);
    });

    it('asset changes do not change goal contribution totals', async () => {
      const { goalId } = await createGoalWithContribution();
      const assetId = await createAsset({ currentValue: '50000.00' });

      await patch(`/api/assets/${assetId}`).send({ currentValue: '500000.00' });
      await patch(`/api/assets/${assetId}`).send({ currentValue: '0' });
      await del(`/api/assets/${assetId}`);

      const progress = await get(`/api/goals/${goalId}/progress`);

      expect(progress.status).toBe(200);
      expect(progress.body.data.progress.currentAmount).toBe(20000);
      expect(progress.body.data.progress.contributionCount).toBe(1);
      expect(await testPrisma.goalContribution.count()).toBe(1);
      expect(await testPrisma.savingsGoal.count()).toBe(1);
    });

    it('liability changes do not change goal contribution totals', async () => {
      const { goalId } = await createGoalWithContribution();
      const liabilityId = await createLiability({
        outstandingAmount: '60000.00',
      });

      await patch(`/api/liabilities/${liabilityId}`).send({
        outstandingAmount: '0',
      });

      const progress = await get(`/api/goals/${goalId}/progress`);
      expect(progress.body.data.progress.currentAmount).toBe(20000);
      expect(await testPrisma.goalContribution.count()).toBe(1);
    });

    it('deleting an asset does not delete transactions or goals', async () => {
      const { goalId } = await createGoalWithContribution();

      const category = await testPrisma.category.create({
        data: {
          userId: userA.id,
          name: 'Rent',
          type: CategoryType.EXPENSE,
          isDefault: false,
        },
      });
      await testPrisma.transaction.create({
        data: {
          userId: userA.id,
          categoryId: category.id,
          type: TransactionType.EXPENSE,
          amount: '15000.00',
          transactionDate: new Date(),
        },
      });

      const assetId = await createAsset();
      const liabilityId = await createLiability();

      await del(`/api/assets/${assetId}`);
      await del(`/api/liabilities/${liabilityId}`);

      expect(await testPrisma.transaction.count()).toBe(1);
      expect(await testPrisma.savingsGoal.count()).toBe(1);
      expect(await testPrisma.goalContribution.count()).toBe(1);
      expect(await testPrisma.category.count()).toBe(1);
      expect(
        await testPrisma.savingsGoal.findUnique({ where: { id: goalId } })
      ).not.toBeNull();
    });
  });

  describe('data isolation', () => {
    it('starts each test with clean asset and liability tables', async () => {
      expect(await testPrisma.asset.count()).toBe(0);
      expect(await testPrisma.liability.count()).toBe(0);
      expect(userA.id).not.toBe(userB.id);
    });
  });
});
