import { Response } from 'express';
import { CategoryType } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import { CreateBillInput, ListBillsQuery, UpdateBillInput } from '../schemas/billSchemas.js';
import {
  createBill,
  deleteBill,
  findUserBill,
  listUserBills,
  updateBill,
} from '../services/prismaBillService.js';
import { findUsableCategory } from '../services/prismaTransactionService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { startOfUtcDay } from '../utils/date.js';
import { billDueState } from '../utils/dueState.js';
import { BillData, BillListData } from '../types/bill.js';
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

function toBillData(
  bill: {
    id: string;
    name: string;
    categoryId: string | null;
    amount: unknown;
    frequency: BillData['frequency'];
    dueDate: Date;
    nextDueDate: Date;
    status: BillData['status'];
    autoPay: boolean;
    createdAt: Date;
    updatedAt: Date;
    category: Parameters<typeof toCategorySummary>[0] | null;
  },
  today: Date
): BillData {
  return {
    id: bill.id,
    name: bill.name,
    categoryId: bill.categoryId,
    category: bill.category ? toCategorySummary(bill.category) : null,
    amount: Number(bill.amount),
    frequency: bill.frequency,
    dueDate: bill.dueDate,
    nextDueDate: bill.nextDueDate,
    status: bill.status,
    dueState: billDueState(bill.status, bill.nextDueDate, today),
    autoPay: bill.autoPay,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
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
      'Bill category must be an expense category',
      400,
      { 'body.categoryId': ['Bill category must be an expense category'] },
      ApiErrorCodes.VALIDATION_ERROR
    );
  }
}

export async function createBillHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateBillInput;

  if (input.categoryId) {
    await assertExpenseCategory(input.categoryId, userId);
  }

  const bill = await createBill(userId, input);
  const today = startOfUtcDay(new Date());

  res.status(201).json({
    success: true,
    data: { bill: toBillData(bill, today) },
  });
}

export async function listBillsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListBillsQuery;

  const bills = await listUserBills(userId, query);
  const today = startOfUtcDay(new Date());

  const data: BillListData = {
    bills: bills.map((bill) => toBillData(bill, today)),
  };

  res.json({
    success: true,
    data,
  });
}

export async function getBillHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const bill = await findUserBill(id, userId);
  if (!bill) {
    throw new AppError('Bill not found', 404, undefined, ApiErrorCodes.BILL_NOT_FOUND);
  }

  const today = startOfUtcDay(new Date());
  res.json({
    success: true,
    data: { bill: toBillData(bill, today) },
  });
}

export async function updateBillHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateBillInput;

  const existing = await findUserBill(id, userId);
  if (!existing) {
    throw new AppError('Bill not found', 404, undefined, ApiErrorCodes.BILL_NOT_FOUND);
  }

  if (input.categoryId) {
    await assertExpenseCategory(input.categoryId, userId);
  }

  const bill = await updateBill(existing, input);
  const today = startOfUtcDay(new Date());

  res.json({
    success: true,
    data: { bill: toBillData(bill, today) },
  });
}

export async function deleteBillHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserBill(id, userId);
  if (!existing) {
    throw new AppError('Bill not found', 404, undefined, ApiErrorCodes.BILL_NOT_FOUND);
  }

  await deleteBill(existing.id);

  res.json({
    success: true,
    data: { message: 'Bill deleted' },
  });
}
