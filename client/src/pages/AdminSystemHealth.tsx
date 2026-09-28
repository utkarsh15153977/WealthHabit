import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  CreditCard,
  Cpu,
  Database,
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
  Server,
  Settings,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { getApiErrorMessage } from '../services/error';
import { getSystemHealth } from '../services/adminSystemHealthApi';
import { formatDate } from '../utils/date';
import type {
  ApplicationHealth,
  DatabaseHealth,
  HealthStatus,
  RuntimeHealth,
  SystemHealthData,
} from '../types/adminSystemHealth';

function statusBadgeClass(status: HealthStatus): string {
  if (status === 'HEALTHY') {
    return 'badge badge-success';
  }
  if (status === 'DEGRADED') {
    return 'badge badge-warning';
  }
  return 'badge badge-error';
}

function StatusBadge({
  status,
  testId,
}: {
  status: HealthStatus;
  testId: string;
}) {
  return (
    <span
      className={`${statusBadgeClass(status)} text-xs`}
      data-testid={testId}
      aria-label={`Status ${status}`}
    >
      {status}
    </span>
  );
}

function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds >= 86400) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
  }
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium text-text text-right">{children}</dd>
    </div>
  );
}

function ApplicationCard({ health }: { health: ApplicationHealth }) {
  return (
    <div className="card" data-testid="admin-system-health-application">
      <div className="card-body">
        <div className="flex items-center justify-between mb-3">
          <h2 className="heading-4 flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" aria-hidden="true" />
            Application
          </h2>
          <StatusBadge
            status={health.status}
            testId="admin-system-health-application-status"
          />
        </div>
        <dl className="text-sm">
          <DetailRow label="Service">
            <span data-testid="admin-system-health-application-service">
              {health.service}
            </span>
          </DetailRow>
          <DetailRow label="Environment">
            <span data-testid="admin-system-health-application-environment">
              {health.environment}
            </span>
          </DetailRow>
          <DetailRow label="Uptime">
            <span data-testid="admin-system-health-application-uptime">
              {formatUptime(health.uptimeSeconds)}
            </span>
          </DetailRow>
        </dl>
      </div>
    </div>
  );
}

function DatabaseCard({ health }: { health: DatabaseHealth }) {
  return (
    <div className="card" data-testid="admin-system-health-database">
      <div className="card-body">
        <div className="flex items-center justify-between mb-3">
          <h2 className="heading-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" aria-hidden="true" />
            Database
          </h2>
          <StatusBadge
            status={health.status}
            testId="admin-system-health-database-status"
          />
        </div>
        <dl className="text-sm">
          <DetailRow label="Health-query latency">
            <span data-testid="admin-system-health-database-latency">
              {health.latencyMs === null ? '—' : `${health.latencyMs} ms`}
            </span>
          </DetailRow>
        </dl>
        {health.message && (
          <p
            className="mt-2 text-xs text-error"
            role="alert"
            data-testid="admin-system-health-database-message"
          >
            {health.message}
          </p>
        )}
      </div>
    </div>
  );
}

function RuntimeCard({ health }: { health: RuntimeHealth }) {
  return (
    <div className="card" data-testid="admin-system-health-runtime">
      <div className="card-body">
        <div className="flex items-center justify-between mb-3">
          <h2 className="heading-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" aria-hidden="true" />
            Runtime
          </h2>
          <StatusBadge
            status={health.status}
            testId="admin-system-health-runtime-status"
          />
        </div>
        <dl className="text-sm">
          <DetailRow label="Node.js">
            <span data-testid="admin-system-health-runtime-node">
              {health.nodeVersion}
            </span>
          </DetailRow>
          <DetailRow label="Uptime">
            <span data-testid="admin-system-health-runtime-uptime">
              {formatUptime(health.uptimeSeconds)}
            </span>
          </DetailRow>
          <DetailRow label="Memory">
            <span data-testid="admin-system-health-runtime-memory">
              {health.memory.rssMb} MB RSS · {health.memory.heapUsedMb}/
              {health.memory.heapTotalMb} MB heap
            </span>
          </DetailRow>
        </dl>
      </div>
    </div>
  );
}

export function AdminSystemHealth() {
  const { user: authUser, logout } = useAuth();

  const [data, setData] = useState<SystemHealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const fetchHealth = useCallback(async (initial = false) => {
    if (initial) {
      setIsLoading(true);
    } else {
      setIsFetching(true);
    }
    setError(null);

    try {
      const result = await getSystemHealth();
      hasLoadedOnce.current = true;
      setData(result);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth(true);
  }, [fetchHealth]);

  const showInitialLoading = isLoading && !hasLoadedOnce.current;

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Admin', href: '/admin', icon: LayoutDashboard, current: false },
    { name: 'Admin Users', href: '/admin/users', icon: Users, current: false },
    { name: 'Admin Challenges', href: '/admin/challenges', icon: Trophy, current: false },
    { name: 'Audit Logs', href: '/admin/audit-logs', icon: FileText, current: false },
    { name: 'System Health', href: '/admin/system-health', icon: Activity, current: true },
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
    { name: 'Reports', href: '/reports', icon: FileText, current: false },
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
              {authUser ? `${authUser.firstName} ${authUser.lastName}` : ''}
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
              <Activity className="w-6 h-6" aria-hidden="true" />
              System Health
            </h1>
            <p className="text-text-muted mt-1">
              Application, database and runtime health — read-only
              operational checks for administrators.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-2 self-start sm:self-auto"
            onClick={() => void fetchHealth()}
            disabled={isFetching || isLoading}
            data-testid="admin-system-health-refresh"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <p
          className="text-xs text-text-muted mb-6"
          data-testid="admin-system-health-timestamp"
        >
          Last checked: {data ? formatDate(data.generatedAt) : '—'}
        </p>

        {showInitialLoading && (
          <p className="text-sm text-text-muted" data-testid="admin-system-health-loading">
            Loading system health...
          </p>
        )}

        {error && !showInitialLoading && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="admin-system-health-error"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                className="btn-secondary btn-sm self-start sm:self-auto"
                onClick={() => void fetchHealth()}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {data && !error && (
          <>
            <div className="card mb-6">
              <div className="card-body flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="heading-4">Overall Status</h2>
                  <p className="text-xs text-text-muted mt-1">
                    Derived from the component checks below; a failed database
                    check marks the system unhealthy.
                  </p>
                </div>
                <StatusBadge
                  status={data.status}
                  testId="admin-system-health-overall"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <ApplicationCard health={data.application} />
              <DatabaseCard health={data.database} />
              <RuntimeCard health={data.runtime} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
