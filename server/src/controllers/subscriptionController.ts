import { Response } from 'express';
import { CategoryType } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateSubscriptionInput,
  ListSubscriptionsQuery,
  UpdateSubscriptionInput,
} from '../schemas/subscriptionSchemas.js';
import {
  advanceSubscriptionRenewal,
  createSubscription,
  deleteSubscription,
  findUserSubscription,
  listUserSubscriptions,
  updateSubscription,
} from '../services/prismaSubscriptionService.js';
import { findUsableCategory } from '../services/prismaTransactionService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { startOfUtcDay } from '../utils/date.js';
import { subscriptionDueState } from '../utils/dueState.js';
import {
  SubscriptionData,
  SubscriptionListData,
} from '../types/subscription.js';
import { TransactionCategorySummary } from '../types/transaction.js';

function toCategorySummary(category: {
  id: string;
  name: string;
  type: TransactionCategorySummary['type'];
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}): TransactionCategorySummary {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    isDefault: category.isDefault,
  };
}

function toSubscriptionData(
  subscription: {
    id: string;
    name: string;
    categoryId: string | null;
    amount: unknown;
    billingCycle: SubscriptionData['billingCycle'];
    nextRenewalDate: Date;
    status: SubscriptionData['status'];
    createdAt: Date;
    updatedAt: Date;
    category: Parameters<typeof toCategorySummary>[0] | null;
  },
  today: Date
): SubscriptionData {
  return {
    id: subscription.id,
    name: subscription.name,
    categoryId: subscription.categoryId,
    category: subscription.category ? toCategorySummary(subscription.category) : null,
    amount: Number(subscription.amount),
    billingCycle: subscription.billingCycle,
    nextRenewalDate: subscription.nextRenewalDate,
    status: subscription.status,
    dueState: subscriptionDueState(subscription.status, subscription.nextRenewalDate, today),
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

async function assertExpenseCategory(categoryId: string, userId: string): Promise<void> {
  const category = await findUsableCategory(categoryId, userId);
  if (!category) {
    throw new AppError(
      'Category not found',
      404,
      undefined,
      ApiErrorCodes.CATEGORY_NOT_FOUND
    );
  }
  if (category.type !== CategoryType.EXPENSE) {
    throw new AppError(
      'Subscription category must be an expense category',
      400,
      { 'body.categoryId': ['Subscription category must be an expense category'] },
      ApiErrorCodes.VALIDATION_ERROR
    );
  }
}

export async function createSubscriptionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateSubscriptionInput;

  if (input.categoryId) {
    await assertExpenseCategory(input.categoryId, userId);
  }

  const subscription = await createSubscription(userId, input);
  const today = startOfUtcDay(new Date());

  res.status(201).json({
    success: true,
    data: { subscription: toSubscriptionData(subscription, today) },
  });
}

export async function listSubscriptionsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListSubscriptionsQuery;

  const subscriptions = await listUserSubscriptions(userId, query);
  const today = startOfUtcDay(new Date());

  const data: SubscriptionListData = {
    subscriptions: subscriptions.map((subscription) =>
      toSubscriptionData(subscription, today)
    ),
  };

  res.json({
    success: true,
    data,
  });
}

export async function getSubscriptionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const subscription = await findUserSubscription(id, userId);
  if (!subscription) {
    throw new AppError(
      'Subscription not found',
      404,
      undefined,
      ApiErrorCodes.SUBSCRIPTION_NOT_FOUND
    );
  }

  const today = startOfUtcDay(new Date());
  res.json({
    success: true,
    data: { subscription: toSubscriptionData(subscription, today) },
  });
}

export async function updateSubscriptionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateSubscriptionInput;

  const existing = await findUserSubscription(id, userId);
  if (!existing) {
    throw new AppError(
      'Subscription not found',
      404,
      undefined,
      ApiErrorCodes.SUBSCRIPTION_NOT_FOUND
    );
  }

  if (input.categoryId) {
    await assertExpenseCategory(input.categoryId, userId);
  }

  const subscription = await updateSubscription(existing, input);
  const today = startOfUtcDay(new Date());

  res.json({
    success: true,
    data: { subscription: toSubscriptionData(subscription, today) },
  });
}

export async function renewSubscriptionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserSubscription(id, userId);
  if (!existing) {
    throw new AppError(
      'Subscription not found',
      404,
      undefined,
      ApiErrorCodes.SUBSCRIPTION_NOT_FOUND
    );
  }

  if (existing.status !== 'ACTIVE') {
    throw new AppError(
      'Only active subscriptions can be renewed',
      400,
      { 'params.id': ['Only active subscriptions can be renewed'] },
      ApiErrorCodes.VALIDATION_ERROR
    );
  }

  const subscription = await advanceSubscriptionRenewal(existing);
  const today = startOfUtcDay(new Date());

  res.json({
    success: true,
    data: { subscription: toSubscriptionData(subscription, today) },
  });
}

export async function deleteSubscriptionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserSubscription(id, userId);
  if (!existing) {
    throw new AppError(
      'Subscription not found',
      404,
      undefined,
      ApiErrorCodes.SUBSCRIPTION_NOT_FOUND
    );
  }

  await deleteSubscription(existing.id);

  res.json({
    success: true,
    data: { message: 'Subscription deleted' },
  });
}
