import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/logger.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
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

const app = express();

app.use(helmet());

app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(morgan(env.isDevelopment ? 'dev' : 'combined'));
app.use(requestLogger);

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', apiRateLimit);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions', transactionRoutes);
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
app.use('/api/admin', adminDashboardRoutes);
app.use('/api/admin', adminUserRoutes);
app.use('/api/admin', adminChallengeRoutes);
app.use('/api/admin', adminAuditLogRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;