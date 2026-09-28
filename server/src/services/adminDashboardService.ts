import { AccountStatus, Role } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type {
  AdminDashboardData,
  AdminUserMetrics,
  AdminFinancialRecordMetrics,
  AdminApplicationMetrics,
} from '../types/adminDashboard.js';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

const RECENT_REGISTRATION_DAYS = 30;

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const now = new Date();
  const recentCutoff = startOfUtcDay(addUtcDays(now, -RECENT_REGISTRATION_DAYS));

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    deactivatedUsers,
    adminUsers,
    recentlyRegisteredUsers,
    transactionCount,
    savingsGoalCount,
    assetCount,
    liabilityCount,
    wealthSnapshotCount,
    habitCount,
    challengeCount,
    notificationCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: AccountStatus.ACTIVE } }),
    prisma.user.count({ where: { status: AccountStatus.SUSPENDED } }),
    prisma.user.count({ where: { status: AccountStatus.DEACTIVATED } }),
    prisma.user.count({ where: { role: Role.ADMIN } }),
    prisma.user.count({
      where: {
        createdAt: { gte: recentCutoff },
      },
    }),
    prisma.transaction.count(),
    prisma.savingsGoal.count(),
    prisma.asset.count(),
    prisma.liability.count(),
    prisma.wealthSnapshot.count(),
    prisma.financialHabit.count(),
    prisma.challenge.count(),
    prisma.notification.count(),
  ]);

  const users: AdminUserMetrics = {
    total: totalUsers,
    active: activeUsers,
    suspended: suspendedUsers,
    deactivated: deactivatedUsers,
    admins: adminUsers,
    recentlyRegistered: recentlyRegisteredUsers,
  };

  const financialRecords: AdminFinancialRecordMetrics = {
    transactions: transactionCount,
    savingsGoals: savingsGoalCount,
    assets: assetCount,
    liabilities: liabilityCount,
    wealthSnapshots: wealthSnapshotCount,
  };

  const application: AdminApplicationMetrics = {
    habits: habitCount,
    challenges: challengeCount,
    notifications: notificationCount,
  };

  return {
    users,
    financialRecords,
    application,
    generatedAt: now.toISOString(),
  };
}