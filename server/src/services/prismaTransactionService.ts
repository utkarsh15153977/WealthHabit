import {
  Prisma,
  Transaction,
  Category,
  CategoryType,
  TransactionType,
  TransactionSource,
  FinancialAccount,
} from '@prisma/client';
import {
  CreateTransactionInput,
  UpdateTransactionInput,
  ListTransactionsQuery,
  ListImportedTransactionsQuery,
} from '../schemas/transactionSchemas.js';
import { prisma } from '../config/prisma.js';
import { addUtcDays, startOfUtcDay } from '../utils/date.js';
import { transactionInclude } from './transactionDto.js';
import type { TransactionWithCategory } from './transactionDto.js';

export type { TransactionWithCategory };

export type ImportedTransactionRecord = Transaction & {
  category: Category;
  financialAccount: FinancialAccount | null;
};

const importedTransactionInclude = {
  category: true,
  financialAccount: true,
} satisfies Prisma.TransactionInclude;

/**
 * Defence-in-depth pagination bounds, mirroring `MAX_LIST_PAGE_SIZE` in the
 * budget/asset/liability/goal/snapshot services. The request schemas already
 * cap `limit` at 100, so this never changes a validated request — it exists so
 * that a future route or internal caller that reaches `listUserTransactions`
 * without going through `validate()` still cannot ask for an unbounded page.
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_LIST_PAGE_SIZE = 100;

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
    include: transactionInclude,
  });
}

export async function listUserTransactions(
  userId: string,
  query: ListTransactionsQuery
): Promise<{ transactions: TransactionWithCategory[]; total: number; page: number; limit: number }> {
  const page = query?.page ?? 1;
  const limit = Math.min(query?.limit ?? DEFAULT_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
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
      include: transactionInclude,
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { transactions, total, page, limit };
}

export async function findUserTransaction(
  id: string,
  userId: string
): Promise<TransactionWithCategory | null> {
  return prisma.transaction.findFirst({
    where: { id, userId },
    include: transactionInclude,
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
    include: transactionInclude,
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

export async function findUserTransactionForReview(
  id: string,
  userId: string
): Promise<ImportedTransactionRecord | null> {
  return prisma.transaction.findFirst({
    where: { id, userId },
    include: importedTransactionInclude,
  });
}

export async function listUserImportedTransactions(
  userId: string,
  query: ListImportedTransactionsQuery
): Promise<{
  transactions: ImportedTransactionRecord[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = query?.page ?? 1;
  const limit = Math.min(query?.limit ?? DEFAULT_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
  const skip = (page - 1) * limit;

  const and: Prisma.TransactionWhereInput[] = [
    { userId, source: TransactionSource.IMPORTED },
  ];
  if (query?.type) {
    and.push({ type: query.type });
  }
  if (query?.categoryId) {
    and.push({ categoryId: query.categoryId });
  }
  if (query?.financialAccountId) {
    and.push({ financialAccountId: query.financialAccountId });
  }
  if (query?.dateFrom || query?.dateTo) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.dateFrom) dateFilter.gte = startOfUtcDay(query.dateFrom);
    if (query.dateTo) dateFilter.lt = addUtcDays(query.dateTo, 1);
    and.push({ transactionDate: dateFilter });
  }

  const where: Prisma.TransactionWhereInput = { AND: and };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: importedTransactionInclude,
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { transactions, total, page, limit };
}

/**
 * Detaches an imported transaction from its financial account. The provider
 * id and dedup key are kept so a later sync still recognises the row and does
 * not import a duplicate. Running this twice is a no-op, not an error.
 */
export async function unlinkImportedTransaction(
  id: string
): Promise<ImportedTransactionRecord> {
  return prisma.transaction.update({
    where: { id },
    data: { financialAccountId: null },
    include: importedTransactionInclude,
  });
}

/**
 * Hands an imported transaction over to the user: it becomes a normal manual
 * transaction. Only `source` changes - the account link, provider id, dedup
 * key, merchant and importedAt are kept as history, and the provider id keeps
 * acting as the dedup identity so a later sync never imports the same provider
 * row next to the converted one.
 */
export async function convertImportedTransactionToManual(
  id: string
): Promise<ImportedTransactionRecord> {
  return prisma.transaction.update({
    where: { id },
    data: { source: TransactionSource.MANUAL },
    include: importedTransactionInclude,
  });
}

export async function recategorizeImportedTransaction(
  id: string,
  categoryId: string
): Promise<ImportedTransactionRecord> {
  return prisma.transaction.update({
    where: { id },
    data: { categoryId },
    include: importedTransactionInclude,
  });
}

export type { CategoryType, TransactionType };
