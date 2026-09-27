import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WealthAnalytics } from './WealthAnalytics';
import { wealthAnalyticsApi } from '../services/wealthAnalyticsApi';
import { getMyProfile } from '../services/userApi';
import type {
  AnalyticsSummary,
  AssetAnalytics,
  CashFlowAnalytics,
  LiabilityAnalytics,
  NetWorthAnalytics,
} from '../types/wealthAnalytics';

vi.mock('../services/wealthAnalyticsApi', () => ({
  wealthAnalyticsApi: {
    getAnalyticsSummary: vi.fn(),
    getNetWorthAnalytics: vi.fn(),
    getAssetAnalytics: vi.fn(),
    getLiabilityAnalytics: vi.fn(),
    getCashFlowAnalytics: vi.fn(),
  },
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

vi.mock('../services/notificationApi', () => ({
  notificationApi: {
    getNotifications: vi.fn(),
    getUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 0 }),
    generateNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
  },
}));

const mockedSummary = vi.mocked(wealthAnalyticsApi.getAnalyticsSummary);
const mockedNetWorth = vi.mocked(wealthAnalyticsApi.getNetWorthAnalytics);
const mockedAssets = vi.mocked(wealthAnalyticsApi.getAssetAnalytics);
const mockedLiabilities = vi.mocked(wealthAnalyticsApi.getLiabilityAnalytics);
const mockedCashFlow = vi.mocked(wealthAnalyticsApi.getCashFlowAnalytics);
const mockedProfile = vi.mocked(getMyProfile);

function makeSummary(overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  return {
    current: {
      totalAssets: 55000,
      totalLiabilities: 18000,
      netWorth: 37000,
      assetCount: 3,
      liabilityCount: 2,
    },
    goals: {
      goalCount: 2,
      activeCount: 1,
      completedCount: 1,
      totalTargetAmount: 45000,
      totalSavedAmount: 30000,
      progressPercent: 66.67,
      items: [
        {
          goalId: 'g1',
          name: 'Emergency fund',
          targetAmount: 40000,
          currentAmount: 30000,
          progressPercent: 75,
          targetDate: '2027-06-30T00:00:00.000Z',
          status: 'ACTIVE',
        },
      ],
    },
    ...overrides,
  };
}

function makeNetWorth(overrides: Partial<NetWorthAnalytics> = {}): NetWorthAnalytics {
  return {
    range: {
      dateFrom: '2025-09-27T00:00:00.000Z',
      dateTo: '2026-09-27T00:00:00.000Z',
      timezone: 'UTC',
    },
    history: [
      {
        snapshotDate: '2026-09-01T00:00:00.000Z',
        totalAssets: 30000,
        totalLiabilities: 10000,
        netWorth: 20000,
      },
      {
        snapshotDate: '2026-09-15T00:00:00.000Z',
        totalAssets: 35000,
        totalLiabilities: 10000,
        netWorth: 25000,
      },
      {
        snapshotDate: '2026-09-27T00:00:00.000Z',
        totalAssets: 40000,
        totalLiabilities: 10000,
        netWorth: 30000,
      },
    ],
    change: { absolute: 10000, percentage: 50 },
    ...overrides,
  };
}

function makeAssets(overrides: Partial<AssetAnalytics> = {}): AssetAnalytics {
  return {
    totalAssets: 50000,
    assetCount: 2,
    byType: [
      { type: 'BANK_ACCOUNT', totalValue: 30000, percentage: 60 },
      { type: 'PROPERTY', totalValue: 20000, percentage: 40 },
    ],
    assets: [
      {
        id: 'a1',
        name: 'Savings account',
        type: 'BANK_ACCOUNT',
        currentValue: 30000,
        percentage: 60,
      },
      {
        id: 'a2',
        name: 'Family home',
        type: 'PROPERTY',
        currentValue: 20000,
        percentage: 40,
      },
    ],
    ...overrides,
  };
}

function makeLiabilities(
  overrides: Partial<LiabilityAnalytics> = {}
): LiabilityAnalytics {
  return {
    totalLiabilities: 50000,
    liabilityCount: 2,
    byType: [
      { type: 'HOME_LOAN', totalBalance: 30000, percentage: 60 },
      { type: 'CREDIT_CARD', totalBalance: 20000, percentage: 40 },
    ],
    liabilities: [
      {
        id: 'l1',
        name: 'Home loan',
        type: 'HOME_LOAN',
        outstandingBalance: 30000,
        percentage: 60,
      },
      {
        id: 'l2',
        name: 'Credit card',
        type: 'CREDIT_CARD',
        outstandingBalance: 20000,
        percentage: 40,
      },
    ],
    ...overrides,
  };
}

function makeCashFlow(overrides: Partial<CashFlowAnalytics> = {}): CashFlowAnalytics {
  return {
    range: {
      dateFrom: '2025-09-27T00:00:00.000Z',
      dateTo: '2026-09-27T00:00:00.000Z',
      timezone: 'UTC',
    },
    income: 40000,
    expenses: 25000,
    net: 15000,
    transactionCount: 3,
    incomeByCategory: [
      { categoryId: 'c1', name: 'Salary', total: 40000, percentage: 100 },
    ],
    expenseByCategory: [
      { categoryId: 'c2', name: 'Food', total: 15000, percentage: 60 },
      { categoryId: 'c3', name: 'Rent', total: 10000, percentage: 40 },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WealthAnalytics />
    </MemoryRouter>
  );
}

function expectedRange(days: number): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return {
    dateFrom: new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    dateTo: today.toISOString(),
  };
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

describe('WealthAnalytics page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProfile.mockResolvedValue({
      profile: { financialProfile: { currency: 'USD' } },
    } as Awaited<ReturnType<typeof getMyProfile>>);
    mockedSummary.mockResolvedValue(makeSummary());
    mockedNetWorth.mockResolvedValue(makeNetWorth());
    mockedAssets.mockResolvedValue(makeAssets());
    mockedLiabilities.mockResolvedValue(makeLiabilities());
    mockedCashFlow.mockResolvedValue(makeCashFlow());
  });

  it('renders every analytics section and marks the nav item as current', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Wealth Analytics' })
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Current financial position' })
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Net worth trend' })).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Asset allocation' })
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Liability composition' })
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Savings goals' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Cash flow' })).toBeDefined();

    const navLink = screen.getByRole('link', { name: /Wealth Analytics/ });
    expect(navLink).toHaveAttribute('href', '/wealth-analytics');
    expect(navLink).toHaveAttribute('aria-current', 'page');
  });

  it('shows the current financial position from live data', async () => {
    renderPage();

    const current = await screen.findByTestId('analytics-current');
    expect(within(current).getByTestId('analytics-total-assets')).toHaveTextContent(
      '$55,000'
    );
    expect(
      within(current).getByTestId('analytics-total-liabilities')
    ).toHaveTextContent('$18,000');
    expect(
      within(current).getByTestId('analytics-current-net-worth')
    ).toHaveTextContent('$37,000');
    expect(current).toHaveTextContent('3 assets');
    expect(current).toHaveTextContent('2 liabilities');
  });

  it('marks a negative current net worth as an error value', async () => {
    const summary = makeSummary();
    summary.current = {
      totalAssets: 1000,
      totalLiabilities: 9000,
      netWorth: -8000,
      assetCount: 1,
      liabilityCount: 2,
    };
    mockedSummary.mockResolvedValue(summary);

    renderPage();

    const netWorth = await screen.findByTestId('analytics-current-net-worth');
    expect(netWorth).toHaveTextContent('-$8,000');
    expect(netWorth.className).toContain('text-error');
  });

  it('renders the net worth chart with the snapshot count', async () => {
    renderPage();

    expect(await screen.findByTestId('analytics-net-worth-chart')).toBeDefined();
    expect(screen.getByTestId('analytics-net-worth-count')).toHaveTextContent(
      '3 snapshots in range'
    );
  });

  it('shows a descriptive empty state when there are no snapshots', async () => {
    mockedNetWorth.mockResolvedValue(
      makeNetWorth({ history: [], change: { absolute: null, percentage: null } })
    );

    renderPage();

    expect(
      await screen.findByText('No wealth snapshots yet')
    ).toBeDefined();
    expect(screen.queryByTestId('analytics-net-worth-chart')).toBeNull();
    expect(screen.getByTestId('analytics-net-worth-empty')).toHaveTextContent(
      'Capture your first snapshot to start tracking Net Worth over time'
    );
  });

  it('labels the change as Net Worth Change with its percentage', async () => {
    renderPage();

    const change = await screen.findByTestId('analytics-net-worth-change');
    expect(change).toHaveTextContent('Net Worth Change');
    expect(change).toHaveTextContent('$10,000');
    expect(change).toHaveTextContent('50% over the selected range');
  });

  it('omits the percentage when the change has no meaningful base', async () => {
    mockedNetWorth.mockResolvedValue(
      makeNetWorth({ change: { absolute: null, percentage: null } })
    );

    renderPage();

    const change = await screen.findByTestId('analytics-net-worth-change');
    expect(change).toHaveTextContent('Net Worth Change');
    expect(change).toHaveTextContent(
      'Not enough snapshots in this range to calculate a change.'
    );
  });

  it('renders asset allocation with type and share columns', async () => {
    renderPage();

    const byType = await screen.findByTestId('analytics-assets-by-type');
    expect(
      within(byType).getByTestId('analytics-asset-type-BANK_ACCOUNT')
    ).toHaveTextContent('Bank account');
    expect(
      within(byType).getByTestId('analytics-asset-type-BANK_ACCOUNT')
    ).toHaveTextContent('$30,000');
    expect(
      within(byType).getByTestId('analytics-asset-type-PROPERTY')
    ).toHaveTextContent('40%');

    const table = screen.getByTestId('analytics-assets-table');
    expect(within(table).getByText('Savings account')).toBeDefined();
    expect(screen.getByTestId('analytics-assets-chart')).toBeDefined();
  });

  it('shows the empty assets state', async () => {
    mockedAssets.mockResolvedValue({
      totalAssets: 0,
      assetCount: 0,
      byType: [],
      assets: [],
    });

    renderPage();

    expect(await screen.findByTestId('analytics-assets-empty')).toHaveTextContent(
      'No assets yet'
    );
    expect(screen.queryByTestId('analytics-assets-chart')).toBeNull();
  });

  it('renders liability composition with balance and share columns', async () => {
    renderPage();

    const byType = await screen.findByTestId('analytics-liabilities-by-type');
    expect(
      within(byType).getByTestId('analytics-liability-type-HOME_LOAN')
    ).toHaveTextContent('$30,000');
    expect(
      within(byType).getByTestId('analytics-liability-type-CREDIT_CARD')
    ).toHaveTextContent('40%');

    const table = screen.getByTestId('analytics-liabilities-table');
    const cardRow = within(table).getByTestId('analytics-liability-row-l2');
    expect(cardRow).toHaveTextContent('Credit card');
    expect(cardRow).toHaveTextContent('$20,000');
    expect(cardRow).toHaveTextContent('40%');
    expect(screen.getByTestId('analytics-liabilities-chart')).toBeDefined();
  });

  it('shows the empty liabilities state', async () => {
    mockedLiabilities.mockResolvedValue({
      totalLiabilities: 0,
      liabilityCount: 0,
      byType: [],
      liabilities: [],
    });

    renderPage();

    expect(
      await screen.findByTestId('analytics-liabilities-empty')
    ).toHaveTextContent('No liabilities yet');
    expect(screen.queryByTestId('analytics-liabilities-chart')).toBeNull();
  });

  it('renders the savings goal summary and breakdown', async () => {
    renderPage();

    const goals = await screen.findByTestId('analytics-goals');
    expect(within(goals).getByTestId('analytics-goals-active')).toHaveTextContent(
      '1'
    );
    expect(
      within(goals).getByTestId('analytics-goals-completed')
    ).toHaveTextContent('1');
    expect(within(goals).getByTestId('analytics-goals-target')).toHaveTextContent(
      '$45,000'
    );
    expect(within(goals).getByTestId('analytics-goals-saved')).toHaveTextContent(
      '$30,000'
    );
    expect(
      within(goals).getByTestId('analytics-goals-progress')
    ).toHaveTextContent('66.67%');
    expect(goals).toHaveTextContent('Emergency fund');
    expect(goals).toHaveTextContent('75%');
  });

  it('shows the empty goals state', async () => {
    const summary = makeSummary();
    summary.goals = {
      goalCount: 0,
      activeCount: 0,
      completedCount: 0,
      totalTargetAmount: 0,
      totalSavedAmount: 0,
      progressPercent: 0,
      items: [],
    };
    mockedSummary.mockResolvedValue(summary);

    renderPage();

    expect(await screen.findByTestId('analytics-goals-empty')).toHaveTextContent(
      'No savings goals yet'
    );
  });

  it('renders the cash flow summary without calling it net worth change', async () => {
    renderPage();

    const cashFlow = await screen.findByTestId('analytics-cash-flow');
    expect(within(cashFlow).getByTestId('analytics-cash-flow-income')).toHaveTextContent(
      '$40,000'
    );
    expect(
      within(cashFlow).getByTestId('analytics-cash-flow-expenses')
    ).toHaveTextContent('$25,000');
    expect(within(cashFlow).getByTestId('analytics-cash-flow-net')).toHaveTextContent(
      '$15,000'
    );
    expect(within(cashFlow).getByTestId('analytics-cash-flow-chart')).toBeDefined();
    expect(within(cashFlow).getByTestId('analytics-income-categories')).toHaveTextContent(
      'Salary'
    );
    expect(within(cashFlow).getByTestId('analytics-expense-categories')).toHaveTextContent(
      'Food'
    );
    expect(screen.getByText(/not net worth change/i)).toBeDefined();
    expect(within(cashFlow).queryByText(/Net Worth Change/i)).toBeNull();
  });

  it('shows the cash flow empty state when there are no transactions', async () => {
    mockedCashFlow.mockResolvedValue(
      makeCashFlow({
        income: 0,
        expenses: 0,
        net: 0,
        transactionCount: 0,
        incomeByCategory: [],
        expenseByCategory: [],
      })
    );

    renderPage();

    expect(
      await screen.findByTestId('analytics-cash-flow-empty')
    ).toHaveTextContent('No transactions in the selected period.');
    expect(screen.queryByTestId('analytics-cash-flow-chart')).toBeNull();
  });

  it('refetches the range dependent sections when the range changes', async () => {
    renderPage();

    await screen.findByTestId('analytics-current');
    expect(mockedNetWorth).toHaveBeenCalledTimes(1);
    expect(mockedNetWorth).toHaveBeenCalledWith(expectedRange(365));
    expect(mockedCashFlow).toHaveBeenCalledWith(expectedRange(365));

    fireEvent.click(screen.getByTestId('analytics-range-30d'));

    await waitFor(() => expect(mockedNetWorth).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedCashFlow).toHaveBeenCalledTimes(2));
    expect(mockedNetWorth).toHaveBeenLastCalledWith(expectedRange(30));
    expect(mockedCashFlow).toHaveBeenLastCalledWith(expectedRange(30));
    expect(screen.getByTestId('analytics-range-30d')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('analytics-range-12m')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByTestId('analytics-range-note')).toHaveTextContent(
      'Current assets, liabilities and goals are always live values'
    );
  });

  it('shows a loading state for every section while analytics load', async () => {
    mockedSummary.mockReturnValue(pending());
    mockedNetWorth.mockReturnValue(pending());
    mockedAssets.mockReturnValue(pending());
    mockedLiabilities.mockReturnValue(pending());
    mockedCashFlow.mockReturnValue(pending());

    renderPage();

    expect(await screen.findByTestId('analytics-summary-loading')).toBeDefined();
    expect(screen.getByTestId('analytics-net-worth-loading')).toBeDefined();
    expect(screen.getByTestId('analytics-assets-loading')).toBeDefined();
    expect(screen.getByTestId('analytics-liabilities-loading')).toBeDefined();
    expect(screen.getByTestId('analytics-cash-flow-loading')).toBeDefined();
  });

  it('keeps the other sections usable when one section fails', async () => {
    mockedSummary.mockRejectedValue(new Error('Summary unavailable'));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Summary unavailable');
    expect(alert).toHaveAttribute('data-testid', 'analytics-summary-error');
    expect(await screen.findByTestId('analytics-net-worth-chart')).toBeDefined();
    expect(screen.getByTestId('analytics-assets-table')).toBeDefined();
    expect(screen.getByTestId('analytics-cash-flow')).toBeDefined();
  });

  it('retries a failed section without reloading the whole page', async () => {
    mockedAssets
      .mockRejectedValueOnce(new Error('Assets unavailable'))
      .mockResolvedValue(makeAssets());

    renderPage();

    const alert = await screen.findByTestId('analytics-assets-error');
    expect(alert).toHaveTextContent('Assets unavailable');
    expect(screen.queryByTestId('analytics-assets-table')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('analytics-assets-table')).toBeDefined();
    expect(screen.queryByTestId('analytics-assets-error')).toBeNull();
    expect(mockedAssets).toHaveBeenCalledTimes(2);
  });
});
