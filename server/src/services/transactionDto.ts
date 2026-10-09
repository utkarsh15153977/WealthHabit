import type { Prisma, Transaction, Category, FinancialAccount } from '@prisma/client';
import type {
  ImportedTransactionAccountSummary,
  TransactionCategorySummary,
  TransactionData,
} from '../types/transaction.js';

/**
 * Display-only projection of the financial account linked to a transaction.
 * `userId` is selected purely so the serializer can prove the account belongs
 * to the transaction owner before any account data leaves the server; it is
 * never serialised. No number, token, consent or provider secret is selected.
 */
export const transactionAccountSummarySelect = {
  id: true,
  name: true,
  mask: true,
  type: true,
  currency: true,
  institutionName: true,
  userId: true,
} satisfies Prisma.FinancialAccountSelect;

/**
 * Single source of truth for the relations a transaction DTO needs. Reusing it
 * for every query keeps list, detail, create, update and dashboard responses
 * byte-identical and avoids an N+1 lookup per row.
 */
export const transactionInclude = {
  category: true,
  financialAccount: { select: transactionAccountSummarySelect },
} satisfies Prisma.TransactionInclude;

export interface TransactionAccountSummaryRecord {
  id: string;
  name: string;
  mask: string | null;
  type: FinancialAccount['type'];
  currency: string;
  institutionName: string | null;
  userId: string;
}

export type TransactionWithCategory = Transaction & {
  category: Category;
  financialAccount: TransactionAccountSummaryRecord | null;
};

export function toCategorySummary(category: {
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

function toAccountSummary(
  account: TransactionAccountSummaryRecord
): ImportedTransactionAccountSummary {
  return {
    id: account.id,
    name: account.name,
    mask: account.mask,
    type: account.type,
    currency: account.currency,
    institutionName: account.institutionName,
  };
}

/**
 * Builds the transaction DTO used by the list, detail, create and update
 * endpoints as well as the dashboard summary.
 *
 * The linked account is only exposed when it demonstrably belongs to the
 * transaction owner. A cross-user link - unreachable through the API, but
 * guarded here as defence in depth - yields null instead of leaking another
 * user's account, and its id is scrubbed with it.
 */
export function toTransactionData(tx: TransactionWithCategory): TransactionData {
  const ownedAccount =
    tx.financialAccount !== null && tx.financialAccount.userId === tx.userId
      ? tx.financialAccount
      : null;

  return {
    id: tx.id,
    categoryId: tx.categoryId,
    type: tx.type,
    amount: Number(tx.amount),
    description: tx.description,
    transactionDate: tx.transactionDate,
    paymentMethod: tx.paymentMethod,
    notes: tx.notes,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    category: toCategorySummary(tx.category),
    source: tx.source,
    merchant: tx.merchant,
    paymentChannel: tx.paymentChannel,
    financialAccountId: ownedAccount ? tx.financialAccountId : null,
    financialAccount: ownedAccount ? toAccountSummary(ownedAccount) : null,
  };
}
