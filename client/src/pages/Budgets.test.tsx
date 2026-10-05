import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Budgets } from './Budgets';
import { budgetApi } from '../services/budgetApi';
import { getCategories } from '../services/categoryApi';
import { getMyProfile } from '../services/userApi';
import type { BudgetListResponse, BudgetWithProgress } from '../types/budget';

vi.mock('../services/budgetApi', () => ({
  budgetApi: {
    getBudgets: vi.fn(),
    getBudget: vi.fn(),
    getBudgetProgress: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
  },
}));

vi.mock('../services/categoryApi', () => ({
  getCategories: vi.fn(),
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

const mockedBudgetApi = vi.mocked(budgetApi);
const mockedGetCategories = vi.mocked(getCategories);
const mockedGetMyProfile = vi.mocked(getMyProfile);

function makeBudget(overrides: Partial<BudgetWithProgress> = {}): BudgetWithProgress {
  return {
    id: 'b1',
    userId: 'u1',
    name: 'Groceries',
    amount: 400,
    month: '2026-09',
    category: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: {
      budgetAmount: 400,
      spent: 120.5,
      remaining: 279.5,
      percentageUsed: 30.13,
      transactionCount: 3,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      category: null,
    },
    ...overrides,
  };
}

function listResponse(
  budgets: BudgetWithProgress[],
  total: number,
  page: number,
  pageSize = 20
): BudgetListResponse {
  return { budgets, page, pageSize, total };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Budgets />
    </MemoryRouter>
  );
}

async function waitForPagerSettled(): Promise<void> {
  await waitFor(() => {
    expect(mockedBudgetApi.getBudgets).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  });
  await waitFor(() => {
    expect(screen.queryByText('Refreshing budgets...')).toBeNull();
  });
}

async function waitForRefreshIdle(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Refreshing budgets...')).toBeNull();
  });
}

describe('Budgets page', () => {
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

  it('renders budget cards with their progress', async () => {
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([makeBudget()], 1, 1));

    renderPage();

    expect(await screen.findByText('Groceries')).toBeDefined();
    expect(screen.getByText('30.13%')).toBeDefined();
    expect(
      screen.getByRole('progressbar', { name: 'Groceries spending progress' })
    ).toBeDefined();
    expect(screen.getByText(/3 transactions in/)).toBeDefined();
  });

  it('requests the first page with the default page size', async () => {
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([makeBudget()], 1, 1));

    renderPage();

    await waitFor(() => {
      expect(mockedBudgetApi.getBudgets).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });
  });

  it('fetches budgets exactly once on initial render', async () => {
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([makeBudget()], 1, 1));

    renderPage();

    expect(await screen.findByText('Groceries')).toBeDefined();
    await waitForPagerSettled();

    expect(mockedBudgetApi.getBudgets).toHaveBeenCalledTimes(1);
    expect(mockedBudgetApi.getBudgets).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('requests page two exactly once when Next is clicked', async () => {
    mockedBudgetApi.getBudgets.mockImplementation(async (params) => {
      if (params?.page === 2) {
        return listResponse([makeBudget({ id: 'b2', name: 'Transport' })], 45, 2);
      }
      return listResponse([makeBudget()], 45, 1);
    });

    renderPage();

    expect(await screen.findByText('Groceries')).toBeDefined();
    await waitForPagerSettled();
    expect(mockedBudgetApi.getBudgets).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Transport')).toBeDefined();
    await waitForRefreshIdle();

    expect(mockedBudgetApi.getBudgets).toHaveBeenCalledTimes(2);
    expect(mockedBudgetApi.getBudgets).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
  });

  it('hides the pager when every budget fits on one page', async () => {
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([makeBudget()], 3, 1));

    renderPage();

    expect(await screen.findByText('Groceries')).toBeDefined();
    expect(screen.queryByTestId('budgets-page-indicator')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('disables Previous on page one and enables Next when more budgets exist', async () => {
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([makeBudget()], 45, 1));

    renderPage();

    const indicator = await screen.findByTestId('budgets-page-indicator');
    expect(indicator).toHaveTextContent('Page 1 of 3');

    await waitForPagerSettled();

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('requests page two when Next is clicked', async () => {
    mockedBudgetApi.getBudgets.mockImplementation(async (params) => {
      if (params?.page === 2) {
        return listResponse([makeBudget({ id: 'b2', name: 'Transport' })], 45, 2);
      }
      return listResponse([makeBudget()], 45, 1);
    });

    renderPage();

    expect(await screen.findByText('Groceries')).toBeDefined();
    await waitForPagerSettled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Transport')).toBeDefined();
    expect(mockedBudgetApi.getBudgets).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(screen.getByTestId('budgets-page-indicator')).toHaveTextContent('Page 2 of 3');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
    });
  });

  it('requests the previous page when Previous is clicked', async () => {
    mockedBudgetApi.getBudgets.mockImplementation(async (params) => {
      if (params?.page === 2) {
        return listResponse([makeBudget({ id: 'b2', name: 'Transport' })], 45, 2);
      }
      return listResponse([makeBudget()], 45, 1);
    });

    renderPage();

    expect(await screen.findByText('Groceries')).toBeDefined();
    await waitForPagerSettled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Transport')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

    await waitFor(() => {
      expect(mockedBudgetApi.getBudgets).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
      expect(screen.getByText('Groceries')).toBeDefined();
    });
    expect(screen.getByTestId('budgets-page-indicator')).toHaveTextContent('Page 1 of 3');
  });

  it('disables Next on the final page', async () => {
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([makeBudget()], 25, 1));

    renderPage();

    expect(await screen.findByTestId('budgets-page-indicator')).toHaveTextContent(
      'Page 1 of 2'
    );
    await waitForPagerSettled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByTestId('budgets-page-indicator')).toHaveTextContent(
        'Page 2 of 2'
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
  });

  it('shows the empty state when no budgets exist', async () => {
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([], 0, 1));

    renderPage();

    expect(await screen.findByText('No budgets yet')).toBeDefined();
    expect(screen.queryByTestId('budgets-page-indicator')).toBeNull();
  });

  it('shows an error message and retries on demand', async () => {
    mockedBudgetApi.getBudgets
      .mockRejectedValueOnce(new Error('Budget service unavailable'))
      .mockRejectedValueOnce(new Error('Budget service unavailable'))
      .mockResolvedValue(listResponse([makeBudget()], 1, 1));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Budget service unavailable');

    vi.mocked(mockedBudgetApi.getBudgets).mockReset();
    mockedBudgetApi.getBudgets.mockResolvedValue(listResponse([makeBudget()], 1, 1));

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Groceries')).toBeDefined();
    expect(mockedBudgetApi.getBudgets).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  });

  it('keeps the pager hidden while a load error is displayed', async () => {
    mockedBudgetApi.getBudgets.mockRejectedValue(new Error('Budget service unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Budget service unavailable'
    );
    expect(screen.queryByTestId('budgets-page-indicator')).toBeNull();
  });
});