import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecurringTransactions } from './RecurringTransactions';
import { recurringTransactionApi } from '../services/recurringTransactionApi';
import { getCategories } from '../services/categoryApi';
import { getMyProfile } from '../services/userApi';
import type {
  RecurringTransaction,
  RecurringTransactionListResponse,
} from '../types/recurringTransaction';

vi.mock('../services/recurringTransactionApi', () => ({
  recurringTransactionApi: {
    getRecurringTransactions: vi.fn(),
    getRecurringTransaction: vi.fn(),
    createRecurringTransaction: vi.fn(),
    updateRecurringTransaction: vi.fn(),
    deleteRecurringTransaction: vi.fn(),
    generateOccurrences: vi.fn(),
  },
}));

vi.mock('../services/categoryApi', () => ({
  getCategories: vi.fn(),
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

const mockedRecurringApi = vi.mocked(recurringTransactionApi);
const mockedGetCategories = vi.mocked(getCategories);
const mockedGetMyProfile = vi.mocked(getMyProfile);

function makeRule(
  overrides: Partial<RecurringTransaction> = {}
): RecurringTransaction {
  return {
    id: 'rule-1',
    name: 'Salary',
    categoryId: 'cat-1',
    type: 'INCOME',
    amount: 5000,
    frequency: 'MONTHLY',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: null,
    nextOccurrenceDate: '2026-10-01T00:00:00.000Z',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    category: {
      id: 'cat-1',
      name: 'Salary',
      type: 'INCOME',
      icon: null,
      color: null,
      isDefault: false,
    },
    ...overrides,
  };
}

function listResponse(
  recurringTransactions: RecurringTransaction[]
): RecurringTransactionListResponse {
  return { recurringTransactions };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RecurringTransactions />
    </MemoryRouter>
  );
}

async function waitForRefreshIdle(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Refreshing...')).toBeNull();
  });
}

describe('RecurringTransactions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCategories.mockResolvedValue({ categories: [] });
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

  it('fetches recurring rules exactly once on initial render', async () => {
    mockedRecurringApi.getRecurringTransactions.mockResolvedValue(
      listResponse([makeRule()])
    );

    renderPage();

    expect(await screen.findByText('Salary')).toBeDefined();
    await waitForRefreshIdle();

    expect(mockedRecurringApi.getRecurringTransactions).toHaveBeenCalledTimes(1);
  });

  it('refetches exactly once after a confirmed delete', async () => {
    mockedRecurringApi.getRecurringTransactions.mockResolvedValue(
      listResponse([makeRule()])
    );
    mockedRecurringApi.deleteRecurringTransaction.mockResolvedValue({
      message: 'Recurring transaction deleted',
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Salary' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockedRecurringApi.deleteRecurringTransaction).toHaveBeenCalledWith('rule-1');
    });
    await waitForRefreshIdle();

    expect(mockedRecurringApi.getRecurringTransactions).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when no rules exist', async () => {
    mockedRecurringApi.getRecurringTransactions.mockResolvedValue(listResponse([]));

    renderPage();

    expect(await screen.findByText('No recurring transactions')).toBeDefined();
  });

  it('retries the initial request exactly once after a failure', async () => {
    mockedRecurringApi.getRecurringTransactions
      .mockRejectedValueOnce(new Error('Recurring service unavailable'))
      .mockResolvedValue(listResponse([makeRule()]));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Recurring service unavailable'
    );
    await waitForRefreshIdle();
    expect(mockedRecurringApi.getRecurringTransactions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Salary')).toBeDefined();
    await waitForRefreshIdle();

    expect(mockedRecurringApi.getRecurringTransactions).toHaveBeenCalledTimes(2);
  });
});
