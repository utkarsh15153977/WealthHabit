import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Reports } from './Reports';
import { reportApi } from '../services/reportApi';
import { getMyProfile } from '../services/userApi';
import type { FinancialReport, ReportDownload, ReportRangeParams } from '../types/report';

vi.mock('../services/reportApi', () => ({
  reportApi: {
    getFinancialReport: vi.fn(),
    downloadFinancialReportCsv: vi.fn(),
    downloadFinancialReportPdf: vi.fn(),
    saveReportFile: vi.fn(),
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

const mockedReport = vi.mocked(reportApi.getFinancialReport);
const mockedCsv = vi.mocked(reportApi.downloadFinancialReportCsv);
const mockedPdf = vi.mocked(reportApi.downloadFinancialReportPdf);
const mockedSave = vi.mocked(reportApi.saveReportFile);
const mockedProfile = vi.mocked(getMyProfile);

function makeReport(overrides: Partial<FinancialReport> = {}): FinancialReport {
  return {
    period: {
      dateFrom: '2025-09-27T00:00:00.000Z',
      dateTo: '2026-09-27T00:00:00.000Z',
      timezone: 'UTC',
    },
    overview: {
      income: 40000,
      expenses: 25000,
      netCashFlow: 15000,
      transactionCount: 3,
      totalAssets: 55000,
      totalLiabilities: 18000,
      netWorth: 37000,
      activeGoalCount: 1,
      completedGoalCount: 1,
      totalGoalTarget: 45000,
      totalGoalSaved: 30000,
      goalProgressPercent: 66.67,
    },
    incomeCategories: [
      { categoryId: 'c1', name: 'Salary', total: 40000, percentage: 100 },
    ],
    expenseCategories: [
      { categoryId: 'c2', name: 'Food', total: 15000, percentage: 60 },
      { categoryId: 'c3', name: 'Rent', total: 10000, percentage: 40 },
    ],
    assets: {
      totalAssets: 55000,
      assetCount: 2,
      byType: [
        { type: 'BANK_ACCOUNT', totalValue: 35000, percentage: 63.64 },
        { type: 'PROPERTY', totalValue: 20000, percentage: 36.36 },
      ],
      assets: [
        {
          id: 'a1',
          name: 'Savings account',
          type: 'BANK_ACCOUNT',
          currentValue: 35000,
          percentage: 63.64,
        },
        {
          id: 'a2',
          name: 'Family home',
          type: 'PROPERTY',
          currentValue: 20000,
          percentage: 36.36,
        },
      ],
    },
    liabilities: {
      totalLiabilities: 18000,
      liabilityCount: 2,
      byType: [
        { type: 'HOME_LOAN', totalBalance: 13000, percentage: 72.22 },
        { type: 'CREDIT_CARD', totalBalance: 5000, percentage: 27.78 },
      ],
      liabilities: [
        {
          id: 'l1',
          name: 'Home loan',
          type: 'HOME_LOAN',
          outstandingBalance: 13000,
          percentage: 72.22,
        },
        {
          id: 'l2',
          name: 'Credit card',
          type: 'CREDIT_CARD',
          outstandingBalance: 5000,
          percentage: 27.78,
        },
      ],
    },
    netWorthHistory: [
      {
        snapshotDate: '2026-09-01T00:00:00.000Z',
        totalAssets: 50000,
        totalLiabilities: 18000,
        netWorth: 32000,
      },
      {
        snapshotDate: '2026-09-15T00:00:00.000Z',
        totalAssets: 55000,
        totalLiabilities: 18000,
        netWorth: 37000,
      },
    ],
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
        {
          goalId: 'g2',
          name: 'New laptop',
          targetAmount: 5000,
          currentAmount: 5000,
          progressPercent: 100,
          targetDate: '2026-12-31T00:00:00.000Z',
          status: 'COMPLETED',
        },
      ],
    },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <AppLayout>
        <Reports />
      </AppLayout>
    </MemoryRouter>
  );
}

function expectedRange(days: number): ReportRangeParams {
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

describe('Reports page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProfile.mockResolvedValue({
      profile: { financialProfile: { currency: 'USD' } },
    } as Awaited<ReturnType<typeof getMyProfile>>);
    mockedReport.mockResolvedValue(makeReport());
    mockedCsv.mockResolvedValue({
      blob: new Blob(['income,40000']),
      fileName: 'wealthhabit-financial-report-2026-09-27.csv',
    });
    mockedPdf.mockResolvedValue({
      blob: new Blob(['%PDF-1.4']),
      fileName: 'wealthhabit-financial-report-2026-09-27.pdf',
    });
  });

  it('renders every report section and marks the nav item as current', async () => {
    renderPage();

    expect(await screen.findByTestId('reports-heading')).toHaveTextContent(
      'Financial Report'
    );
    expect(
      screen.getByRole('heading', { name: 'Financial overview' })
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Income & expenses' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Income categories' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Expense categories' })).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Current asset position' })
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Current liability position' })
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Net worth history' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Savings goals' })).toBeDefined();

    const navLink = screen.getByRole('link', { name: /Reports/ });
    expect(navLink).toHaveAttribute('href', '/reports');
    expect(navLink).toHaveAttribute('aria-current', 'page');
  });

  it('shows the selected period beside the overview', async () => {
    renderPage();

    await screen.findByTestId('reports-overview');
    expect(screen.getByTestId('reports-period')).toHaveTextContent(
      '27 Sept 2025 to 27 Sept 2026 · UTC'
    );
  });

  it('renders the overview metrics from the report payload', async () => {
    renderPage();

    const overview = await screen.findByTestId('reports-overview');
    expect(
      within(overview).getByTestId('reports-overview-income')
    ).toHaveTextContent('$40,000');
    expect(
      within(overview).getByTestId('reports-overview-expenses')
    ).toHaveTextContent('$25,000');
    expect(
      within(overview).getByTestId('reports-overview-net-cash-flow')
    ).toHaveTextContent('$15,000');
    expect(
      within(overview).getByTestId('reports-overview-transactions')
    ).toHaveTextContent('3');
    expect(
      within(overview).getByTestId('reports-overview-assets')
    ).toHaveTextContent('$55,000');
    expect(
      within(overview).getByTestId('reports-overview-liabilities')
    ).toHaveTextContent('$18,000');
    expect(
      within(overview).getByTestId('reports-overview-net-worth')
    ).toHaveTextContent('$37,000');
  });

  it('separates cash flow from the current position', async () => {
    renderPage();

    const cashFlow = await screen.findByTestId('reports-cash-flow');
    expect(within(cashFlow).getByTestId('reports-cash-flow-income')).toHaveTextContent(
      '$40,000'
    );
    expect(within(cashFlow).getByTestId('reports-cash-flow-net')).toHaveTextContent(
      '$15,000'
    );
    expect(screen.getByText(/not a change in net worth/i)).toBeDefined();
    expect(screen.getByTestId('reports-overview')).toHaveTextContent(
      'Current net worth'
    );
  });

  it('renders income and expense categories with their shares', async () => {
    renderPage();

    const income = await screen.findByTestId('reports-income-categories');
    expect(
      within(income).getByTestId('reports-income-categories-c1')
    ).toHaveTextContent('Salary');
    expect(
      within(income).getByTestId('reports-income-categories-c1')
    ).toHaveTextContent('100%');

    const expenses = screen.getByTestId('reports-expense-categories');
    expect(
      within(expenses).getByTestId('reports-expense-categories-c2')
    ).toHaveTextContent('Food');
    expect(
      within(expenses).getByTestId('reports-expense-categories-c3')
    ).toHaveTextContent('$10,000');
  });

  it('renders the current asset and liability positions', async () => {
    renderPage();

    const assets = await screen.findByTestId('reports-assets');
    expect(
      within(assets).getByTestId('reports-asset-type-BANK_ACCOUNT')
    ).toHaveTextContent('$35,000');
    expect(within(assets).getByTestId('reports-asset-a1')).toHaveTextContent(
      'Savings account'
    );

    const liabilities = screen.getByTestId('reports-liabilities');
    expect(within(liabilities).getByTestId('reports-liability-l2')).toHaveTextContent(
      'Credit card'
    );
    expect(within(liabilities).getByTestId('reports-liability-l2')).toHaveTextContent(
      '$5,000'
    );
  });

  it('renders the net worth history snapshots in the period', async () => {
    renderPage();

    const history = await screen.findByTestId('reports-net-worth-history');
    expect(
      within(history).getByTestId('reports-net-worth-2026-09-01T00:00:00.000Z')
    ).toHaveTextContent('$32,000');
    expect(
      within(history).getByTestId('reports-net-worth-2026-09-15T00:00:00.000Z')
    ).toHaveTextContent('$37,000');
  });

  it('renders savings goals without counting them as assets', async () => {
    renderPage();

    const goals = await screen.findByTestId('reports-goals');
    expect(within(goals).getByTestId('reports-goals-active')).toHaveTextContent('1');
    expect(within(goals).getByTestId('reports-goals-completed')).toHaveTextContent(
      '1'
    );
    expect(within(goals).getByTestId('reports-goals-target')).toHaveTextContent(
      '$45,000'
    );
    expect(within(goals).getByTestId('reports-goal-g1')).toHaveTextContent(
      'Emergency fund'
    );
    expect(within(goals).getByTestId('reports-goal-g1')).toHaveTextContent('75%');
    expect(within(goals).getByTestId('reports-goal-g2')).toHaveTextContent('COMPLETED');
    expect(screen.getByText(/never counted as assets/i)).toBeDefined();
  });

  it('shows a descriptive empty state when the account has no records', async () => {
    mockedReport.mockResolvedValue(
      makeReport({
        overview: {
          income: 0,
          expenses: 0,
          netCashFlow: 0,
          transactionCount: 0,
          totalAssets: 0,
          totalLiabilities: 0,
          netWorth: 0,
          activeGoalCount: 0,
          completedGoalCount: 0,
          totalGoalTarget: 0,
          totalGoalSaved: 0,
          goalProgressPercent: 0,
        },
        incomeCategories: [],
        expenseCategories: [],
        assets: { totalAssets: 0, assetCount: 0, byType: [], assets: [] },
        liabilities: {
          totalLiabilities: 0,
          liabilityCount: 0,
          byType: [],
          liabilities: [],
        },
        netWorthHistory: [],
        goals: {
          goalCount: 0,
          activeCount: 0,
          completedCount: 0,
          totalTargetAmount: 0,
          totalSavedAmount: 0,
          progressPercent: 0,
          items: [],
        },
      })
    );

    renderPage();

    expect(await screen.findByTestId('reports-empty')).toHaveTextContent(
      'No financial records yet'
    );
    expect(screen.getByTestId('reports-assets-empty')).toHaveTextContent(
      'No assets recorded'
    );
    expect(screen.getByTestId('reports-liabilities-empty')).toHaveTextContent(
      'No liabilities recorded'
    );
    expect(screen.getByTestId('reports-net-worth-empty')).toHaveTextContent(
      'No wealth snapshots in the selected period'
    );
    expect(screen.getByTestId('reports-goals-empty')).toHaveTextContent(
      'No savings goals yet'
    );
    expect(screen.getByTestId('reports-income-categories')).toHaveTextContent(
      'No income in the selected period.'
    );
  });

  it('refetches the report when the range changes', async () => {
    renderPage();

    await screen.findByTestId('reports-overview');
    expect(mockedReport).toHaveBeenCalledTimes(1);
    expect(mockedReport).toHaveBeenCalledWith(expectedRange(365));

    fireEvent.click(screen.getByTestId('reports-range-30d'));

    await waitFor(() => expect(mockedReport).toHaveBeenCalledTimes(2));
    expect(mockedReport).toHaveBeenLastCalledWith(expectedRange(30));
    expect(screen.getByTestId('reports-range-30d')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('reports-range-12m')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByTestId('reports-range-note')).toHaveTextContent(
      'Assets, liabilities and goals are always current values'
    );
  });

  it('downloads the CSV for the selected range', async () => {
    renderPage();

    await screen.findByTestId('reports-overview');
    fireEvent.click(screen.getByTestId('reports-export-csv'));

    await waitFor(() =>
      expect(mockedCsv).toHaveBeenCalledWith(expectedRange(365))
    );
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave).toHaveBeenCalledWith({
      blob: expect.any(Blob),
      fileName: 'wealthhabit-financial-report-2026-09-27.csv',
    });
    expect(mockedPdf).not.toHaveBeenCalled();
    expect(screen.getByTestId('reports-export-note')).toHaveTextContent(
      'never scheduled or emailed'
    );
  });

  it('downloads the PDF for the selected range', async () => {
    renderPage();

    await screen.findByTestId('reports-overview');
    fireEvent.click(screen.getByTestId('reports-export-pdf'));

    await waitFor(() => expect(mockedPdf).toHaveBeenCalledWith(expectedRange(365)));
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedCsv).not.toHaveBeenCalled();
  });

  it('uses the newly selected range for the next export', async () => {
    renderPage();

    await screen.findByTestId('reports-overview');
    fireEvent.click(screen.getByTestId('reports-range-90d'));
    await waitFor(() => expect(mockedReport).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId('reports-export-csv'));
    await waitFor(() =>
      expect(mockedCsv).toHaveBeenLastCalledWith(expectedRange(90))
    );
  });

  it('reports a failed export without touching the report preview', async () => {
    mockedCsv.mockRejectedValue(new Error('Export unavailable'));

    renderPage();

    await screen.findByTestId('reports-overview');
    fireEvent.click(screen.getByTestId('reports-export-csv'));

    const alert = await screen.findByTestId('reports-export-error');
    expect(alert).toHaveTextContent('Export unavailable');
    expect(mockedSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('reports-overview')).toHaveTextContent('$40,000');
    expect(screen.getByTestId('reports-export-csv')).toBeEnabled();
  });

  it('disables both export buttons while a file is being prepared', async () => {
    let resolveDownload: (value: ReportDownload) => void = () => undefined;
    mockedPdf.mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = resolve;
      })
    );

    renderPage();
    await screen.findByTestId('reports-overview');

    fireEvent.click(screen.getByTestId('reports-export-pdf'));

    await waitFor(() => {
      expect(screen.getByTestId('reports-export-pdf')).toBeDisabled();
    });
    expect(screen.getByTestId('reports-export-pdf')).toHaveTextContent(
      'Preparing PDF...'
    );
    expect(screen.getByTestId('reports-export-csv')).toBeDisabled();

    resolveDownload({
      blob: new Blob(['%PDF-1.4']),
      fileName: 'report.pdf',
    });

    await waitFor(() =>
      expect(screen.getByTestId('reports-export-pdf')).toBeEnabled()
    );
  });

  it('shows a loading state while the report is being built', async () => {
    mockedReport.mockReturnValue(pending());

    renderPage();

    expect(await screen.findByTestId('reports-loading')).toHaveTextContent(
      'Loading report...'
    );
    expect(screen.queryByTestId('reports-overview')).toBeNull();
  });

  it('retries a failed report without reloading the page', async () => {
    mockedReport
      .mockRejectedValueOnce(new Error('Report unavailable'))
      .mockResolvedValue(makeReport());

    renderPage();

    const alert = await screen.findByTestId('reports-error');
    expect(alert).toHaveTextContent('Report unavailable');
    expect(screen.queryByTestId('reports-overview')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('reports-overview')).toBeDefined();
    expect(screen.queryByTestId('reports-error')).toBeNull();
    expect(mockedReport).toHaveBeenCalledTimes(2);
  });

  it('never exposes an editable field for financial values', async () => {
    renderPage();

    await screen.findByTestId('reports-overview');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('reports-disclaimer')).toHaveTextContent(
      'not financial advice'
    );
  });
});
