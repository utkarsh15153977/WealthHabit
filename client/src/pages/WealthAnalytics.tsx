import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react';
import { getApiErrorMessage } from '../services/error';
import { getMyProfile } from '../services/userApi';
import { wealthAnalyticsApi } from '../services/wealthAnalyticsApi';
import { formatDate } from '../utils/date';
import type {
  AnalyticsRangeOption,
  AnalyticsRangeParams,
  AnalyticsSummary,
  AssetAnalytics,
  CashFlowAnalytics,
  LiabilityAnalytics,
  NetWorthAnalytics,
} from '../types/wealthAnalytics';

interface SectionState<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
}

const RANGE_OPTIONS: { value: AnalyticsRangeOption; label: string; days: number }[] = [
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '6m', label: '6 months', days: 183 },
  { value: '12m', label: '12 months', days: 365 },
];

const PIE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

function buildRangeParams(option: AnalyticsRangeOption): AnalyticsRangeParams {
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

export function WealthAnalytics() {

  const [currency, setCurrency] = useState<string | null>(null);
  const [range, setRange] = useState<AnalyticsRangeOption>('12m');
  const [showAssetsLine, setShowAssetsLine] = useState(false);
  const [showLiabilitiesLine, setShowLiabilitiesLine] = useState(false);

  const [summaryState, setSummaryState] = useState<SectionState<AnalyticsSummary>>({
    loading: true,
    data: null,
    error: null,
  });
  const [netWorthState, setNetWorthState] = useState<SectionState<NetWorthAnalytics>>({
    loading: true,
    data: null,
    error: null,
  });
  const [assetsState, setAssetsState] = useState<SectionState<AssetAnalytics>>({
    loading: true,
    data: null,
    error: null,
  });
  const [liabilitiesState, setLiabilitiesState] = useState<
    SectionState<LiabilityAnalytics>
  >({ loading: true, data: null, error: null });
  const [cashFlowState, setCashFlowState] = useState<SectionState<CashFlowAnalytics>>({
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

  const fetchSummary = useCallback(async () => {
    setSummaryState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await wealthAnalyticsApi.getAnalyticsSummary();
      setSummaryState({ loading: false, data, error: null });
    } catch (error) {
      setSummaryState({ loading: false, data: null, error: getApiErrorMessage(error) });
    }
  }, []);

  const fetchNetWorth = useCallback(async () => {
    setNetWorthState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await wealthAnalyticsApi.getNetWorthAnalytics(buildRangeParams(range));
      setNetWorthState({ loading: false, data, error: null });
    } catch (error) {
      setNetWorthState({ loading: false, data: null, error: getApiErrorMessage(error) });
    }
  }, [range]);

  const fetchAssets = useCallback(async () => {
    setAssetsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await wealthAnalyticsApi.getAssetAnalytics();
      setAssetsState({ loading: false, data, error: null });
    } catch (error) {
      setAssetsState({ loading: false, data: null, error: getApiErrorMessage(error) });
    }
  }, []);

  const fetchLiabilities = useCallback(async () => {
    setLiabilitiesState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await wealthAnalyticsApi.getLiabilityAnalytics();
      setLiabilitiesState({ loading: false, data, error: null });
    } catch (error) {
      setLiabilitiesState({
        loading: false,
        data: null,
        error: getApiErrorMessage(error),
      });
    }
  }, []);

  const fetchCashFlow = useCallback(async () => {
    setCashFlowState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await wealthAnalyticsApi.getCashFlowAnalytics(
        buildRangeParams(range)
      );
      setCashFlowState({ loading: false, data, error: null });
    } catch (error) {
      setCashFlowState({ loading: false, data: null, error: getApiErrorMessage(error) });
    }
  }, [range]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    void fetchNetWorth();
  }, [fetchNetWorth]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    void fetchLiabilities();
  }, [fetchLiabilities]);

  useEffect(() => {
    void fetchCashFlow();
  }, [fetchCashFlow]);

  const summary = summaryState.data;
  const netWorth = netWorthState.data;
  const assets = assetsState.data;
  const liabilities = liabilitiesState.data;
  const cashFlow = cashFlowState.data;

  const netWorthChartData = useMemo(
    () =>
      (netWorth?.history ?? []).map((point) => ({
        date: formatDate(point.snapshotDate),
        netWorth: point.netWorth,
        assets: point.totalAssets,
        liabilities: point.totalLiabilities,
      })),
    [netWorth]
  );

  const cashFlowChartData = useMemo(
    () =>
      cashFlow
        ? [
            { name: 'Income', amount: cashFlow.income },
            { name: 'Expenses', amount: cashFlow.expenses },
            { name: 'Net cash flow', amount: cashFlow.net },
          ]
        : [],
    [cashFlow]
  );

  const assetPieData = useMemo(
    () =>
      (assets?.byType ?? []).map((group) => ({
        name: formatType(group.type),
        value: group.totalValue,
      })),
    [assets]
  );

  const liabilityPieData = useMemo(
    () =>
      (liabilities?.byType ?? []).map((group) => ({
        name: formatType(group.type),
        value: group.totalBalance,
      })),
    [liabilities]
  );

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
      data-testid={`analytics-range-${option.value}`}
    >
      Last {option.label}
    </button>
  ));

  const sectionError = (message: string, testId: string, onRetry: () => void) => (
    <div
      className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
      role="alert"
      data-testid={testId}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <span>{message}</span>
        <button
          type="button"
          className="btn-secondary btn-sm self-start sm:self-auto"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </div>
  );

  return (
    <div className="page-container">
      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1 flex items-center gap-2">
              <BarChart3 className="w-6 h-6" aria-hidden="true" />
              Wealth Analytics
            </h1>
            <p className="text-text-muted mt-1">
              A read-only view derived from your assets, liabilities, goals,
              snapshots and transactions. Nothing here is stored or changed.
            </p>
          </div>
          <div
            className="flex flex-wrap items-center gap-2 self-start sm:self-auto"
            role="group"
            aria-label="Analytics date range"
          >
            {rangeButtons}
          </div>
        </div>

        <p className="text-xs text-text-muted mb-6" data-testid="analytics-range-note">
          Date ranges apply to Net Worth history and Cash Flow. Current assets,
          liabilities and goals are always live values.
        </p>

        <section aria-labelledby="current-position-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="current-position-heading" className="heading-4">
              Current financial position
            </h2>
            <p className="text-xs text-text-muted">
              Live values from your assets and liabilities
            </p>
          </div>
          <div className="card-body">
            {summaryState.loading && !summary && (
              <p className="text-sm text-text-muted" data-testid="analytics-summary-loading">
                Loading analytics...
              </p>
            )}

            {summaryState.error &&
              sectionError(summaryState.error, 'analytics-summary-error', () => {
                void fetchSummary();
              })}

            {!summaryState.error && !summary && !summaryState.loading && (
              <p className="text-sm text-text-muted">No position data available.</p>
            )}

            {summary && (
              <div data-testid="analytics-current">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-text-muted">Total assets</p>
                    <p
                      className="text-xl font-semibold text-text"
                      data-testid="analytics-total-assets"
                    >
                      {formatAmount(summary.current.totalAssets)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {summary.current.assetCount} asset
                      {summary.current.assetCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-text-muted">Total liabilities</p>
                    <p
                      className="text-xl font-semibold text-text"
                      data-testid="analytics-total-liabilities"
                    >
                      {formatAmount(summary.current.totalLiabilities)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {summary.current.liabilityCount} liabilit
                      {summary.current.liabilityCount === 1 ? 'y' : 'ies'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-text-muted">Current net worth</p>
                    <p
                      className={`text-xl font-semibold ${
                        summary.current.netWorth < 0 ? 'text-error' : 'text-text'
                      }`}
                      data-testid="analytics-current-net-worth"
                    >
                      {formatAmount(summary.current.netWorth)}
                    </p>
                    <p className="text-xs text-text-muted">
                      assets minus liabilities
                    </p>
                  </div>
                </div>

                {summary.current.assetCount === 0 &&
                  summary.current.liabilityCount === 0 && (
                    <p className="text-sm text-text-muted mt-4" data-testid="analytics-position-empty">
                      No assets or liabilities recorded yet. Your net worth is
                      shown as zero until you add some.
                    </p>
                  )}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="net-worth-trend-heading" className="card mb-8">
          <div className="card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 id="net-worth-trend-heading" className="heading-4">
                Net worth trend
              </h2>
              <p className="text-xs text-text-muted">
                From captured wealth snapshots, in chronological order
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-text-muted">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showAssetsLine}
                  onChange={(event) => setShowAssetsLine(event.target.checked)}
                  data-testid="analytics-toggle-assets"
                />
                Assets
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showLiabilitiesLine}
                  onChange={(event) => setShowLiabilitiesLine(event.target.checked)}
                  data-testid="analytics-toggle-liabilities"
                />
                Liabilities
              </label>
            </div>
          </div>
          <div className="card-body">
            {netWorthState.loading && !netWorth && (
              <p className="text-sm text-text-muted" data-testid="analytics-net-worth-loading">
                Loading analytics...
              </p>
            )}

            {netWorthState.error &&
              sectionError(netWorthState.error, 'analytics-net-worth-error', () => {
                void fetchNetWorth();
              })}

            {netWorth && netWorthState.error === null && (
              <div data-testid="analytics-net-worth-section">
                {netWorthState.loading && (
                  <p
                    className="text-xs text-text-muted mb-2"
                    data-testid="analytics-net-worth-updating"
                  >
                    Updating range...
                  </p>
                )}
                <div className="mb-4 flex flex-wrap items-center gap-6" data-testid="analytics-net-worth-change">
                  <span className="text-sm text-text-muted">Net Worth Change</span>
                  {netWorth.change.absolute === null ? (
                    <span className="text-sm text-text-muted">
                      Not enough snapshots in this range to calculate a change.
                    </span>
                  ) : (
                    <>
                      <span
                        className={`text-lg font-semibold ${
                          netWorth.change.absolute < 0 ? 'text-error' : 'text-success'
                        }`}
                      >
                        {netWorth.change.absolute < 0 ? (
                          <ArrowDownRight className="w-4 h-4 inline" aria-hidden="true" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 inline" aria-hidden="true" />
                        )}
                        {formatAmount(netWorth.change.absolute)}
                      </span>
                      {netWorth.change.percentage !== null && (
                        <span className="text-sm text-text-muted">
                          {netWorth.change.percentage}% over the selected range
                        </span>
                      )}
                    </>
                  )}
                </div>

                {netWorth.history.length === 0 ? (
                  <div className="text-center py-10" data-testid="analytics-net-worth-empty">
                    <h3 className="heading-4 mb-2">No wealth snapshots yet</h3>
                    <p className="text-text-muted mb-6 max-w-md mx-auto">
                      Capture your first snapshot to start tracking Net Worth over
                      time. Nothing is estimated or back-filled for days without a
                      snapshot.
                    </p>
                    <Link to="/net-worth" className="btn-primary inline-flex">
                      Capture a snapshot
                    </Link>
                  </div>
                ) : (
                  <>
                    <div
                      className="h-72 mb-6"
                      data-testid="analytics-net-worth-chart"
                      role="img"
                      aria-label="Net worth history chart"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={netWorthChartData}
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

                    <p className="text-xs text-text-muted" data-testid="analytics-net-worth-count">
                      {netWorth.history.length} snapshot
                      {netWorth.history.length === 1 ? '' : 's'} in range ·{' '}
                      {formatDate(netWorth.range.dateFrom)} to{' '}
                      {formatDate(netWorth.range.dateTo)}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="asset-allocation-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="asset-allocation-heading" className="heading-4">
              Asset allocation
            </h2>
            <p className="text-xs text-text-muted">
              Derived from current asset values, never stored
            </p>
          </div>
          <div className="card-body">
            {assetsState.loading && !assets && (
              <p className="text-sm text-text-muted" data-testid="analytics-assets-loading">
                Loading analytics...
              </p>
            )}

            {assetsState.error &&
              sectionError(assetsState.error, 'analytics-assets-error', () => {
                void fetchAssets();
              })}

            {assets && !assetsState.error && (
              <div data-testid="analytics-assets-section">
                {assets.assetCount === 0 ? (
                  <p className="text-sm text-text-muted py-6" data-testid="analytics-assets-empty">
                    No assets yet. Add what you own to see an allocation here.
                  </p>
                ) : (
                  <>
                    <div className="h-64 mb-6" data-testid="analytics-assets-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={assetPieData}
                            dataKey="value"
                            nameKey="name"
                            outerRadius={90}
                          >
                            {assetPieData.map((_, index) => (
                              <Cell
                                key={`asset-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, name) => [
                              formatAmount(Number(value)),
                              name,
                            ]}
                          />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="overflow-x-auto mb-6">
                      <table
                        className="w-full text-sm"
                        data-testid="analytics-assets-by-type"
                      >
                        <thead>
                          <tr className="text-left text-text-muted border-b border-border">
                            <th className="py-2 pr-4 font-medium">Asset type</th>
                            <th className="py-2 pr-4 font-medium">Value</th>
                            <th className="py-2 font-medium">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assets.byType.map((group) => (
                            <tr
                              key={group.type}
                              className="border-b border-border"
                              data-testid={`analytics-asset-type-${group.type}`}
                            >
                              <td className="py-2 pr-4 text-text">
                                {formatType(group.type)}
                              </td>
                              <td className="py-2 pr-4 text-text">
                                {formatAmount(group.totalValue)}
                              </td>
                              <td className="py-2 text-text">
                                {group.percentage}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="analytics-assets-table">
                        <thead>
                          <tr className="text-left text-text-muted border-b border-border">
                            <th className="py-2 pr-4 font-medium">Asset</th>
                            <th className="py-2 pr-4 font-medium">Type</th>
                            <th className="py-2 pr-4 font-medium">Value</th>
                            <th className="py-2 font-medium">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assets.assets.map((asset) => (
                            <tr
                              key={asset.id}
                              className="border-b border-border"
                              data-testid={`analytics-asset-row-${asset.id}`}
                            >
                              <td className="py-2 pr-4 text-text">{asset.name}</td>
                              <td className="py-2 pr-4 text-text-muted">
                                {formatType(asset.type)}
                              </td>
                              <td className="py-2 pr-4 text-text">
                                {formatAmount(asset.currentValue)}
                              </td>
                              <td className="py-2 text-text">{asset.percentage}%</td>
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

        <section aria-labelledby="liability-composition-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="liability-composition-heading" className="heading-4">
              Liability composition
            </h2>
            <p className="text-xs text-text-muted">
              Descriptive only — no advice, no scoring
            </p>
          </div>
          <div className="card-body">
            {liabilitiesState.loading && !liabilities && (
              <p
                className="text-sm text-text-muted"
                data-testid="analytics-liabilities-loading"
              >
                Loading analytics...
              </p>
            )}

            {liabilitiesState.error &&
              sectionError(liabilitiesState.error, 'analytics-liabilities-error', () => {
                void fetchLiabilities();
              })}

            {liabilities && !liabilitiesState.error && (
              <div data-testid="analytics-liabilities-section">
                {liabilities.liabilityCount === 0 ? (
                  <p
                    className="text-sm text-text-muted py-6"
                    data-testid="analytics-liabilities-empty"
                  >
                    No liabilities yet. Add what you owe to see a composition
                    here.
                  </p>
                ) : (
                  <>
                    <div className="h-64 mb-6" data-testid="analytics-liabilities-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={liabilityPieData}
                            dataKey="value"
                            nameKey="name"
                            outerRadius={90}
                          >
                            {liabilityPieData.map((_, index) => (
                              <Cell
                                key={`liability-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, name) => [
                              formatAmount(Number(value)),
                              name,
                            ]}
                          />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="overflow-x-auto mb-6">
                      <table
                        className="w-full text-sm"
                        data-testid="analytics-liabilities-by-type"
                      >
                        <thead>
                          <tr className="text-left text-text-muted border-b border-border">
                            <th className="py-2 pr-4 font-medium">Liability type</th>
                            <th className="py-2 pr-4 font-medium">Balance</th>
                            <th className="py-2 font-medium">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {liabilities.byType.map((group) => (
                            <tr
                              key={group.type}
                              className="border-b border-border"
                              data-testid={`analytics-liability-type-${group.type}`}
                            >
                              <td className="py-2 pr-4 text-text">
                                {formatType(group.type)}
                              </td>
                              <td className="py-2 pr-4 text-text">
                                {formatAmount(group.totalBalance)}
                              </td>
                              <td className="py-2 text-text">{group.percentage}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-x-auto">
                      <table
                        className="w-full text-sm"
                        data-testid="analytics-liabilities-table"
                      >
                        <thead>
                          <tr className="text-left text-text-muted border-b border-border">
                            <th className="py-2 pr-4 font-medium">Liability</th>
                            <th className="py-2 pr-4 font-medium">Type</th>
                            <th className="py-2 pr-4 font-medium">Balance</th>
                            <th className="py-2 font-medium">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {liabilities.liabilities.map((liability) => (
                            <tr
                              key={liability.id}
                              className="border-b border-border"
                              data-testid={`analytics-liability-row-${liability.id}`}
                            >
                              <td className="py-2 pr-4 text-text">{liability.name}</td>
                              <td className="py-2 pr-4 text-text-muted">
                                {formatType(liability.type)}
                              </td>
                              <td className="py-2 pr-4 text-text">
                                {formatAmount(liability.outstandingBalance)}
                              </td>
                              <td className="py-2 text-text">
                                {liability.percentage}%
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

        <section aria-labelledby="goals-heading" className="card mb-8">
          <div className="card-header flex items-center justify-between">
            <div>
              <h2 id="goals-heading" className="heading-4">
                Savings goals
              </h2>
              <p className="text-xs text-text-muted">
                Progress from goal contributions — never counted as net worth
              </p>
            </div>
            <Link to="/goals" className="text-sm text-primary hover:underline">
              Open goals
            </Link>
          </div>
          <div className="card-body">
            {summaryState.loading && !summary && (
              <p className="text-sm text-text-muted" data-testid="analytics-goals-loading">
                Loading analytics...
              </p>
            )}

            {summary && !summaryState.error && (
              <div data-testid="analytics-goals">
                {summary.goals.goalCount === 0 ? (
                  <p className="text-sm text-text-muted py-6" data-testid="analytics-goals-empty">
                    No savings goals yet. Create a goal to track progress here.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Active goals</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="analytics-goals-active"
                        >
                          {summary.goals.activeCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Completed goals</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="analytics-goals-completed"
                        >
                          {summary.goals.completedCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Target amount</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="analytics-goals-target"
                        >
                          {formatAmount(summary.goals.totalTargetAmount)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-sm text-text-muted">Saved amount</p>
                        <p
                          className="text-xl font-semibold text-text"
                          data-testid="analytics-goals-saved"
                        >
                          {formatAmount(summary.goals.totalSavedAmount)}
                        </p>
                      </div>
                    </div>

                    <div className="mb-6" data-testid="analytics-goals-progress">
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-text-muted">Overall progress</span>
                        <span className="font-medium text-text">
                          {summary.goals.progressPercent}%
                        </span>
                      </div>
                      <div
                        className="h-2 rounded-full bg-background overflow-hidden"
                        role="progressbar"
                        aria-valuenow={summary.goals.progressPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Overall savings goal progress"
                      >
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${summary.goals.progressPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      {summary.goals.items.map((goal) => (
                        <div
                          key={goal.goalId}
                          className="rounded-lg border border-border p-4"
                          data-testid={`analytics-goal-${goal.goalId}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <span className="text-sm font-medium text-text">
                              {goal.name}
                            </span>
                            <span className="text-xs text-text-muted">
                              {goal.status} · due {formatDate(goal.targetDate)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-text-muted">
                              {formatAmount(goal.currentAmount)} of{' '}
                              {formatAmount(goal.targetAmount)}
                            </span>
                            <span className="font-medium text-text">
                              {goal.progressPercent}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-background overflow-hidden">
                            <div
                              className="h-2 rounded-full bg-primary"
                              style={{ width: `${goal.progressPercent}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="cash-flow-heading" className="card mb-8">
          <div className="card-header">
            <h2 id="cash-flow-heading" className="heading-4">
              Cash flow
            </h2>
            <p className="text-xs text-text-muted">
              Income minus expenses for the selected range — not net worth change
            </p>
          </div>
          <div className="card-body">
            {cashFlowState.loading && !cashFlow && (
              <p className="text-sm text-text-muted" data-testid="analytics-cash-flow-loading">
                Loading analytics...
              </p>
            )}

            {cashFlowState.error &&
              sectionError(cashFlowState.error, 'analytics-cash-flow-error', () => {
                void fetchCashFlow();
              })}

            {cashFlow && !cashFlowState.error && (
              <div data-testid="analytics-cash-flow">
                {cashFlowState.loading && (
                  <p
                    className="text-xs text-text-muted mb-4"
                    data-testid="analytics-cash-flow-updating"
                  >
                    Updating range...
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-text-muted">Income</p>
                    <p
                      className="text-xl font-semibold text-text"
                      data-testid="analytics-cash-flow-income"
                    >
                      {formatAmount(cashFlow.income)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-text-muted">Expenses</p>
                    <p
                      className="text-xl font-semibold text-text"
                      data-testid="analytics-cash-flow-expenses"
                    >
                      {formatAmount(cashFlow.expenses)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-text-muted">Net cash flow</p>
                    <p
                      className={`text-xl font-semibold ${
                        cashFlow.net < 0 ? 'text-error' : 'text-text'
                      }`}
                      data-testid="analytics-cash-flow-net"
                    >
                      {formatAmount(cashFlow.net)}
                    </p>
                  </div>
                </div>

                {cashFlow.transactionCount === 0 ? (
                  <p
                    className="text-sm text-text-muted"
                    data-testid="analytics-cash-flow-empty"
                  >
                    No transactions in the selected period.
                  </p>
                ) : (
                  <>
                    <div
                      className="h-64 mb-6"
                      data-testid="analytics-cash-flow-chart"
                      role="img"
                      aria-label="Cash flow chart"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={cashFlowChartData}
                          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6b7280' }} />
                          <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} width={70} />
                          <Tooltip formatter={(value) => formatAmount(Number(value))} />
                          <Bar dataKey="amount" name="Amount" fill="#4f46e5" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="heading-4 mb-3">Income by category</h3>
                        {cashFlow.incomeByCategory.length === 0 ? (
                          <p className="text-sm text-text-muted">
                            No income recorded in this range.
                          </p>
                        ) : (
                          <ul className="space-y-2" data-testid="analytics-income-categories">
                            {cashFlow.incomeByCategory.map((category) => (
                              <li
                                key={category.categoryId}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="text-text">{category.name}</span>
                                <span className="text-text-muted">
                                  {formatAmount(category.total)} ·{' '}
                                  {category.percentage}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h3 className="heading-4 mb-3">Expenses by category</h3>
                        {cashFlow.expenseByCategory.length === 0 ? (
                          <p className="text-sm text-text-muted">
                            No expenses recorded in this range.
                          </p>
                        ) : (
                          <ul
                            className="space-y-2"
                            data-testid="analytics-expense-categories"
                          >
                            {cashFlow.expenseByCategory.map((category) => (
                              <li
                                key={category.categoryId}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="text-text">{category.name}</span>
                                <span className="text-text-muted">
                                  {formatAmount(category.total)} ·{' '}
                                  {category.percentage}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
