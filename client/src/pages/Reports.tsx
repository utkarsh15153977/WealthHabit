import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  PiggyBank,
  Receipt,
  RefreshCw,
  Repeat,
  Scale,
  Settings,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { getApiErrorMessage } from '../services/error';
import { getMyProfile } from '../services/userApi';
import { reportApi } from '../services/reportApi';
import { formatDate } from '../utils/date';
import type {
  FinancialReport,
  ReportCategoryRow,
  ReportRangeOption,
  ReportRangeParams,
} from '../types/report';

interface SectionState<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
}

interface ExportState {
  format: 'csv' | 'pdf' | null;
  error: string | null;
}

interface MetricRow {
  label: string;
  value: string;
  emphasis?: boolean;
  negative?: boolean;
  testId?: string;
}

const RANGE_OPTIONS: { value: ReportRangeOption; label: string; days: number }[] = [
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '6m', label: '6 months', days: 183 },
  { value: '12m', label: '12 months', days: 365 },
];

function buildRangeParams(option: ReportRangeOption): ReportRangeParams {
  const days = RANGE_OPTIONS.find((entry) => entry.value === option)?.days ?? 365;
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return {
    dateFrom: new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    dateTo: today.toISOString(),
  };
}

function createCurrencyFormatter(currency: string | null): (amount: number) => string {
  return (amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency ?? 'USD',
      }).format(amount);
    } catch {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
      }).format(amount);
    }
  };
}

function formatType(type: string): string {
  const words = type.toLowerCase().split('_');
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(' ');
}

