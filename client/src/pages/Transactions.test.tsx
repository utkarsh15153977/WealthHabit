import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Transactions } from './Transactions';
import {
  createTransaction,
  deleteTransaction,
  getTransactions,
  updateTransaction,
} from '../services/transactionApi';
import { getCategories } from '../services/categoryApi';
import { getMyProfile } from '../services/userApi';
import type { Transaction, TransactionListResponse } from '../types/transaction';
import type { Category } from '../types/category';

vi.mock('../services/transactionApi', () => ({
  createTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  getTransactions: vi.fn(),
  updateTransaction: vi.fn(),
}));

vi.mock('../services/categoryApi', () => ({
  getCategories: vi.fn(),
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

const mockedGetTransactions = vi.mocked(getTransactions);
const mockedCreateTransaction = vi.mocked(createTransaction);
const mockedUpdateTransaction = vi.mocked(updateTransaction);
const mockedDeleteTransaction = vi.mocked(deleteTransaction);
const mockedGetCategories = vi.mocked(getCategories);
const mockedGetMyProfile = vi.mocked(getMyProfile);

const expenseCategory: Category = {
  id: 'cat-1',
  name: 'Food',
  type: 'EXPENSE',
  icon: null,
  color: null,
  isDefault: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    categoryId: 'cat-1',
    type: 'EXPENSE',
    amount: 25.5,
    description: 'Groceries',
    transactionDate: '2026-09-20T00:00:00.000Z',
    paymentMethod: 'Card',
    notes: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    category: {
      id: 'cat-1',
      name: 'Food',
      type: 'EXPENSE',
      icon: null,
      color: null,
      isDefault: true,
    },
    // Exact shape of the real `GET /api/transactions` DTO since Phase 6I.
    source: 'MANUAL',
    merchant: null,
    paymentChannel: null,
    financialAccountId: null,
    financialAccount: null,
    ...overrides,
  };
}

function listResponse(
  transactions: Transaction[],
  overrides: Partial<TransactionListResponse['pagination']> = {}
): TransactionListResponse {
  return {
    transactions,
    pagination: {
      page: 1,
      limit: 20,
      total: transactions.length,
      totalPages: transactions.length > 0 ? 1 : 0,
      ...overrides,
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Transactions />
    </MemoryRouter>
  );
}

async function waitForFetchIdle(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Updating...')).toBeNull();
  });
}

describe('Transactions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCategories.mockResolvedValue({ categories: [expenseCategory] });
    mockedGetMyProfile.mockResolvedValue({
      profile: {
        id: 'u1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'USER',
        status: 'ACTIVE',
        financialProfile: {
          currency: 'USD',
          monthlyIncomeTarget: null,
          monthlySavingsTarget: null,
        },
      },
    });
  });

  it('fetches the first page on mount with the default page size', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([makeTransaction()]));

    renderPage();

    expect(await screen.findAllByText('Groceries')).not.toHaveLength(0);
    await waitForFetchIdle();

    expect(mockedGetTransactions).toHaveBeenCalledTimes(1);
    expect(mockedGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, type: undefined })
    );
  });

  it('renders the Manual source label for a manual transaction with null metadata', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([makeTransaction()]));

    renderPage();

    expect(await screen.findAllByText('Groceries')).not.toHaveLength(0);
    expect(screen.getByTestId('transaction-source-tx-1')).toHaveTextContent('Manual');
    expect(screen.queryByText(/Everyday Checking/)).toBeNull();
  });

  it('still renders rows when the optional metadata fields are absent', async () => {
    mockedGetTransactions.mockResolvedValue(
      listResponse([
        makeTransaction({
          source: undefined,
          merchant: undefined,
          paymentChannel: undefined,
          financialAccountId: undefined,
          financialAccount: undefined,
        }),
      ])
    );

    renderPage();

    expect(await screen.findAllByText('Groceries')).not.toHaveLength(0);
    expect(screen.queryByTestId('transaction-source-tx-1')).toBeNull();
    expect(screen.queryByText(/Everyday Checking/)).toBeNull();
  });

  it('renders imported transaction metadata including source, merchant and account', async () => {
    mockedGetTransactions.mockResolvedValue(
      listResponse([
        makeTransaction({
          id: 'tx-imp',
          description: 'LATTE',
          merchant: 'Blue Bottle',
          source: 'IMPORTED',
          paymentChannel: 'CARD',
          financialAccountId: 'acc-1',
          financialAccount: {
            id: 'acc-1',
            name: 'Everyday Checking',
            mask: '1234',
            type: 'CURRENT',
            currency: 'USD',
            institutionName: 'Demo Bank',
          },
        }),
      ])
    );

    renderPage();

    expect(await screen.findAllByText('Blue Bottle')).not.toHaveLength(0);
    expect(screen.getAllByText('LATTE')).not.toHaveLength(0);
    expect(screen.getByTestId('transaction-source-tx-imp')).toHaveTextContent('Imported');

    const accountLines = screen.getAllByText(/Everyday Checking/);
    expect(accountLines[0]).toHaveTextContent('1234');
    expect(accountLines[0]).toHaveTextContent('Card');
  });

  it('links to financial connections and imported transactions', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([makeTransaction()]));

    renderPage();

    await screen.findAllByText('Groceries');

    expect(
      screen.getByRole('link', { name: /Financial Connections/i })
    ).toHaveAttribute('href', '/financial-connections');
    expect(
      screen.getByRole('link', { name: /Imported Transactions/i })
    ).toHaveAttribute('href', '/transactions/imported');
  });

  it('creates a transaction and refreshes the list', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([makeTransaction()]));
    mockedCreateTransaction.mockResolvedValue({ transaction: makeTransaction() });

    renderPage();

    await screen.findAllByText('Groceries');

    fireEvent.click(screen.getByRole('button', { name: 'Add Transaction' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Amount'), {
      target: { value: '12.50' },
    });
    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: 'cat-1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => {
      expect(mockedCreateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'EXPENSE',
          amount: '12.50',
          categoryId: 'cat-1',
        })
      );
    });
    expect(await screen.findByText('Transaction added successfully')).toBeDefined();
  });

  it('edits an existing transaction', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([makeTransaction()]));
    mockedUpdateTransaction.mockResolvedValue({ transaction: makeTransaction() });

    renderPage();

    await screen.findAllByText('Groceries');

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Edit transaction Groceries' })[0]
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Edit Transaction')).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('Amount'), {
      target: { value: '99' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockedUpdateTransaction).toHaveBeenCalledWith(
        'tx-1',
        expect.objectContaining({ amount: '99' })
      );
    });
  });

  it('deletes a transaction after confirmation', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([makeTransaction()]));
    mockedDeleteTransaction.mockResolvedValue({ message: 'ok' });

    renderPage();

    await screen.findAllByText('Groceries');

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete transaction Groceries' })[0]
    );

    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockedDeleteTransaction).toHaveBeenCalledWith('tx-1');
    });
    expect(await screen.findByText('Transaction deleted successfully')).toBeDefined();
  });

  it('requests the API when the type filter changes', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([makeTransaction()]));

    renderPage();

    await screen.findAllByText('Groceries');
    await waitForFetchIdle();

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'INCOME' } });

    await waitFor(() => {
      expect(mockedGetTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'INCOME', page: 1 })
      );
    });
  });

  it('paginates to the next page', async () => {
    mockedGetTransactions.mockResolvedValue(
      listResponse([makeTransaction()], { page: 1, total: 21, totalPages: 2 })
    );

    renderPage();

    await screen.findAllByText('Groceries');
    await waitForFetchIdle();

    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(mockedGetTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      );
    });
  });

  it('shows an empty state when there are no transactions', async () => {
    mockedGetTransactions.mockResolvedValue(listResponse([]));

    renderPage();

    expect(await screen.findByText('No transactions yet')).toBeDefined();
  });

  it('shows an inline error and retries the request', async () => {
    mockedGetTransactions
      .mockRejectedValueOnce(new Error('Transactions unavailable'))
      .mockResolvedValue(listResponse([makeTransaction()]));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Transactions unavailable');

    fireEvent.click(within(alert).getByRole('button', { name: /Retry/i }));

    expect(await screen.findAllByText('Groceries')).not.toHaveLength(0);
  });
});
