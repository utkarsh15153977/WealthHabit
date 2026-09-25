import { Bill, Category, Prisma } from '@prisma/client';
import { CreateBillInput, ListBillsQuery, UpdateBillInput } from '../schemas/billSchemas.js';
import { prisma } from '../config/prisma.js';
import { monthBounds } from '../utils/date.js';
import { advanceObligation } from '../utils/recurrence.js';

export type BillWithCategory = Bill & {
  category: Category | null;
};

export async function createBill(
  userId: string,
  input: CreateBillInput
): Promise<BillWithCategory> {
  return prisma.bill.create({
    data: {
      userId,
      categoryId: input.categoryId ?? null,
      name: input.name,
      amount: input.amount,
      frequency: input.frequency,
      dueDate: input.dueDate,
      nextDueDate: input.nextDueDate ?? input.dueDate,
      status: input.status ?? 'PENDING',
      autoPay: input.autoPay ?? false,
    },
    include: { category: true },
  });
}

export async function listUserBills(
  userId: string,
  query?: ListBillsQuery
): Promise<BillWithCategory[]> {
  const where: Prisma.BillWhereInput = { userId };

  if (query?.status) {
    where.status = query.status;
  }

  if (query?.active === 'true') {
    where.status = { not: 'CANCELLED' };
  } else if (query?.active === 'false') {
    where.status = 'CANCELLED';
  }

  if (query?.month) {
    const { start, end } = monthBounds(query.month);
    where.nextDueDate = { gte: start, lt: end };
  }

  return prisma.bill.findMany({
    where,
    include: { category: true },
    orderBy: { nextDueDate: 'asc' },
  });
}

export async function findUserBill(id: string, userId: string): Promise<BillWithCategory | null> {
  return prisma.bill.findFirst({
    where: { id, userId },
    include: { category: true },
  });
}

/**
 * nextDueDate rules (first match wins):
 * 1. explicit nextDueDate in the payload;
 * 2. status transitioning to PAID: advance one period on the anchor schedule
 *    (dueDate change in the same payload re-anchors first);
 * 3. dueDate changed: reset nextDueDate to the new dueDate;
 * 4. otherwise unchanged.
 */
export async function updateBill(
  existing: BillWithCategory,
  input: UpdateBillInput
): Promise<BillWithCategory> {
  const data: Prisma.BillUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.categoryId !== undefined) {
    if (input.categoryId === null) {
      data.category = { disconnect: true };
    } else {
      data.category = { connect: { id: input.categoryId } };
    }
  }
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.frequency !== undefined) data.frequency = input.frequency;
  if (input.status !== undefined) data.status = input.status;
  if (input.autoPay !== undefined) data.autoPay = input.autoPay;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate;

  if (input.nextDueDate !== undefined) {
    data.nextDueDate = input.nextDueDate;
  } else if (input.status === 'PAID' && existing.status !== 'PAID') {
    data.nextDueDate = advanceObligation(
      input.dueDate ?? existing.dueDate,
      existing.nextDueDate,
      input.frequency ?? existing.frequency
    );
  } else if (input.dueDate !== undefined) {
    data.nextDueDate = input.dueDate;
  }

  return prisma.bill.update({
    where: { id: existing.id },
    data,
    include: { category: true },
  });
}

export async function deleteBill(id: string): Promise<void> {
  await prisma.bill.delete({
    where: { id },
  });
}
