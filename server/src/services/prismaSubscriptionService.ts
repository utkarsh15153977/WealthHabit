import { Category, Prisma, Subscription } from '@prisma/client';
import {
  CreateSubscriptionInput,
  ListSubscriptionsQuery,
  UpdateSubscriptionInput,
} from '../schemas/subscriptionSchemas.js';
import { prisma } from '../config/prisma.js';
import { monthBounds } from '../utils/date.js';
import { advanceObligation } from '../utils/recurrence.js';

export type SubscriptionWithCategory = Subscription & {
  category: Category | null;
};

export async function createSubscription(
  userId: string,
  input: CreateSubscriptionInput
): Promise<SubscriptionWithCategory> {
  return prisma.subscription.create({
    data: {
      userId,
      categoryId: input.categoryId ?? null,
      name: input.name,
      amount: input.amount,
      billingCycle: input.billingCycle,
      nextRenewalDate: input.nextRenewalDate,
      status: input.status ?? 'ACTIVE',
    },
    include: { category: true },
  });
}

export async function listUserSubscriptions(
  userId: string,
  query?: ListSubscriptionsQuery
): Promise<SubscriptionWithCategory[]> {
  const where: Prisma.SubscriptionWhereInput = { userId };

  if (query?.status) {
    where.status = query.status;
  }

  if (query?.active === 'true') {
    where.status = 'ACTIVE';
  } else if (query?.active === 'false') {
    where.status = { not: 'ACTIVE' };
  }

  if (query?.month) {
    const { start, end } = monthBounds(query.month);
    where.nextRenewalDate = { gte: start, lt: end };
  }

  return prisma.subscription.findMany({
    where,
    include: { category: true },
    orderBy: { nextRenewalDate: 'asc' },
  });
}

export async function findUserSubscription(
  id: string,
  userId: string
): Promise<SubscriptionWithCategory | null> {
  return prisma.subscription.findFirst({
    where: { id, userId },
    include: { category: true },
  });
}

export async function updateSubscription(
  existing: SubscriptionWithCategory,
  input: UpdateSubscriptionInput
): Promise<SubscriptionWithCategory> {
  const data: Prisma.SubscriptionUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.categoryId !== undefined) {
    if (input.categoryId === null) {
      data.category = { disconnect: true };
    } else {
      data.category = { connect: { id: input.categoryId } };
    }
  }
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.billingCycle !== undefined) data.billingCycle = input.billingCycle;
  if (input.nextRenewalDate !== undefined) data.nextRenewalDate = input.nextRenewalDate;
  if (input.status !== undefined) data.status = input.status;

  return prisma.subscription.update({
    where: { id: existing.id },
    data,
    include: { category: true },
  });
}

/**
 * Rolls the renewal forward one billing cycle on the signup-anchored schedule
 * (anchor = createdAt day/month). Advancing the obligation never creates a
 * transaction.
 */
export async function advanceSubscriptionRenewal(
  existing: SubscriptionWithCategory
): Promise<SubscriptionWithCategory> {
  const nextRenewalDate = advanceObligation(
    existing.createdAt,
    existing.nextRenewalDate,
    existing.billingCycle
  );

  return prisma.subscription.update({
    where: { id: existing.id },
    data: { nextRenewalDate },
    include: { category: true },
  });
}

export async function deleteSubscription(id: string): Promise<void> {
  await prisma.subscription.delete({
    where: { id },
  });
}
