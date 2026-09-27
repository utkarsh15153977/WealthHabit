import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CreditCard,
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
  FileText,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { getMyProfile } from '../services/userApi';
import { assetLiabilityApi } from '../services/assetLiabilityApi';
import { wealthSnapshotApi } from '../services/wealthSnapshotApi';
import { formatDate } from '../utils/date';
import type { AssetsLiabilitiesSummary } from '../types/assetLiability';
import type { WealthSnapshot } from '../types/wealthSnapshot';

const PAGE_SIZE = 50;

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

export function NetWorth() {
  const { user, logout } = useAuth();

  const [summary, setSummary] = useState<AssetsLiabilitiesSummary | null>(null);
  const [snapshots, setSnapshots] = useState<WealthSnapshot[]>([]);
  const [snapshotTotal, setSnapshotTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [currency, setCurrency] = useState<string | null>(null);
  const [showAssetsLine, setShowAssetsLine] = useState(false);
  const [showLiabilitiesLine, setShowLiabilitiesLine] = useState(false);

  const formatAmount = useMemo(() => createCurrencyFormatter(currency), [currency]);
  const hasLoadedOnceRef = useRef(false);

  const fetchProfileCurrency = useCallback(async () => {
    try {
      const result = await getMyProfile();
      setCurrency(result.profile.financialProfile.currency);
    } catch {
      setCurrency(null);
    }
  }, []);

  const fetchAll = useCallback(async (options: { initial?: boolean } = {}) => {
    const { initial = false } = options;

    if (initial) {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      const [netWorthResult, snapshotResult] = await Promise.all([
        assetLiabilityApi.getNetWorth(),
        wealthSnapshotApi.getWealthSnapshots({ pageSize: PAGE_SIZE }),
      ]);
      setSummary(netWorthResult);
      setSnapshots(snapshotResult.snapshots);
      setSnapshotTotal(snapshotResult.total);
      setHasLoadedOnce(true);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      if (initial || hasLoadedOnceRef.current) {
        setSummary(null);
        setSnapshots([]);
        setSnapshotTotal(0);
        setLoadError(getApiErrorMessage(error));
      }
    } finally {
      if (initial) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchProfileCurrency();
  }, [fetchProfileCurrency]);

  useEffect(() => {
    void fetchAll({ initial: !hasLoadedOnceRef.current });
  }, [fetchAll]);

  const handleCapture = useCallback(async () => {
    setActionError(null);
    setSuccessMessage(null);
    setIsCapturing(true);

    try {
      const result = await wealthSnapshotApi.createWealthSnapshot();
      setSuccessMessage(
        result.created
          ? `Snapshot captured for ${formatDate(result.snapshot.snapshotDate)}`
          : `A snapshot for ${formatDate(result.snapshot.snapshotDate)} already exists`
      );
      await fetchAll();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsCapturing(false);
    }
  }, [fetchAll]);

  const netWorth = summary?.netWorth ?? 0;

  const chartData = useMemo(
    () =>
      [...snapshots]
        .reverse()
        .map((snapshot) => ({
          date: formatDate(snapshot.snapshotDate),
          netWorth: snapshot.netWorth,
          assets: snapshot.totalAssets,
          liabilities: snapshot.totalLiabilities,
        })),
    [snapshots]
  );

  if (isLoading && !hasLoadedOnce) {
    return <Loading />;
  }

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
    { name: 'Net Worth', href: '/net-worth', icon: Scale, current: true },
    { name: 'Wealth Analytics', href: '/wealth-analytics', icon: TrendingUp, current: false },
    { name: 'Reports', href: '/reports', icon: FileText, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  return (
    <div className="page-container">
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
            <h1 className="heading-1 flex items-center gap-2">
              <Scale className="w-6 h-6" aria-hidden="true" />
              Net Worth
            </h1>
            <p className="text-text-muted mt-1">
              What you own minus what you owe, plus a snapshot each day you choose to capture.
              Snapshots are kept exactly as they were.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary self-start sm:self-auto"
            onClick={() => void handleCapture()}
            disabled={isCapturing}
            data-testid="capture-snapshot-button"
          >
            {isCapturing ? 'Capturing...' : "Capture today's snapshot"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8" data-testid="net-worth-summary">
          <div className="card">
            <div className="card-body flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0">
                <Scale className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-text-muted">Total assets</p>
                <p className="text-xl font-semibold text-text" data-testid="net-worth-total-assets">
                  {summary ? formatAmount(summary.totalAssets) : '—'}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-text-muted">Total liabilities</p>
                <p
                  className="text-xl font-semibold text-text"
                  data-testid="net-worth-total-liabilities"
                >
                  {summary ? formatAmount(summary.totalLiabilities) : '—'}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-text-muted">Current net worth</p>
                <p
                  className={`text-xl font-semibold ${netWorth < 0 ? 'text-error' : 'text-text'}`}
                  data-testid="net-worth-current"
                >
                  {summary ? formatAmount(summary.netWorth) : '—'}
                </p>
                <p className="text-xs text-text-muted" data-testid="net-worth-record-counts">
                  {summary
                    ? `${summary.assetCount} assets · ${summary.liabilityCount} liabilities`
                    : ''}
                </p>
              </div>
            </div>
          </div>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-success bg-green-50 px-4 py-3 text-sm text-success mb-6"
            role="status"
            data-testid="net-worth-success"
          >
            {successMessage}
          </div>
        )}

        {actionError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="net-worth-error"
          >
            {actionError}
          </div>
        )}

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
                onClick={() => void fetchAll({ initial: true })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loadError && snapshots.length === 0 && (
          <div className="card">
            <div className="card-body text-center py-16">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                <Scale className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No snapshots yet</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Capture your first snapshot to start the history. Your current net worth above is
                always calculated live from your assets and liabilities.
              </p>
              <button
                type="button"
                className="btn-primary inline-flex"
                onClick={() => void handleCapture()}
                disabled={isCapturing}
                data-testid="empty-capture-snapshot-button"
              >
                {isCapturing ? 'Capturing...' : "Capture today's snapshot"}
              </button>
            </div>
          </div>
        )}

        {!loadError && snapshots.length > 0 && (
          <section aria-labelledby="snapshot-history-heading" className="card mb-8">
            <div className="card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 id="snapshot-history-heading" className="heading-4">
                  Snapshot history
                </h2>
                <p className="text-xs text-text-muted" data-testid="net-worth-snapshot-count">
                  {snapshotTotal} snapshot{snapshotTotal === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-text-muted">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showAssetsLine}
                    onChange={(event) => setShowAssetsLine(event.target.checked)}
                    data-testid="toggle-chart-assets"
                  />
                  Assets
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showLiabilitiesLine}
                    onChange={(event) => setShowLiabilitiesLine(event.target.checked)}
                    data-testid="toggle-chart-liabilities"
                  />
                  Liabilities
                </label>
              </div>
            </div>
            <div className="card-body">
              <div className="h-72 mb-6" data-testid="net-worth-history-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} width={70} />
                    <Tooltip formatter={(value) => formatAmount(Number(value))} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="netWorth"
                      name="Net worth"
                      stroke="#4f46e5"
                      strokeWidth={2}
                      dot={false}
                    />
                    {showAssetsLine && (
                      <Line
                        type="monotone"
                        dataKey="assets"
                        name="Assets"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                    {showLiabilitiesLine && (
                      <Line
                        type="monotone"
                        dataKey="liabilities"
                        name="Liabilities"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="net-worth-history-table">
                  <thead>
                    <tr className="text-left text-text-muted border-b border-border">
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">Assets</th>
                      <th className="py-2 pr-4 font-medium">Liabilities</th>
                      <th className="py-2 font-medium">Net worth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((snapshot) => (
                      <tr
                        key={snapshot.id}
                        className="border-b border-border"
                        data-testid={`net-worth-snapshot-row-${snapshot.id}`}
                      >
                        <td className="py-2 pr-4 text-text">
                          {formatDate(snapshot.snapshotDate)}
                        </td>
                        <td className="py-2 pr-4 text-text">
                          {formatAmount(snapshot.totalAssets)}
                        </td>
                        <td className="py-2 pr-4 text-text">
                          {formatAmount(snapshot.totalLiabilities)}
                        </td>
                        <td
                          className={`py-2 font-medium ${
                            snapshot.netWorth < 0 ? 'text-error' : 'text-text'
                          }`}
                        >
                          {formatAmount(snapshot.netWorth)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <Link
                  to="/assets-liabilities"
                  className="text-sm text-primary hover:underline"
                >
                  Manage assets &amp; liabilities →
                </Link>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void handleCapture()}
                  disabled={isCapturing}
                  data-testid="capture-snapshot-button-secondary"
                >
                  {isCapturing ? 'Capturing...' : "Capture today's snapshot"}
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