function MetricTable({ rows, testId }: { rows: MetricRow[]; testId: string }) {
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted border-b border-border">
            <th className="py-2 pr-4 font-medium">Metric</th>
            <th className="py-2 font-medium text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className="border-b border-border"
              data-testid={row.testId}
            >
              <td className="py-2 pr-4 text-text">{row.label}</td>
              <td
                className={`py-2 text-right ${
                  row.negative
                    ? 'text-error'
                    : row.emphasis
                      ? 'font-semibold text-text'
                      : 'text-text'
                }`}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryTable({
  title,
  headingId,
  rows,
  emptyMessage,
  testId,
  formatAmount,
}: {
  title: string;
  headingId: string;
  rows: ReportCategoryRow[];
  emptyMessage: string;
  testId: string;
  formatAmount: (amount: number) => string;
}) {
  return (
    <section aria-labelledby={headingId} className="card mb-8">
      <div className="card-header">
        <h2 id={headingId} className="heading-4">
          {title}
        </h2>
        <p className="text-xs text-text-muted">
          Share is the percentage of the category total in this period
        </p>
      </div>
      <div className="card-body">
        {rows.length === 0 ? (
          <p className="text-sm text-text-muted py-2" data-testid={testId}>
            {emptyMessage}
          </p>
        ) : (
          <div className="overflow-x-auto" data-testid={testId}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border">
                  <th className="py-2 pr-4 font-medium">Category</th>
                  <th className="py-2 pr-4 font-medium text-right">Total</th>
                  <th className="py-2 font-medium text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.categoryId}
                    className="border-b border-border"
                    data-testid={`${testId}-${row.categoryId}`}
                  >
                    <td className="py-2 pr-4 text-text">{row.name}</td>
                    <td className="py-2 pr-4 text-right text-text">
                      {formatAmount(row.total)}
                    </td>
                    <td className="py-2 text-right text-text">{row.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function Reports() {
  const { user, logout } = useAuth();

  const [currency, setCurrency] = useState<string | null>(null);
  const [range, setRange] = useState<ReportRangeOption>('12m');
  const [exportState, setExportState] = useState<ExportState>({
    format: null,
    error: null,
  });
  const [reportState, setReportState] = useState<SectionState<FinancialReport>>({
    loading: true,
    data: null,
    error: null,
  });

  const formatAmount = useMemo(() => createCurrencyFormatter(currency), [currency]);

  useEffect(() => {
    let cancelled = false;
    getMyProfile()
      .then((result) => {
        if (!cancelled) {
          setCurrency(result.profile.financialProfile.currency);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrency(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchReport = useCallback(async () => {
    setReportState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await reportApi.getFinancialReport(buildRangeParams(range));
      setReportState({ loading: false, data, error: null });
    } catch (error) {
      setReportState({ loading: false, data: null, error: getApiErrorMessage(error) });
    }
  }, [range]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const exportFile = useCallback(
    async (format: 'csv' | 'pdf') => {
      setExportState({ format, error: null });
      try {
        const params = buildRangeParams(range);
        const download =
          format === 'csv'
            ? await reportApi.downloadFinancialReportCsv(params)
            : await reportApi.downloadFinancialReportPdf(params);
        reportApi.saveReportFile(download);
        setExportState({ format: null, error: null });
      } catch (error) {
        setExportState({ format: null, error: getApiErrorMessage(error) });
      }
    },
    [range]
  );

  const report = reportState.data;
  const overview = report?.overview;

  const overviewRows = useMemo<MetricRow[]>(() => {
    if (!overview) return [];
    return [
      {
        label: 'Total income',
        value: formatAmount(overview.income),
        testId: 'reports-overview-income',
      },
      {
        label: 'Total expenses',
        value: formatAmount(overview.expenses),
        testId: 'reports-overview-expenses',
      },
      {
        label: 'Net cash flow',
        value: formatAmount(overview.netCashFlow),
        negative: overview.netCashFlow < 0,
        emphasis: true,
        testId: 'reports-overview-net-cash-flow',
      },
      {
        label: 'Transactions in period',
        value: String(overview.transactionCount),
        testId: 'reports-overview-transactions',
      },
      {
        label: 'Current total assets',
        value: formatAmount(overview.totalAssets),
        testId: 'reports-overview-assets',
      },
      {
        label: 'Current total liabilities',
        value: formatAmount(overview.totalLiabilities),
        testId: 'reports-overview-liabilities',
      },
      {
        label: 'Current net worth',
        value: formatAmount(overview.netWorth),
        negative: overview.netWorth < 0,
        emphasis: true,
        testId: 'reports-overview-net-worth',
      },
      {
        label: 'Active savings goals',
        value: String(overview.activeGoalCount),
      },
      {
        label: 'Completed savings goals',
        value: String(overview.completedGoalCount),
      },
      {
        label: 'Total goal target',
        value: formatAmount(overview.totalGoalTarget),
      },
      {
        label: 'Total goal saved',
        value: formatAmount(overview.totalGoalSaved),
      },
      {
        label: 'Goal progress',
        value: `${overview.goalProgressPercent}%`,
      },
    ];
  }, [overview, formatAmount]);

  const cashFlowRows = useMemo<MetricRow[]>(() => {
    if (!report) return [];
    return [
      {
        label: 'Income',
        value: formatAmount(report.overview.income),
        testId: 'reports-cash-flow-income',
      },
      {
        label: 'Expenses',
        value: formatAmount(report.overview.expenses),
        testId: 'reports-cash-flow-expenses',
      },
      {
        label: 'Net cash flow',
        value: formatAmount(report.overview.netCashFlow),
        negative: report.overview.netCashFlow < 0,
        emphasis: true,
        testId: 'reports-cash-flow-net',
      },
    ];
  }, [report, formatAmount]);

  const isBlank =
    report !== null &&
    report.overview.transactionCount === 0 &&
    report.assets.assetCount === 0 &&
    report.liabilities.liabilityCount === 0 &&
    report.goals.goalCount === 0;

  const rangeButtons = RANGE_OPTIONS.map((option) => (
    <button
      key={option.value}
      type="button"
      className={`btn-sm px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        range === option.value
          ? 'bg-primary-light text-primary'
          : 'text-text-muted hover:bg-background hover:text-text'
      }`}
      aria-pressed={range === option.value}
      onClick={() => setRange(option.value)}
      data-testid={`reports-range-${option.value}`}
    >
      Last {option.label}
    </button>
  ));

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Habits', href: '/habits', icon: ListChecks, current: false },
    { name: 'Challenges', href: '/challenges', icon: Trophy, current: false },
    { name: 'Goals', href: '/goals', icon: PiggyBank, current: false },
    { name: 'Assets & Liabilities', href: '/assets-liabilities', icon: Landmark, current: false },
    { name: 'Net Worth', href: '/net-worth', icon: Scale, current: false },
    { name: 'Wealth Analytics', href: '/wealth-analytics', icon: TrendingUp, current: false },
    { name: 'Reports', href: '/reports', icon: FileText, current: true },
    { name: 'Admin', href: '/admin', icon: LayoutDashboard, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  return (
    <div className="page-container">
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="w-8 h-8 text-primary"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <path
                d="M8 16L14 22L24 10"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-xl font-bold text-text">WealthHabit</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  item.current
                    ? 'bg-primary-light text-primary'
                    : 'text-text-muted hover:bg-background hover:text-text'
                }`}
                aria-current={item.current ? 'page' : undefined}
              >
                <item.icon className="w-4 h-4 inline mr-2" aria-hidden="true" />
                {item.name}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-text-muted">
              {user ? `${user.firstName} ${user.lastName}` : ''}
            </span>
            <NotificationBell />
            <button
              type="button"
              className="btn-ghost p-2"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1 flex items-center gap-2" data-testid="reports-heading">
              <BarChart3 className="w-6 h-6" aria-hidden="true" />
              Financial Report
            </h1>
            <p className="text-text-muted mt-1">
              A read-only report assembled from your existing records. Nothing is
              stored, recommended or forecast.
            </p>
          </div>
          <div
            className="flex flex-wrap items-center gap-2 self-start sm:self-auto"
            role="group"
            aria-label="Report date range"
          >
            {rangeButtons}
          </div>
        </div>

        <p className="text-xs text-text-muted mb-6" data-testid="reports-range-note">
          Ranges apply to income, expenses and net worth history. Assets,
          liabilities and goals are always current values.
        </p>

        <section aria-labelledby="report-export-heading" className="card mb-8">
          <div className="card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 id="report-export-heading" className="heading-4">
                Export
              </h2>
              <p className="text-xs text-text-muted">
                CSV and PDF are generated on demand from the figures shown here
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary btn-sm inline-flex items-center gap-2"
                onClick={() => void exportFile('csv')}
                disabled={exportState.format !== null}
                data-testid="reports-export-csv"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                {exportState.format === 'csv' ? 'Preparing CSV...' : 'Download CSV'}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm inline-flex items-center gap-2"
                onClick={() => void exportFile('pdf')}
                disabled={exportState.format !== null}
                data-testid="reports-export-pdf"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                {exportState.format === 'pdf' ? 'Preparing PDF...' : 'Download PDF'}
              </button>
            </div>
          </div>
          <div className="card-body">
            {exportState.error && (
              <div
                className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
                role="alert"
                data-testid="reports-export-error"
              >
                {exportState.error}
              </div>
            )}
            <p className="text-xs text-text-muted" data-testid="reports-export-note">
              Exports use the selected date range and are never scheduled or
              emailed.
            </p>
          </div>
        </section>

        <section aria-labelledby="report-overview-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="report-overview-heading" className="heading-4">
              Financial overview
            </h2>
            <p className="text-xs text-text-muted">
              Cash flow for the period beside your current position
            </p>
          </div>
          <div className="card-body">
            {reportState.loading && !report && (
              <p className="text-sm text-text-muted" data-testid="reports-loading">
                Loading report...
              </p>
            )}

            {reportState.error && (
              <div
                className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                role="alert"
                data-testid="reports-error"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span>{reportState.error}</span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm self-start sm:self-auto"
                    onClick={() => {
                      void fetchReport();
                    }}
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {report && !reportState.error && (
              <>
                <p
                  className="text-xs text-text-muted mb-4"
                  data-testid="reports-period"
                >
                  {formatDate(report.period.dateFrom)} to{' '}
                  {formatDate(report.period.dateTo)} · {report.period.timezone}
                </p>

                <MetricTable rows={overviewRows} testId="reports-overview" />

                {isBlank && (
                  <p className="text-sm text-text-muted mt-4" data-testid="reports-empty">
                    No financial records yet. Add transactions, assets or goals to
                    fill in this report.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {report && !reportState.error && (
          <>
            <section aria-labelledby="report-cash-flow-heading" className="card mb-8">
              <div className="card-header">
                <h2 id="report-cash-flow-heading" className="heading-4">
                  Income &amp; expenses
                </h2>
                <p className="text-xs text-text-muted">
                  Cash flow for the selected range — not a change in net worth
                </p>
              </div>
              <div className="card-body">
                <MetricTable rows={cashFlowRows} testId="reports-cash-flow" />
              </div>
            </section>

            <CategoryTable
              title="Income categories"
              headingId="report-income-categories-heading"
              rows={report.incomeCategories}
              emptyMessage="No income in the selected period."
              testId="reports-income-categories"
              formatAmount={formatAmount}
            />

            <CategoryTable
              title="Expense categories"
              headingId="report-expense-categories-heading"
              rows={report.expenseCategories}
              emptyMessage="No expenses in the selected period."
              testId="reports-expense-categories"
              formatAmount={formatAmount}
            />
          </>
        )}

        <section aria-labelledby="report-assets-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="report-assets-heading" className="heading-4">
              Current asset position
            </h2>
            <p className="text-xs text-text-muted">
              Live values from your assets today, not historical balances
            </p>
          </div>
          <div className="card-body">
            {report && !reportState.error && (
              <div data-testid="reports-assets">
                {report.assets.assetCount === 0 ? (
                  <p className="text-sm text-text-muted py-2" data-testid="reports-assets-empty">
                    No assets recorded.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto mb-6">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-text-muted border-b border-border">
                            <th className="py-2 pr-4 font-medium">Asset type</th>
                            <th className="py-2 pr-4 font-medium text-right">Value</th>
                            <th className="py-2 font-medium text-right">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.assets.byType.map((group) => (
                            <tr
                              key={group.type}
                              className="border-b border-border"
                              data-testid={`reports-asset-type-${group.type}`}
                            >
                              <td className="py-2 pr-4 text-text">
                                {formatType(group.type)}
                              </td>
                              <td className="py-2 pr-4 text-right text-text">
                                {formatAmount(group.totalValue)}
                              </td>
                              <td className="py-2 text-right text-text">
                                {group.percentage}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-text-muted border-b border-border">
                            <th className="py-2 pr-4 font-medium">Asset</th>
                            <th className="py-2 pr-4 font-medium">Type</th>
                            <th className="py-2 pr-4 font-medium text-right">Value</th>
                            <th className="py-2 font-medium text-right">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.assets.assets.map((asset) => (
                            <tr
                              key={asset.id}
                              className="border-b border-border"
                              data-testid={`reports-asset-${asset.id}`}
                            >
                              <td className="py-2 pr-4 text-text">{asset.name}</td>
                              <td className="py-2 pr-4 text-text-muted">
                                {formatType(asset.type)}
                              </td>
                              <td className="py-2 pr-4 text-right text-text">
                                {formatAmount(asset.currentValue)}
                              </td>
                              <td className="py-2 text-right text-text">
                                {asset.percentage}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="report-liabilities-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="report-liabilities-heading" className="heading-4">
              Current liability position
            </h2>
            <p className="text-xs text-text-muted">
              Live balances you owe today, not historical balances
            </p>
          </div>
          <div className="card-body">
            {report && !reportState.error && (
              <div data-testid="reports-liabilities">
                {report.liabilities.liabilityCount === 0 ? (
                  <p
                    className="text-sm text-text-muted py-2"
                    data-testid="reports-liabilities-empty"
                  >
                    No liabilities recorded.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-text-muted border-b border-border">
                          <th className="py-2 pr-4 font-medium">Liability</th>
                          <th className="py-2 pr-4 font-medium">Type</th>
                          <th className="py-2 pr-4 font-medium text-right">Balance</th>
                          <th className="py-2 font-medium text-right">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.liabilities.liabilities.map((liability) => (
                          <tr
                            key={liability.id}
                            className="border-b border-border"
                            data-testid={`reports-liability-${liability.id}`}
                          >
                            <td className="py-2 pr-4 text-text">{liability.name}</td>
                            <td className="py-2 pr-4 text-text-muted">
                              {formatType(liability.type)}
                            </td>
                            <td className="py-2 pr-4 text-right text-text">
                              {formatAmount(liability.outstandingBalance)}
                            </td>
                            <td className="py-2 text-right text-text">
                              {liability.percentage}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="report-net-worth-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="report-net-worth-heading" className="heading-4">
              Net worth history
            </h2>
            <p className="text-xs text-text-muted">
              Captured wealth snapshots in the selected range, oldest first
            </p>
          </div>
          <div className="card-body">
            {report && !reportState.error && (
              <div data-testid="reports-net-worth-history">
                {report.netWorthHistory.length === 0 ? (
                  <p className="text-sm text-text-muted py-2" data-testid="reports-net-worth-empty">
                    No wealth snapshots in the selected period.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-text-muted border-b border-border">
                          <th className="py-2 pr-4 font-medium">Snapshot</th>
                          <th className="py-2 pr-4 font-medium text-right">Assets</th>
                          <th className="py-2 pr-4 font-medium text-right">
                            Liabilities
                          </th>
                          <th className="py-2 font-medium text-right">Net worth</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.netWorthHistory.map((point) => (
                          <tr
                            key={point.snapshotDate}
                            className="border-b border-border"
                            data-testid={`reports-net-worth-${point.snapshotDate}`}
                          >
                            <td className="py-2 pr-4 text-text">
                              {formatDate(point.snapshotDate)}
                            </td>
                            <td className="py-2 pr-4 text-right text-text">
                              {formatAmount(point.totalAssets)}
                            </td>
                            <td className="py-2 pr-4 text-right text-text">
                              {formatAmount(point.totalLiabilities)}
                            </td>
                            <td
                              className={`py-2 text-right ${
                                point.netWorth < 0 ? 'text-error' : 'text-text'
                              }`}
                            >
                              {formatAmount(point.netWorth)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="report-goals-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="report-goals-heading" className="heading-4">
              Savings goals
            </h2>
            <p className="text-xs text-text-muted">
              Goal savings are tracked separately and are never counted as assets
            </p>
          </div>
          <div className="card-body">
            {report && !reportState.error && (
              <div data-testid="reports-goals">
                {report.goals.goalCount === 0 ? (
                  <p className="text-sm text-text-muted py-2" data-testid="reports-goals-empty">
                    No savings goals yet.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Active goals</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="reports-goals-active"
                        >
                          {report.goals.activeCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Completed goals</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="reports-goals-completed"
                        >
                          {report.goals.completedCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Total target</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="reports-goals-target"
                        >
                          {formatAmount(report.goals.totalTargetAmount)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Total saved</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="reports-goals-saved"
                        >
                          {formatAmount(report.goals.totalSavedAmount)}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-text-muted border-b border-border">
                            <th className="py-2 pr-4 font-medium">Goal</th>
                            <th className="py-2 pr-4 font-medium">Status</th>
                            <th className="py-2 pr-4 font-medium">Target date</th>
                            <th className="py-2 pr-4 font-medium text-right">Target</th>
                            <th className="py-2 pr-4 font-medium text-right">Saved</th>
                            <th className="py-2 font-medium text-right">Progress</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.goals.items.map((goal) => (
                            <tr
                              key={goal.goalId}
                              className="border-b border-border"
                              data-testid={`reports-goal-${goal.goalId}`}
                            >
                              <td className="py-2 pr-4 text-text">{goal.name}</td>
                              <td className="py-2 pr-4 text-text-muted">{goal.status}</td>
                              <td className="py-2 pr-4 text-text-muted">
                                {formatDate(goal.targetDate)}
                              </td>
                              <td className="py-2 pr-4 text-right text-text">
                                {formatAmount(goal.targetAmount)}
                              </td>
                              <td className="py-2 pr-4 text-right text-text">
                                {formatAmount(goal.currentAmount)}
                              </td>
                              <td className="py-2 text-right text-text">
                                {goal.progressPercent}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <p className="text-xs text-text-muted" data-testid="reports-disclaimer">
          Figures are descriptive and are not financial advice.
        </p>
      </main>
    </div>
  );
}
