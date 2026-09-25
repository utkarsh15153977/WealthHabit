import { Notification, NotificationType, Prisma } from '@prisma/client';
import { ListNotificationsQuery } from '../schemas/notificationSchemas.js';
import { prisma } from '../config/prisma.js';
import {
  addUtcDays,
  currentUtcMonth,
  monthBounds,
  startOfUtcDay,
} from '../utils/date.js';
import { getBudgetProgress, BudgetWithCategories } from './prismaBudgetService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BUDGET_WARNING_THRESHOLD = 80;
const BUDGET_CRITICAL_THRESHOLD = 100;
const UPCOMING_WINDOW_DAYS = 3;
const RECURRING_WINDOW_DAYS = 1;

interface NotificationCandidate {
  type: NotificationType;
  title: string;
  message: string;
  dedupKey: string;
  metadata: Prisma.InputJsonValue;
}

function dayKey(value: Date): string {
  return startOfUtcDay(value).toISOString();
}

function daysUntil(value: Date, today: Date): number {
  return Math.round((startOfUtcDay(value).getTime() - today.getTime()) / MS_PER_DAY);
}

function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

async function collectBudgetCandidates(
  userId: string,
  monthKey: string
): Promise<NotificationCandidate[]> {
  const { start, end } = monthBounds(monthKey);
  const budgets = await prisma.budget.findMany({
    where: { userId, month: { gte: start, lt: end } },
    include: {
      budgetCategories: {
        include: { category: true },
      },
    },
  });

  const candidates: NotificationCandidate[] = [];

  for (const budget of budgets as BudgetWithCategories[]) {
    const progress = await getBudgetProgress(budget);

    let threshold: number | null = null;
    if (progress.percentageUsed >= BUDGET_CRITICAL_THRESHOLD) {
      threshold = BUDGET_CRITICAL_THRESHOLD;
    } else if (progress.percentageUsed >= BUDGET_WARNING_THRESHOLD) {
      threshold = BUDGET_WARNING_THRESHOLD;
    }

    if (threshold === null) continue;

    candidates.push({
      type: NotificationType.BUDGET_THRESHOLD,
      title: `${budget.name} budget reached ${threshold}%`,
      message: `Your ${budget.name} budget has reached ${threshold}% of its monthly limit.`,
      dedupKey: `budget:${budget.id}:${monthKey}:pct${threshold}`,
      metadata: {
        budgetId: budget.id,
        threshold,
        percentageUsed: progress.percentageUsed,
      },
    });
  }

  return candidates;
}

async function collectBillCandidates(
  userId: string,
  today: Date
): Promise<NotificationCandidate[]> {
  const bills = await prisma.bill.findMany({
    where: {
      userId,
      nextDueDate: { lt: addUtcDays(today, UPCOMING_WINDOW_DAYS + 1) },
    },
  });

  const candidates: NotificationCandidate[] = [];

  for (const bill of bills) {
    const due = daysUntil(bill.nextDueDate, today);

    if (due < 0) {
      if (bill.status === 'PENDING' || bill.status === 'OVERDUE') {
        candidates.push({
          type: NotificationType.BILL_OVERDUE,
          title: `${bill.name} bill overdue`,
          message: `Your ${bill.name} bill is overdue.`,
          dedupKey: `bill:${bill.id}:${dayKey(bill.nextDueDate)}:overdue`,
          metadata: { billId: bill.id, daysUntilDue: due },
        });
      }
      continue;
    }

    if (bill.status === 'CANCELLED') continue;

    const when = due === 0 ? 'due today' : `due ${relativeDays(due)}`;
    candidates.push({
      type: NotificationType.BILL_UPCOMING,
      title: `${bill.name} bill ${when}`,
      message: `Your ${bill.name} bill is ${when}.`,
      dedupKey: `bill:${bill.id}:${dayKey(bill.nextDueDate)}:upcoming`,
      metadata: { billId: bill.id, daysUntilDue: due },
    });
  }

  return candidates;
}

