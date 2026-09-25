import { Prisma, Transaction, Category, CategoryType, TransactionType } from '@prisma/client';
import { CreateTransactionInput, UpdateTransactionInput, ListTransactionsQuery } from '../schemas/transactionSchemas.js';
import { prisma } from '../config/prisma.js';
import { addUtcDays, startOfUtcDay } from '../utils/date.js';

export type TransactionWithCategory = Transaction & {
  category: Category;
};

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput
): Promise<TransactionWithCategory> {
  return prisma.transaction.create({
    data: {
      userId,
      categoryId: input.categoryId,
      type: input.type,
      amount: input.amount,
      description: input.description ?? null,
      transactionDate: input.transactionDate,
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes ?? null,
    },
    include: { category: true },
  });
}

export async function listUserTransactions(
  userId: string,
  query: ListTransactionsQuery
): Promise<{ transactions: TransactionWithCategory[]; total: number; page: number; limit: number }> {
  const page = query?.page ?? 1;
  const limit = query?.limit ?? 20;
  const skip = (page - 1) * limit;

  const and: Prisma.TransactionWhereInput[] = [{ userId }];

  if (query?.type) {
    and.push({ type: query.type });
  }

  if (query?.categoryId) {
    and.push({ categoryId: query.categoryId });
  }

  if (query?.dateFrom || query?.dateTo) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.dateFrom) dateFilter.gte = startOfUtcDay(query.dateFrom);
    if (query.dateTo) dateFilter.lt = addUtcDays(query.dateTo, 1);
    and.push({ transactionDate: dateFilter });
  }

  if (query?.search) {
    and.push({
      OR: [
        { description: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.TransactionWhereInput = { AND: and };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { category: true },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { transactions, total, page, limit };
}

export async function findTransactionById(id: string): Promise<TransactionWithCategory | null> {
  return prisma.transaction.findUnique({
    where: { id },
    include: { category: true },
  });
}

export async function findUserTransaction(
  id: string,
  userId: string
): Promise<TransactionWithCategory | null> {
  return prisma.transaction.findFirst({
    where: { id, userId },
    include: { category: true },
  });
}

export async function updateTransaction(
  id: string,
  input: UpdateTransactionInput
): Promise<TransactionWithCategory> {
  const data: Prisma.TransactionUpdateInput = {};
  if (input.categoryId !== undefined) {
    data.category = { connect: { id: input.categoryId } };
  }
  if (input.type !== undefined) data.type = input.type;
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.description !== undefined) data.description = input.description;
  if (input.transactionDate !== undefined) data.transactionDate = input.transactionDate;
  if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
  if (input.notes !== undefined) data.notes = input.notes;

  return prisma.transaction.update({
    where: { id },
    data,
    include: { category: true },
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  await prisma.transaction.delete({
    where: { id },
  });
}

export async function findUsableCategory(
  categoryId: string,
  userId: string
): Promise<Category | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    return null;
  }

  if (category.userId === null) {
    return category;
  }

  if (category.userId === userId) {
    return category;
  }

  return null;
}

export type { CategoryType, TransactionType };
