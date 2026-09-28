import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  PiggyBank,
  Receipt,
  RefreshCw,
  Trophy,
  Users,
  CheckCircle2,
  Trash2,
  Bell,
} from 'lucide-react';
import { getApiErrorMessage } from '../services/error';
import { getAdminDashboard } from '../services/adminDashboardApi';
import { formatDate } from '../utils/date';
import type { AdminDashboardData } from '../types/adminDashboard';

interface SectionState {
  loading: boolean;
  data: AdminDashboardData | null;
  error: string | null;
}

function MetricCard({
  label,
  value,
  icon: Icon,
  testId,
  iconColor = 'text-primary',
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  iconColor?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4" data-testid={testId}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-primary-light ${iconColor}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm text-text-muted">{label}</p>
          <p className="text-2xl font-semibold text-text">{value}</p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-5 h-5 text-primary" aria-hidden="true" />
      <h2 className="heading-4">{title}</h2>
    </div>
  );
}

function MetricGrid({
  title,
  icon: Icon,
  metrics,
  testIdPrefix,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  metrics: { label: string; value: string | number; testId: string; icon?: React.ComponentType<{ className?: string }> }[];
  testIdPrefix: string;
}) {
  return (
    <section aria-labelledby={`${testIdPrefix}-heading`} className="card mb-8">
      <div className="card-header">
        <SectionTitle title={title} icon={Icon} />
      </div>
      <div className="card-body">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid={testIdPrefix}>
          {metrics.map(({ label, value, testId, icon: MetricIcon = Users }) => (
            <MetricCard
              key={testId}
              label={label}
              value={value}
              icon={MetricIcon}
              testId={`${testIdPrefix}-${testId}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function AdminDashboard() {

  const [dashboardState, setDashboardState] = useState<SectionState>({
    loading: true,
    data: null,
    error: null,
  });

  const fetchDashboard = useCallback(async () => {
    setDashboardState((prev: SectionState) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await getAdminDashboard();
      setDashboardState({ loading: false, data, error: null });
    } catch (error) {
      setDashboardState({ loading: false, data: null, error: getApiErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const data = dashboardState.data;

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat(undefined).format(num);
  };

  const userMetrics = data?.users
    ? [
        { label: 'Total Users', value: formatNumber(data.users.total), testId: 'total', icon: Users },
        { label: 'Active Users', value: formatNumber(data.users.active), testId: 'active', icon: CheckCircle2 },
        { label: 'Suspended', value: formatNumber(data.users.suspended), testId: 'suspended', icon: Trash2 },
        { label: 'Deactivated', value: formatNumber(data.users.deactivated), testId: 'deactivated', icon: Trash2 },
        { label: 'Administrators', value: formatNumber(data.users.admins), testId: 'admins', icon: Users },
        { label: 'New (30d)', value: formatNumber(data.users.recentlyRegistered), testId: 'recent', icon: Users },
      ]
    : [];

  const financialMetrics = data?.financialRecords
    ? [
        { label: 'Transactions', value: formatNumber(data.financialRecords.transactions), testId: 'transactions', icon: Receipt },
        { label: 'Savings Goals', value: formatNumber(data.financialRecords.savingsGoals), testId: 'goals', icon: PiggyBank },
        { label: 'Assets', value: formatNumber(data.financialRecords.assets), testId: 'assets', icon: Landmark },
        { label: 'Liabilities', value: formatNumber(data.financialRecords.liabilities), testId: 'liabilities', icon: CreditCard },
        { label: 'Wealth Snapshots', value: formatNumber(data.financialRecords.wealthSnapshots), testId: 'snapshots', icon: FileText },
      ]
    : [];

  const applicationMetrics = data?.application
    ? [
        { label: 'Financial Habits', value: formatNumber(data.application.habits), testId: 'habits', icon: ListChecks },
        { label: 'Challenges', value: formatNumber(data.application.challenges), testId: 'challenges', icon: Trophy },
        { label: 'Notifications', value: formatNumber(data.application.notifications), testId: 'notifications', icon: Bell },
      ]
    : [];

  return (
    <div className="page-container">
      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1 flex items-center gap-2">
              <LayoutDashboard className="w-6 h-6" aria-hidden="true" />
              Admin Dashboard
            </h1>
            <p className="text-text-muted mt-1">
              Operational overview of application usage and record counts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Link
              to="/admin/users"
              className="btn-secondary btn-sm inline-flex items-center gap-2"
              data-testid="admin-dashboard-manage-users"
            >
              <Users className="w-4 h-4" aria-hidden="true" />
              Manage users
            </Link>
            <Link
              to="/admin/challenges"
              className="btn-secondary btn-sm inline-flex items-center gap-2"
              data-testid="admin-dashboard-manage-challenges"
            >
              <Trophy className="w-4 h-4" aria-hidden="true" />
              Manage challenges
            </Link>
            <Link
              to="/admin/audit-logs"
              className="btn-secondary btn-sm inline-flex items-center gap-2"
              data-testid="admin-dashboard-audit-logs"
            >
              <FileText className="w-4 h-4" aria-hidden="true" />
              Audit log
            </Link>
            <Link
              to="/admin/system-health"
              className="btn-secondary btn-sm inline-flex items-center gap-2"
              data-testid="admin-dashboard-system-health"
            >
              <Activity className="w-4 h-4" aria-hidden="true" />
              System health
            </Link>
            <button
              type="button"
              className="btn-secondary btn-sm inline-flex items-center gap-2"
              onClick={() => void fetchDashboard()}
              disabled={dashboardState.loading}
              data-testid="admin-dashboard-refresh"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              {dashboardState.loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <p className="text-xs text-text-muted mb-6" data-testid="admin-dashboard-timestamp">
          Last refreshed: {data ? formatDate(data.generatedAt) : '—'}
        </p>

        {dashboardState.loading && !data && (
          <p className="text-sm text-text-muted" data-testid="admin-dashboard-loading">
            Loading dashboard...
          </p>
        )}

        {dashboardState.error && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="admin-dashboard-error"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{dashboardState.error}</span>
              <button
                type="button"
                className="btn-secondary btn-sm self-start sm:self-auto"
                onClick={() => void fetchDashboard()}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {data && !dashboardState.error && (
          <>
            <MetricGrid
              title="User Overview"
              icon={Users}
              metrics={userMetrics}
              testIdPrefix="admin-users"
            />

            <MetricGrid
              title="Financial Records"
              icon={Receipt}
              metrics={financialMetrics}
              testIdPrefix="admin-financial"
            />

            <MetricGrid
              title="Application"
              icon={Trophy}
              metrics={applicationMetrics}
              testIdPrefix="admin-application"
            />
          </>
        )}
      </main>
    </div>
  );
}