async function collectSubscriptionCandidates(
  userId: string,
  today: Date
): Promise<NotificationCandidate[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      nextRenewalDate: { lt: addUtcDays(today, UPCOMING_WINDOW_DAYS + 1) },
    },
  });

  const candidates: NotificationCandidate[] = [];

  for (const subscription of subscriptions) {
    const due = daysUntil(subscription.nextRenewalDate, today);
    if (due < 0) continue;

    const when = due === 0 ? 'renews today' : `renews ${relativeDays(due)}`;
    candidates.push({
      type: NotificationType.SUBSCRIPTION_UPCOMING,
      title: `${subscription.name} subscription ${when}`,
      message: `Your ${subscription.name} subscription ${when}.`,
      dedupKey: `subscription:${subscription.id}:${dayKey(subscription.nextRenewalDate)}:upcoming`,
      metadata: { subscriptionId: subscription.id, daysUntilRenewal: due },
    });
  }

  return candidates;
}

async function collectRecurringCandidates(
  userId: string,
  today: Date
): Promise<NotificationCandidate[]> {
  const recurring = await prisma.recurringTransaction.findMany({
    where: {
      userId,
      isActive: true,
      nextOccurrenceDate: { lt: addUtcDays(today, RECURRING_WINDOW_DAYS + 1) },
    },
  });

  const candidates: NotificationCandidate[] = [];

  for (const transaction of recurring) {
    const due = daysUntil(transaction.nextOccurrenceDate, today);
    if (due < 0) continue;

    const when = due === 0 ? 'due today' : `due ${relativeDays(due)}`;
    candidates.push({
      type: NotificationType.RECURRING_TRANSACTION_UPCOMING,
      title: `${transaction.name} ${when}`,
      message: `Your recurring transaction ${transaction.name} is ${when}.`,
      dedupKey: `recurring:${transaction.id}:${dayKey(transaction.nextOccurrenceDate)}:upcoming`,
      metadata: {
        recurringTransactionId: transaction.id,
        daysUntilOccurrence: due,
      },
    });
  }

  return candidates;
}

export async function generateNotificationsForUser(userId: string): Promise<number> {
  const today = startOfUtcDay(new Date());
  const monthKey = currentUtcMonth();

  const candidates: NotificationCandidate[] = [
    ...(await collectBudgetCandidates(userId, monthKey)),
    ...(await collectBillCandidates(userId, today)),
    ...(await collectSubscriptionCandidates(userId, today)),
    ...(await collectRecurringCandidates(userId, today)),
  ];

  if (candidates.length === 0) {
    return 0;
  }

  const result = await prisma.notification.createMany({
    data: candidates.map((candidate) => ({
      userId,
      type: candidate.type,
      title: candidate.title,
      message: candidate.message,
      dedupKey: candidate.dedupKey,
      metadata: candidate.metadata,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

export interface NotificationListResult {
  items: Notification[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}

export async function listUserNotifications(
  userId: string,
  query?: ListNotificationsQuery
): Promise<NotificationListResult> {
  const page = query?.page ?? 1;
  const pageSize = query?.pageSize ?? 20;

  const where: Prisma.NotificationWhereInput = { userId };
  if (query?.unreadOnly === 'true') {
    where.isRead = false;
  }

  const [items, total, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { items, page, pageSize, total, unreadCount };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

export async function findUserNotification(
  id: string,
  userId: string
): Promise<Notification | null> {
  return prisma.notification.findFirst({ where: { id, userId } });
}

export async function markNotificationRead(
  notification: Notification
): Promise<Notification> {
  if (notification.isRead) {
    return notification;
  }

  return prisma.notification.update({
    where: { id: notification.id },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  return result.count;
}

export async function deleteNotification(id: string): Promise<void> {
  await prisma.notification.delete({ where: { id } });
}

export function toNotificationData(notification: Notification): {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
  metadata: Record<string, unknown> | null;
} {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
    readAt: notification.readAt,
    metadata:
      notification.metadata === null
        ? null
        : (notification.metadata as Record<string, unknown>),
  };
}
