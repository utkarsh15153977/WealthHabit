import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
  Search,
  Settings,
  Target,
  TrendingUp,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { getApiErrorMessage } from '../services/error';
import { listAuditLogs } from '../services/adminAuditLogsApi';
import { formatDate } from '../utils/date';
import { AUDIT_ACTIONS } from '../types/adminAuditLogs';
import type { AuditAction } from '../types/adminAuditLogs';
import type { AdminAuditLogEntry } from '../types/adminAuditLogs';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

interface Filters {
  action: AuditAction | '';
  actorUserId: string;
  entityId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = {
  action: '',
  actorUserId: '',
  entityId: '',
  dateFrom: '',
  dateTo: '',
};

function ActorIdentity({
  actor,
  fallback,
}: {
  actor: { firstName: string; lastName: string; email: string } | null;
  fallback: string;
}) {
  if (!actor) {
    return <span className="text-text-muted">{fallback}</span>;
  }
  return (
    <div className="min-w-0">
      <p className="font-medium text-text truncate">
        {actor.firstName} {actor.lastName}
      </p>
      <p className="text-xs text-text-muted truncate">{actor.email}</p>
    </div>
  );
}

export function AdminAuditLogs() {
  const { user: authUser, logout } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<AdminAuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminAuditLogEntry | null>(null);
  const hasLoadedOnce = useRef(false);

  const fetchLogs = useCallback(
    async (options: {
      page: number;
      filters: Filters;
      search: string;
      initial?: boolean;
    }) => {
      const {
        page: requestedPage,
        filters: requestedFilters,
        search: requestedSearch,
        initial,
      } = options;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const data = await listAuditLogs({
          page: requestedPage,
          pageSize: PAGE_SIZE,
          search: requestedSearch || undefined,
          action: requestedFilters.action || undefined,
          actorUserId: requestedFilters.actorUserId || undefined,
          entityId: requestedFilters.entityId || undefined,
          dateFrom: requestedFilters.dateFrom || undefined,
          dateTo: requestedFilters.dateTo || undefined,
        });
        hasLoadedOnce.current = true;
        setLogs(data.auditLogs);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      } catch (error) {
        setLoadError(getApiErrorMessage(error));
      } finally {
        setIsLoading(false);
        setIsFetching(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchLogs({ page, filters, search, initial: !hasLoadedOnce.current });
  }, [page, filters, search, fetchLogs]);

  useEffect(() => {
    if (searchInput === search) {
      return;
    }
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput, search]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetail(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail]);

  const applyFilters = () => {
    setFilters({ ...draft });
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const onDraftChange = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);
  const hasActiveFilters =
    search !== '' ||
    filters.action !== '' ||
    filters.actorUserId !== '' ||
    filters.entityId !== '' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '';
  const showInitialLoading = isLoading && !hasLoadedOnce.current;

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Admin', href: '/admin', icon: LayoutDashboard, current: false },
    { name: 'Admin Users', href: '/admin/users', icon: Users, current: false },
    { name: 'Audit Logs', href: '/admin/audit-logs', icon: FileText, current: true },
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
              <FileText className="w-6 h-6" aria-hidden="true" />
              Audit Logs
            </h1>
            <p className="text-text-muted mt-1">
              Administrative event history — read-only. Records can never be
              edited or deleted, and never contain credentials or financial
              values.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-2 self-start sm:self-auto"
            onClick={() => void fetchLogs({ page, filters, search })}
            disabled={isFetching || isLoading}
            data-testid="admin-logs-refresh"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {loadError && !showInitialLoading && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="admin-logs-error"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{loadError}</span>
              <button
                type="button"
                className="btn-secondary btn-sm self-start sm:self-auto"
                onClick={() => void fetchLogs({ page, filters, search })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {showInitialLoading && (
          <p className="text-sm text-text-muted" data-testid="admin-logs-loading">
            Loading audit logs...
          </p>
        )}

        {!showInitialLoading && (
          <>
            <div className="card mb-6">
              <div className="card-body">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="admin-logs-search" className="label">
                      Search
                    </label>
                    <div className="relative">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted"
                        aria-hidden="true"
                      />
                      <input
                        id="admin-logs-search"
                        type="search"
                        className="input pl-10"
                        placeholder="Actor or target name or email"
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        data-testid="admin-logs-search"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="admin-logs-action" className="label">
                      Action
                    </label>
                    <select
                      id="admin-logs-action"
                      className="input"
                      value={draft.action}
                      onChange={(event) =>
                        onDraftChange('action', event.target.value as AuditAction | '')
                      }
                      data-testid="admin-logs-action-filter"
                    >
                      <option value="">All actions</option>
                      {AUDIT_ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {action}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-logs-actor" className="label">
                      Actor user ID
                    </label>
                    <input
                      id="admin-logs-actor"
                      type="text"
                      className="input"
                      placeholder="c..."
                      value={draft.actorUserId}
                      onChange={(event) => onDraftChange('actorUserId', event.target.value)}
                      data-testid="admin-logs-actor-filter"
                    />
                  </div>
                  <div>
                    <label htmlFor="admin-logs-entity" className="label">
                      Target user ID
                    </label>
                    <input
                      id="admin-logs-entity"
                      type="text"
                      className="input"
                      placeholder="c..."
                      value={draft.entityId}
                      onChange={(event) => onDraftChange('entityId', event.target.value)}
                      data-testid="admin-logs-entity-filter"
                    />
                  </div>
                  <div>
                    <label htmlFor="admin-logs-date-from" className="label">
                      Date from
                    </label>
                    <input
                      id="admin-logs-date-from"
                      type="date"
                      className="input"
                      value={draft.dateFrom}
                      onChange={(event) => onDraftChange('dateFrom', event.target.value)}
                      data-testid="admin-logs-date-from"
                    />
                  </div>
                  <div>
                    <label htmlFor="admin-logs-date-to" className="label">
                      Date to
                    </label>
                    <input
                      id="admin-logs-date-to"
                      type="date"
                      className="input"
                      value={draft.dateTo}
                      onChange={(event) => onDraftChange('dateTo', event.target.value)}
                      data-testid="admin-logs-date-to"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2"
                      onClick={applyFilters}
                      data-testid="admin-logs-apply"
                    >
                      Apply filters
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full sm:w-auto inline-flex items-center justify-center gap-2"
                      onClick={clearFilters}
                      disabled={!hasActiveFilters && searchInput === ''}
                      data-testid="admin-logs-clear-filters"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {isFetching && (
              <div
                className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted bg-surface border border-border rounded-lg"
                role="status"
                data-testid="admin-logs-updating"
              >
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Updating...
              </div>
            )}

            {!loadError && logs.length === 0 && hasActiveFilters && (
              <div className="card">
                <div
                  className="card-body text-center py-16"
                  data-testid="admin-logs-no-results"
                >
                  <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-primary" aria-hidden="true" />
                  </div>
                  <h2 className="heading-2 mb-3">No matching audit events</h2>
                  <p className="text-text-muted mb-8 max-w-md mx-auto">
                    No audit events match the current search and filters.
                  </p>
                  <button type="button" className="btn-secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              </div>
            )}

            {!loadError && logs.length === 0 && !hasActiveFilters && (
              <div className="card">
                <div className="card-body text-center py-16" data-testid="admin-logs-empty">
                  <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-4">
                    <FileText className="w-8 h-8 text-primary" aria-hidden="true" />
                  </div>
                  <h2 className="heading-2 mb-3">No audit events recorded</h2>
                  <p className="text-text-muted max-w-md mx-auto">
                    Administrative actions such as status and role changes will
                    appear here as they happen.
                  </p>
                </div>
              </div>
            )}

            {!loadError && logs.length > 0 && (
              <>
                <div className="hidden md:block card overflow-hidden">
                  <div className="overflow-x-auto" data-testid="admin-logs-table">
                    <table className="w-full text-sm">
                      <thead className="bg-background border-b border-border">
                        <tr className="text-left text-text-muted">
                          <th scope="col" className="px-4 py-3 font-medium">
                            Timestamp
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Action
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Actor
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Target
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-3 font-medium text-right"
                          >
                            Details
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {logs.map((log) => (
                          <tr
                            key={log.id}
                            className="hover:bg-background"
                            data-testid="admin-log-row"
                          >
                            <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                              {formatDate(log.createdAt)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className="badge badge-info"
                                data-testid="admin-log-action"
                              >
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <ActorIdentity
                                actor={log.actor}
                                fallback="System / unknown"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <ActorIdentity
                                actor={log.target}
                                fallback={log.entityId ?? '—'}
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                data-testid="admin-logs-view"
                                onClick={() => setDetail(log)}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="md:hidden space-y-3" data-testid="admin-logs-table-mobile">
                  {logs.map((log) => (
                    <div key={log.id} className="card" data-testid="admin-log-card">
                      <div className="card-body p-4">
                        <div className="flex items-start justify-between gap-3">
                          <span className="badge badge-info" data-testid="admin-log-action">
                            {log.action}
                          </span>
                          <span className="text-xs text-text-muted whitespace-nowrap">
                            {formatDate(log.createdAt)}
                          </span>
                        </div>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div className="flex justify-between gap-3">
                            <dt className="text-text-muted">Actor</dt>
                            <dd className="text-right">
                              <ActorIdentity
                                actor={log.actor}
                                fallback="System / unknown"
                              />
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-text-muted">Target</dt>
                            <dd className="text-right">
                              <ActorIdentity
                                actor={log.target}
                                fallback={log.entityId ?? '—'}
                              />
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-3">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            data-testid="admin-logs-view"
                            onClick={() => setDetail(log)}
                          >
                            View
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!loadError && logs.length > 0 && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p
                  className="text-sm text-text-muted"
                  aria-live="polite"
                  data-testid="admin-logs-showing"
                >
                  Showing {startItem}–{endItem} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1 || isFetching}
                    data-testid="admin-logs-prev"
                  >
                    Previous
                  </button>
                  <span
                    className="text-sm text-text-muted px-2"
                    data-testid="admin-logs-page-indicator"
                  >
                    Page {page} of {Math.max(totalPages, 1)}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={isFetching || page >= totalPages}
                    data-testid="admin-logs-next"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDetail(null)}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-lg bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6 max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-log-detail-title"
            data-testid="admin-logs-detail"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="admin-log-detail-title" className="heading-3">
                Audit event details
              </h2>
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label="Close audit event details"
                data-testid="admin-logs-detail-close"
                onClick={() => setDetail(null)}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Action</dt>
                <dd
                  className="text-text font-medium text-right break-all"
                  data-testid="admin-logs-detail-action"
                >
                  {detail.action}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Timestamp</dt>
                <dd className="text-text text-right" data-testid="admin-logs-detail-time">
                  {formatDate(detail.createdAt)}
                  <span className="block text-xs text-text-muted">{detail.createdAt}</span>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Actor</dt>
                <dd className="text-right" data-testid="admin-logs-detail-actor">
                  <ActorIdentity actor={detail.actor} fallback="System / unknown" />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Target</dt>
                <dd className="text-right" data-testid="admin-logs-detail-target">
                  <ActorIdentity actor={detail.target} fallback={detail.entityId ?? '—'} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Entity</dt>
                <dd
                  className="text-text text-right break-all"
                  data-testid="admin-logs-detail-entity"
                >
                  {detail.entityType}
                  {detail.entityId ? ` · ${detail.entityId}` : ''}
                </dd>
              </div>
            </dl>

            <section className="mt-5" aria-labelledby="admin-log-detail-metadata-heading">
              <h3 id="admin-log-detail-metadata-heading" className="heading-4 mb-2">
                Metadata
              </h3>
              {detail.metadata === null || detail.metadata === undefined ? (
                <p className="text-sm text-text-muted" data-testid="admin-logs-detail-metadata">
                  No metadata recorded
                </p>
              ) : (
                <pre
                  className="rounded-lg border border-border bg-background p-3 text-xs text-text overflow-x-auto whitespace-pre-wrap break-all"
                  data-testid="admin-logs-detail-metadata"
                >
                  {JSON.stringify(detail.metadata, null, 2)}
                </pre>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
