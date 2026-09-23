import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { generateKeyPairSync } from 'crypto';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { Role, AccountStatus } from '@prisma/client';
import { env } from '../src/config/index.js';
import { authenticate } from '../src/middleware/authMiddleware.js';
import { requireRole, requireUser } from '../src/middleware/rbacMiddleware.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

describe('Auth Middleware', () => {
  let testUser: { email: string; password: string; firstName: string; lastName: string };
  let passwordHash: string;
  let userId: string;
  let accessToken: string;
  let suspendedUserId: string;
  let suspendedToken: string;
  let deactivatedUserId: string;
  let deactivatedToken: string;
  let adminId: string;
  let adminToken: string;

  beforeEach(async () => {
    testUser = createTestUser();
    passwordHash = await hashPassword(testUser.password);

    const user = await testPrisma.user.create({
      data: {
        email: testUser.email,
        passwordHash,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });
    userId = user.id;
    accessToken = jwt.sign(
      { sub: user.id, role: user.role, type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    // Suspended user
    const suspended = await testPrisma.user.create({
      data: {
        email: createTestUser().email,
        passwordHash,
        firstName: 'Suspended',
        lastName: 'User',
        role: Role.USER,
        status: AccountStatus.SUSPENDED,
      },
    });
    suspendedUserId = suspended.id;
    suspendedToken = jwt.sign(
      { sub: suspended.id, role: suspended.role, type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    // Deactivated user
    const deactivated = await testPrisma.user.create({
      data: {
        email: createTestUser().email,
        passwordHash,
        firstName: 'Deactivated',
        lastName: 'User',
        role: Role.USER,
        status: AccountStatus.DEACTIVATED,
      },
    });
    deactivatedUserId = deactivated.id;
    deactivatedToken = jwt.sign(
      { sub: deactivated.id, role: deactivated.role, type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    // Admin user
    const admin = await testPrisma.user.create({
      data: {
        email: createTestUser().email,
        passwordHash,
        firstName: 'Admin',
        lastName: 'User',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
      },
    });
    adminId = admin.id;
    adminToken = jwt.sign(
      { sub: admin.id, role: admin.role, type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );
  });

  function createTestApp(middleware: any[]) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.get('/test', ...middleware, (req: any, res) => {
      res.json({ success: true, user: req.user });
    });
    app.use(errorHandler);
    return app;
  }

  describe('authenticate', () => {
    it('should accept valid token', async () => {
      const app = createTestApp([authenticate]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe(userId);
    });

    it('should reject missing token', async () => {
      const app = createTestApp([authenticate]);

      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject malformed token', async () => {
      const app = createTestApp([authenticate]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', 'Bearer malformed.token.here');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('should reject invalid signature', async () => {
      const app = createTestApp([authenticate]);

      const invalidToken = jwt.sign(
        { sub: userId, role: Role.USER, type: 'access' },
        'wrong-secret',
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${invalidToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('should reject expired token', async () => {
      const app = createTestApp([authenticate]);

      const expiredToken = jwt.sign(
        { sub: userId, role: Role.USER, type: 'access' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '-1h' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('should reject suspended user', async () => {
      const app = createTestApp([authenticate]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${suspendedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('should reject deactivated user', async () => {
      const app = createTestApp([authenticate]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${deactivatedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    });

    it('should reject non-existent user', async () => {
      const app = createTestApp([authenticate]);

      const token = jwt.sign(
        { sub: 'non-existent-id', role: Role.USER, type: 'access' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject wrong token type', async () => {
      const app = createTestApp([authenticate]);

      const token = jwt.sign(
        { sub: userId, role: Role.USER, type: 'refresh' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('should reject token with wrong algorithm (RS256)', async () => {
      const app = createTestApp([authenticate]);

      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const token = jwt.sign(
        { sub: userId, role: Role.USER, type: 'access' },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('should reject token with missing sub claim', async () => {
      const app = createTestApp([authenticate]);

      const token = jwt.sign(
        { role: Role.USER, type: 'access' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('should reject token with missing role claim', async () => {
      const app = createTestApp([authenticate]);

      const token = jwt.sign(
        { sub: userId, type: 'access' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('should reject token with invalid role claim', async () => {
      const app = createTestApp([authenticate]);

      const token = jwt.sign(
        { sub: userId, role: 'INVALID_ROLE', type: 'access' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('should reject token with missing type claim', async () => {
      const app = createTestApp([authenticate]);

      const token = jwt.sign(
        { sub: userId, role: Role.USER },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '15m' }
      );

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });
  });

  describe('requireRole', () => {
    it('should allow USER to access USER endpoint', async () => {
      const app = createTestApp([authenticate, requireRole(Role.USER)]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
    });

    it('should allow ADMIN to access USER endpoint', async () => {
      const app = createTestApp([authenticate, requireUser]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('should reject USER from ADMIN endpoint', async () => {
      const app = createTestApp([authenticate, requireRole(Role.ADMIN)]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow ADMIN to access ADMIN endpoint', async () => {
      const app = createTestApp([authenticate, requireRole(Role.ADMIN)]);

      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('should reject unauthenticated from ADMIN endpoint', async () => {
      const app = createTestApp([authenticate, requireRole(Role.ADMIN)]);

      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
    });
  });
});