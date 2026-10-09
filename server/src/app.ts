import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/index.js';
import { securityHeaderOptions } from './config/securityHeaders.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/logger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { noStoreApiResponses } from './middleware/cacheControl.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import transactionCategoryRuleRoutes from './routes/transactionCategoryRuleRoutes.js';
import budgetRoutes from './routes/budgetRoutes.js';
import recurringTransactionRoutes from './routes/recurringTransactionRoutes.js';
import billRoutes from './routes/billRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import habitRoutes from './routes/habitRoutes.js';
import challengeRoutes from './routes/challengeRoutes.js';

import goalRoutes from './routes/goalRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import {
  assetRouter,
  liabilityRouter,
  summaryRouter,
} from './routes/assetLiabilityRoutes.js';
import { wealthSnapshotRouter } from './routes/wealthSnapshotRoutes.js';
import { wealthAnalyticsRouter } from './routes/wealthAnalyticsRoutes.js';
import { reportRouter } from './routes/reportRoutes.js';
import adminDashboardRoutes from './routes/adminDashboardRoutes.js';
import adminUserRoutes from './routes/adminUserRoutes.js';
import adminChallengeRoutes from './routes/adminChallengeRoutes.js';
import adminAuditLogRoutes from './routes/adminAuditLogRoutes.js';
import adminSystemHealthRoutes from './routes/adminSystemHealthRoutes.js';
import { financialConnectionRouter, financialAccountRouter } from './routes/financialConnectionRoutes.js';

const app = express();

app.set('trust proxy', env.TRUST_PROXY);

app.disable('x-powered-by');

app.use(requestIdMiddleware);
app.use(requestLogger);

app.use(helmet(securityHeaderOptions));

app.use(cors({
  origin: [env.CLIENT_URL],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // Cache the preflight result in the browser so a burst of authenticated
  // calls costs one OPTIONS round trip instead of one per request. OPTIONS
  // still consumes the rate-limit budget, so keeping preflights rare matters.
  maxAge: 600,
}));

// Explicit rather than implicit: the body must stay bounded even if the
// dependency's default ever changes. 100kb is body-parser's default and is
// far more than the largest legitimate payload here (a 100-row bulk
// recategorization request).
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

app.use(morgan(env.isDevelopment ? 'dev' : 'combined'));

// Financial payloads must never be cached. Mounted before the routers so a
// handler can still override it (reports and the MFA code page send their own
// `no-store`).
app.use(noStoreApiResponses);

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', apiRateLimit);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/transaction-category-rules', transactionCategoryRuleRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/recurring-transactions', recurringTransactionRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/habits', habitRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/assets', assetRouter);
app.use('/api/liabilities', liabilityRouter);
app.use('/api/assets-liabilities', summaryRouter);
app.use('/api/wealth-snapshots', wealthSnapshotRouter);
app.use('/api/wealth-analytics', wealthAnalyticsRouter);
app.use('/api/reports', reportRouter);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/financial-connections', financialConnectionRouter);
app.use('/api/financial-accounts', financialAccountRouter);
app.use('/api/admin', adminDashboardRoutes);
app.use('/api/admin', adminUserRoutes);
app.use('/api/admin', adminChallengeRoutes);
app.use('/api/admin', adminAuditLogRoutes);
app.use('/api/admin', adminSystemHealthRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;