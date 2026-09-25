import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  LogOut,
  LayoutDashboard,
  CreditCard,
    Target,
    Repeat,
    TrendingUp,
  Settings,
  ArrowDownRight,
  ArrowUpRight,
  PiggyBank,
  Percent,
  ReceiptText,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { getDashboardSummary } from '../services/dashboardApi';
import { budgetApi } from '../services/budgetApi';
import { recurringTransactionApi } from '../services/recurringTransactionApi';
import { formatDate, formatMonth } from '../utils/date';
import type { DashboardSummaryData } from '../types/dashboard';
import type { BudgetWithProgress } from '../types/budget';
import type { RecurringTransaction } from '../types/recurringTransaction';

function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
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

interface StatCardProps {
  label: string;
  value: string;
  detail?: string | null;
  icon: typeof TrendingUp;
  iconClassName?: string;
  valueClassName?: string;
}

function StatCard({ label, value, detail, icon: Icon, iconClassName, valueClassName }: StatCardProps) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-muted">{label}</p>
          <span className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0">
            <Icon className={`w-4 h-4 ${iconClassName ?? 'text-primary'}`} aria-hidden="true" />
          </span>
        </div>
        <p className={`text-2xl font-semibold mt-2 ${valueClassName ?? 'text-text'}`}>{value}</p>
        {detail ? <p className="text-xs text-text-muted mt-1">{detail}</p> : null}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user, logout } = useAuth();

  const [data, setData] = useState<DashboardSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(() => currentUtcMonth());
  const [budgets, setBudgets] = useState<BudgetWithProgress[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(true);
  const [budgetsError, setBudgetsError] = useState<string | null>(null);
  const [recurringRules, setRecurringRules] = useState<RecurringTransaction[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(true);
  const [recurringError, setRecurringError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const budgetsRequestRef = useRef(0);
  const recurringRequestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const fetchSummary = useCallback(async (requestedMonth: string, initial: boolean) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (initial) {
      setIsLoading(true);
    } else {
      setIsFetching(true);
    }
    setLoadError(null);

    let result: DashboardSummaryData | null = null;
    let failure: unknown = null;

    try {
      result = await getDashboardSummary({ month: requestedMonth });
    } catch (error) {
      failure = error;
    }

    if (requestId !== requestIdRef.current) {
      return;
    }

    if (failure !== null) {
      setLoadError(getApiErrorMessage(failure));
    } else if (result !== null) {
      hasLoadedRef.current = true;
      setData(result);
    }

    if (initial) {
      setIsLoading(false);
    } else {
      setIsFetching(false);
    }
  }, []);

  const fetchBudgets = useCallback(async (requestedMonth: string, initial: boolean) => {
    const requestId = budgetsRequestRef.current + 1;
    budgetsRequestRef.current = requestId;

    if (initial) {
      setBudgetsLoading(true);
    }
    setBudgetsError(null);

    try {
      const result = await budgetApi.getBudgets({ month: requestedMonth });
      if (requestId !== budgetsRequestRef.current) {
        return;
      }
      setBudgets(result.budgets);
    } catch (error) {
      if (requestId !== budgetsRequestRef.current) {
        return;
      }
      setBudgets([]);
      setBudgetsError(getApiErrorMessage(error));
    } finally {
      if (requestId === budgetsRequestRef.current && initial) {
        setBudgetsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchSummary(month, !hasLoadedRef.current);
    void fetchBudgets(month, !hasLoadedRef.current);
  }, [month, fetchSummary, fetchBudgets]);

  const fetchRecurring = useCallback(async (initial: boolean) => {
    const requestId = recurringRequestRef.current + 1;
    recurringRequestRef.current = requestId;

    if (initial) {
      setRecurringLoading(true);
    }
    setRecurringError(null);

    try {
      const result = await recurringTransactionApi.getRecurringTransactions();
      if (requestId !== recurringRequestRef.current) {
        return;
      }
      setRecurringRules(result.recurringTransactions);
    } catch (error) {
      if (requestId !== recurringRequestRef.current) {
        return;
      }
      setRecurringRules([]);
      setRecurringError(getApiErrorMessage(error));
    } finally {
      if (requestId === recurringRequestRef.current && initial) {
        setRecurringLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchRecurring(true);
  }, [fetchRecurring]);

  const upcomingRecurring = useMemo(() => {
    return recurringRules
      .filter((rule) => rule.isActive)
      .sort((a, b) => (a.nextOccurrenceDate < b.nextOccurrenceDate ? -1 : 1))
      .slice(0, 5);
  }, [recurringRules]);

  const formatAmount = useMemo(
    () => createCurrencyFormatter(data?.currency ?? null),
    [data?.currency]
  );

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: true },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  const trendData = useMemo(
    () =>
      (data?.incomeExpenseTrend ?? []).map((point) => ({
        month: point.month,
        income: point.income,
        expenses: point.expenses,
      })),
    [data?.incomeExpenseTrend]
  );

  const isEmpty =
    data !== null &&
    data.summary.income === 0 &&
    data.summary.expenses === 0 &&
    data.recentTransactions.length === 0;

  const header = (
    <header className="border-b border-border bg-surface sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
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
  );

  if (isLoading) {
    return (
      <div className="page-container">
        {header}
        <Loading />
      </div>
    );
  }

  return (
    <div className="page-container">
      {header}

      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1">Dashboard</h1>
            <p className="text-text-muted mt-1">
              Welcome back{user ? `, ${user.firstName}` : ''}! Here's an overview of your financial
              health.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="dashboard-month" className="label">
                Month
              </label>
              <input
                id="dashboard-month"
                type="month"
                className="input"
                value={month}
                onChange={(event) => setMonth(event.target.value || currentUtcMonth())}
              />
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                void fetchSummary(month, false);
                void fetchBudgets(month, false);
              }}
              disabled={isFetching}
            >
              {isFetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {loadError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{loadError}</span>
              <button
                type="button"
                className="btn-secondary btn-sm self-start sm:self-auto"
                onClick={() => void fetchSummary(month, true)}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loadError && data && isEmpty && (
          <div className="card">
            <div className="card-body text-center py-16">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                <ReceiptText className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No activity for {formatMonth(month)}</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Add your first transaction to start tracking income, expenses, and savings on your
                dashboard.
              </p>
              <Link to="/transactions" className="btn-primary">
                <CreditCard className="w-4 h-4" aria-hidden="true" />
                Go to Transactions
              </Link>
            </div>
          </div>
        )}

        {!loadError && data && !isEmpty && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <StatCard
                label={`Income (${formatMonth(data.period.month)})`}
                value={formatAmount(data.summary.income)}
                detail={
                  data.targets.monthlyIncomeTarget !== null
                    ? `Target ${formatAmount(data.targets.monthlyIncomeTarget)}`
                    : null
                }
                icon={ArrowDownRight}
                iconClassName="text-primary"
              />
              <StatCard
                label="Expenses"
                value={formatAmount(data.summary.expenses)}
                detail={`${data.monthlySummary.transactionCount} transactions this month`}
                icon={ArrowUpRight}
                iconClassName="text-error"
                valueClassName="text-error"
              />
              <StatCard
                label="Savings"
                value={formatAmount(data.summary.savings)}
                detail={
                  data.targets.monthlySavingsTarget !== null
                    ? `Target ${formatAmount(data.targets.monthlySavingsTarget)}`
                    : null
                }
                icon={PiggyBank}
                iconClassName="text-primary"
                valueClassName={data.summary.savings < 0 ? 'text-error' : 'text-text'}
              />
              <StatCard
                label="Savings Rate"
                value={`${data.summary.savingsRate}%`}
                detail="Savings as a share of income"
                icon={Percent}
                iconClassName="text-info"
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
              <div className="card xl:col-span-2">
                <div className="card-header flex items-center justify-between">
                  <h2 className="heading-4">Income vs Expenses</h2>
                  <span className="text-xs text-text-muted">
                    {formatMonth(data.period.month)} · {data.period.timezone}
                  </span>
                </div>
                <div className="card-body">
                  {trendData.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-12">
                      No trend data available yet.
                    </p>
                  ) : (
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} />
                          <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} width={70} />
                          <Tooltip formatter={(value) => formatAmount(Number(value))} />
                          <Legend />
                          <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h2 className="heading-4">Spending by Category</h2>
                </div>
                <div className="card-body">
                  {data.spendingByCategory.length === 0 ? (
                    <p className="text-sm text-text-muted text-center py-12">
                      No expenses recorded for this month.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {data.spendingByCategory.map((category) => (
                        <li key={category.categoryId}>
                          <div className="flex items-center justify-between gap-3 mb-1.5">
                            <span className="text-sm text-text truncate">{category.name}</span>
                            <span className="text-sm text-text-muted whitespace-nowrap">
                              {formatAmount(category.amount)} · {category.percentage}%
                            </span>
                          </div>
                          <div
                            className="h-2 rounded-full bg-background overflow-hidden"
                            role="progressbar"
                            aria-valuenow={category.percentage}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${category.name} share of expenses`}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(category.percentage, 100)}%`,
                                backgroundColor: category.color ?? '#10b981',
                              }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="heading-4">Recent Transactions</h2>
                <Link to="/transactions" className="text-sm text-primary hover:underline">
                  View all
                </Link>
              </div>
              <div className="card-body">
                {data.recentTransactions.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8">
                    No recent transactions.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recentTransactions.map((transaction) => (
                      <li
                        key={transaction.id}
                        className="py-3 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-text truncate">
                            {transaction.description || transaction.category.name}
                          </p>
                          <p className="text-xs text-text-muted mt-0.5">
                            {formatDate(transaction.transactionDate)} ·{' '}
                            {transaction.category.name}
                          </p>
                        </div>
                        <span
                          className={`text-sm font-medium whitespace-nowrap ${
                            transaction.type === 'INCOME' ? 'text-success' : 'text-error'
                          }`}
                        >
                          {transaction.type === 'INCOME' ? '+' : '−'}
                          {formatAmount(transaction.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}

        <div className="card mt-6">
          <div className="card-header flex items-center justify-between">
            <h2 className="heading-4">Budgets</h2>
            <Link to="/budgets" className="text-sm text-primary hover:underline">
              Manage budgets
            </Link>
          </div>
          <div className="card-body">
            {budgetsLoading && (
              <p className="text-sm text-text-muted text-center py-6">Loading budgets...</p>
            )}

            {!budgetsLoading && budgetsError && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <span className="text-sm text-error" role="alert">
                  {budgetsError}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm self-start sm:self-auto"
                  onClick={() => void fetchBudgets(month, false)}
                >
                  Retry
                </button>
              </div>
            )}

            {!budgetsLoading && !budgetsError && budgets.length === 0 && (
              <p className="text-sm text-text-muted text-center py-6">
                No budgets for {formatMonth(month)}.{' '}
                <Link to="/budgets" className="text-primary hover:underline">
                  Create a budget
                </Link>{' '}
                to start tracking spending.
              </p>
            )}

            {!budgetsLoading && !budgetsError && budgets.length > 0 && (
              <ul className="space-y-5">
                {budgets.map((budget) => {
                  const overBudget = budget.progress.remaining < 0;
                  const width = Math.min(budget.progress.percentageUsed, 100);
                  return (
                    <li key={budget.id}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className="text-sm font-medium text-text truncate">
                          {budget.name}
                          {budget.category && (
                            <span className="text-text-muted font-normal">
                              {' '}
                              · {budget.category.name}
                            </span>
                          )}
                        </span>
                        <span className="text-sm text-text-muted whitespace-nowrap">
                          {formatAmount(budget.progress.spent)} of{' '}
                          {formatAmount(budget.progress.budgetAmount)} (
                          {budget.progress.percentageUsed}%)
                        </span>
                      </div>
                      <div
                        className="h-2 rounded-full bg-background overflow-hidden"
                        role="progressbar"
                        aria-valuenow={budget.progress.percentageUsed}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${budget.name} spending progress`}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${width}%`,
                            backgroundColor: overBudget
                              ? '#ef4444'
                              : (budget.category?.color ?? '#10b981'),
                          }}
                        />
                      </div>
                      <p
                        className={`text-xs mt-1 ${
                          overBudget ? 'text-error' : 'text-text-muted'
                        }`}
                      >
                        {overBudget
                          ? `Over budget by ${formatAmount(Math.abs(budget.progress.remaining))}`
                          : `${formatAmount(budget.progress.remaining)} remaining`}
                        {' · '}
                        {budget.progress.transactionCount}{' '}
                        {budget.progress.transactionCount === 1 ? 'transaction' : 'transactions'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="card mt-6">
          <div className="card-header flex items-center justify-between">
            <h2 className="heading-4">Upcoming Recurring</h2>
            <Link to="/recurring-transactions" className="text-sm text-primary hover:underline">
              Manage recurring
            </Link>
          </div>
          <div className="card-body">
            {recurringLoading && (
              <p className="text-sm text-text-muted text-center py-6">
                Loading recurring transactions...
              </p>
            )}

            {!recurringLoading && recurringError && (
              <span className="text-sm text-error block text-center py-6" role="alert">
                {recurringError}
              </span>
            )}

            {!recurringLoading && !recurringError && upcomingRecurring.length === 0 && (
              <p className="text-sm text-text-muted text-center py-6">
                No active recurring transactions.{' '}
                <Link to="/recurring-transactions" className="text-primary hover:underline">
                  Create one
                </Link>{' '}
                to automate regular income or expenses.
              </p>
            )}

            {!recurringLoading && !recurringError && upcomingRecurring.length > 0 && (
              <ul className="divide-y divide-border">
                {upcomingRecurring.map((rule) => (
                  <li
                    key={rule.id}
                    className="py-3 flex items-center justify-between gap-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-text truncate">{rule.name}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {rule.category.name} · {formatDate(rule.nextOccurrenceDate)}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-medium whitespace-nowrap ${
                        rule.type === 'INCOME' ? 'text-success' : 'text-error'
                      }`}
                    >
                      {rule.type === 'INCOME' ? '+' : '−'}
                      {formatAmount(rule.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
