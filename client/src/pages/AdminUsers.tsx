import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { getApiErrorMessage } from '../services/error';
import {
  getAdminUser,
  listAdminUsers,
  updateAdminUserRole,
  updateAdminUserStatus,
} from '../services/adminUsersApi';
import { formatDate } from '../utils/date';
import type { AccountStatus, Role } from '../types/auth';
import type {
  AdminUser,
  AdminUserDetailResponse,
} from '../types/adminUsers';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

interface Filters {
  search: string;
  role: Role | '';
  status: AccountStatus | '';
}

const EMPTY_FILTERS: Filters = { search: '', role: '', status: '' };

interface DetailState {
  open: boolean;
  userId: string | null;
  loading: boolean;
  data: AdminUserDetailResponse | null;
  error: string | null;
}

type ConfirmKind = 'suspend' | 'deactivate' | 'reactivate' | 'promote' | 'demote';

interface ConfirmState {
  user: AdminUser;
  kind: ConfirmKind;
}

interface ConfirmCopy {
  title: string;
  description: string;
  action: string;
  pending: string;
  success: string;
  danger: boolean;
}

const CONFIRM_COPY: Record<ConfirmKind, ConfirmCopy> = {
  suspend: {
    title: 'Suspend user?',
    description:
      'A suspended account cannot sign in or use authenticated application functionality. All sessions for this user are ended. The account can be reactivated at any time.',
    action: 'Suspend',
    pending: 'Suspending...',
    success: 'User suspended. All sessions were ended.',
    danger: true,
  },
  deactivate: {
    title: 'Deactivate user?',
    description:
      'Deactivation blocks sign-in and ends all sessions until the account is reactivated. This is more consequential than suspension. Financial records are never deleted.',
    action: 'Deactivate',
    pending: 'Deactivating...',
    success: 'User deactivated. All sessions were ended.',
    danger: true,
  },
  reactivate: {
    title: 'Reactivate user?',
    description:
      'The account will be able to sign in and use the application again.',
    action: 'Reactivate',
    pending: 'Reactivating...',
    success: 'User reactivated.',
    danger: false,
  },
  promote: {
    title: 'Grant administrator access?',
    description:
      'This user will be able to access administrative areas, including user management.',
    action: 'Grant admin',
    pending: 'Saving...',
    success: 'Administrator access granted.',
    danger: false,
  },
  demote: {
    title: 'Remove administrator access?',
    description:
      'This user will lose access to administrative areas. The system never allows removing the last remaining administrator.',
    action: 'Remove admin',
    pending: 'Saving...',
    success: 'Administrator access removed.',
    danger: true,
  },
};

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={role === 'ADMIN' ? 'badge badge-primary' : 'badge badge-info'}
      data-testid="admin-user-role-badge"
    >
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: AccountStatus }) {
  const badgeClass =
    status === 'ACTIVE'
      ? 'badge badge-success'
      : status === 'SUSPENDED'
        ? 'badge badge-warning'
        : 'badge badge-error';

  return (
    <span className={badgeClass} data-testid="admin-user-status-badge">
      {status}
    </span>
  );
}

function UserIdentity({ user }: { user: AdminUser }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-text truncate">
        {user.firstName} {user.lastName}
      </p>
      <p className="text-xs text-text-muted truncate">{user.email}</p>
    </div>
  );
}

export function AdminUsers() {
  const { user: authUser } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({
    open: false,
    userId: null,
    loading: false,
    data: null,
    error: null,
  });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const fetchUsers = useCallback(
    async (options: { page: number; filters: Filters; initial?: boolean }) => {
      const { page: requestedPage, filters: requestedFilters, initial } = options;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const data = await listAdminUsers({
          page: requestedPage,
          pageSize: PAGE_SIZE,
          search: requestedFilters.search || undefined,
          role: requestedFilters.role || undefined,
          status: requestedFilters.status || undefined,
        });
        hasLoadedOnce.current = true;
        setUsers(data.users);
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
    void fetchUsers({ page, filters, initial: !hasLoadedOnce.current });
  }, [page, filters, fetchUsers]);

  useEffect(() => {
    if (searchInput === filters.search) {
      return;
    }
    const handle = window.setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput, filters.search]);

  useEffect(() => {
    if (!detail.open && !confirmState) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (isMutating) {
        return;
      }
      setConfirmState(null);
      setDetail((prev) => ({ ...prev, open: false }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail.open, confirmState, isMutating]);

  const onFilterChange = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput('');
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const openDetail = useCallback(async (userId: string) => {
    setDetail({ open: true, userId, loading: true, data: null, error: null });
    try {
      const data = await getAdminUser(userId);
      setDetail({ open: true, userId, loading: false, data, error: null });
    } catch (error) {
      setDetail({
        open: true,
        userId,
        loading: false,
        data: null,
        error: getApiErrorMessage(error),
      });
    }
  }, []);

  const refreshDetail = useCallback(async (userId: string) => {
    try {
      const data = await getAdminUser(userId);
      setDetail({ open: true, userId, loading: false, data, error: null });
    } catch (error) {
      setDetail({
        open: true,
        userId,
        loading: false,
        data: null,
        error: getApiErrorMessage(error),
      });
    }
  }, []);

  const openConfirm = (user: AdminUser, kind: ConfirmKind) => {
    setActionError(null);
    setConfirmState({ user, kind });
  };

  const runConfirmedAction = async () => {
    if (!confirmState) {
      return;
    }

    const { user: target, kind } = confirmState;
    setIsMutating(true);
    setActionError(null);

    try {
      if (kind === 'suspend') {
        await updateAdminUserStatus(target.id, 'SUSPENDED');
      } else if (kind === 'deactivate') {
        await updateAdminUserStatus(target.id, 'DEACTIVATED');
      } else if (kind === 'reactivate') {
        await updateAdminUserStatus(target.id, 'ACTIVE');
      } else if (kind === 'promote') {
        await updateAdminUserRole(target.id, 'ADMIN');
      } else {
        await updateAdminUserRole(target.id, 'USER');
      }

      setSuccessMessage(CONFIRM_COPY[kind].success);
      setConfirmState(null);

      if (detail.open && detail.userId) {
        await refreshDetail(detail.userId);
      }

      await fetchUsers({ page, filters });
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsMutating(false);
    }
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);
  const hasActiveFilters =
    filters.search !== '' || filters.role !== '' || filters.status !== '';
  const showInitialLoading = isLoading && !hasLoadedOnce.current;

  const confirmCopy = confirmState ? CONFIRM_COPY[confirmState.kind] : null;

  const renderStatusActions = (target: AdminUser) => {
    const isSelf = authUser?.id === target.id;

    return (
      <>
        {target.status === 'ACTIVE' && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            data-testid="admin-user-suspend"
            disabled={isMutating || isSelf}
            title={
              isSelf
                ? 'You cannot suspend or deactivate your own account'
                : undefined
            }
            onClick={() => openConfirm(target, 'suspend')}
          >
            Suspend
          </button>
        )}
        {target.status !== 'ACTIVE' && (
          <button
            type="button"
            className="btn-primary btn-sm"
            data-testid="admin-user-activate"
            disabled={isMutating}
            onClick={() => openConfirm(target, 'reactivate')}
          >
            Reactivate
          </button>
        )}
        {target.status !== 'DEACTIVATED' && (
          <button
            type="button"
            className="btn-danger btn-sm"
            data-testid="admin-user-deactivate"
            disabled={isMutating || isSelf}
            title={
              isSelf
                ? 'You cannot suspend or deactivate your own account'
                : undefined
            }
            onClick={() => openConfirm(target, 'deactivate')}
          >
            Deactivate
          </button>
        )}
        <button
          type="button"
          className="btn-ghost btn-sm"
          data-testid="admin-user-role"
          disabled={isMutating || isSelf}
          title={isSelf ? 'You cannot change your own role' : undefined}
          onClick={() =>
            openConfirm(target, target.role === 'ADMIN' ? 'demote' : 'promote')
          }
        >
          {target.role === 'ADMIN' ? 'Remove admin' : 'Make admin'}
        </button>
      </>
    );
  };

  return (
    <div className="page-container">
      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1 flex items-center gap-2">
              <Users className="w-6 h-6" aria-hidden="true" />
              User Management
            </h1>
            <p className="text-text-muted mt-1">
              Search, review and manage user accounts. Operational data only —
              no credentials or financial values.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-2 self-start sm:self-auto"
            onClick={() => void fetchUsers({ page, filters })}
            disabled={isFetching || isLoading}
            data-testid="admin-users-refresh"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 mb-6"
            role="status"
            data-testid="admin-users-success"
          >
            {successMessage}
          </div>
        )}

        {loadError && !showInitialLoading && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="admin-users-error"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{loadError}</span>
              <button
                type="button"
                className="btn-secondary btn-sm self-start sm:self-auto"
                onClick={() => void fetchUsers({ page, filters })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {showInitialLoading && (
          <p className="text-sm text-text-muted" data-testid="admin-users-loading">
            Loading users...
          </p>
        )}

        {!showInitialLoading && (
          <>
            <div className="card mb-6">
              <div className="card-body">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label htmlFor="admin-users-search" className="label">
                      Search
                    </label>
                    <div className="relative">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted"
                        aria-hidden="true"
                      />
                      <input
                        id="admin-users-search"
                        type="search"
                        className="input pl-10"
                        placeholder="Search by name or email"
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        data-testid="admin-users-search"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="admin-users-role" className="label">
                      Role
                    </label>
                    <select
                      id="admin-users-role"
                      className="input"
                      value={filters.role}
                      onChange={(event) =>
                        onFilterChange('role', event.target.value as Role | '')
                      }
                      data-testid="admin-users-role-filter"
                    >
                      <option value="">All roles</option>
                      <option value="USER">USER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-users-status" className="label">
                      Account status
                    </label>
                    <select
                      id="admin-users-status"
                      className="input"
                      value={filters.status}
                      onChange={(event) =>
                        onFilterChange(
                          'status',
                          event.target.value as AccountStatus | ''
                        )
                      }
                      data-testid="admin-users-status-filter"
                    >
                      <option value="">All statuses</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="SUSPENDED">SUSPENDED</option>
                      <option value="DEACTIVATED">DEACTIVATED</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="btn-secondary w-full sm:w-auto inline-flex items-center justify-center gap-2"
                      onClick={clearFilters}
                      disabled={!hasActiveFilters && searchInput === ''}
                      data-testid="admin-users-clear-filters"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                      Clear filters
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {isFetching && (
              <div
                className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted bg-surface border border-border rounded-lg"
                role="status"
                data-testid="admin-users-updating"
              >
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Updating...
              </div>
            )}

            {!loadError && users.length === 0 && (
              <div className="card">
                <div
                  className="card-body text-center py-16"
                  data-testid="admin-users-empty"
                >
                  <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-4">
                    <Users className="w-8 h-8 text-primary" aria-hidden="true" />
                  </div>
                  <h2 className="heading-2 mb-3">No users found</h2>
                  <p className="text-text-muted mb-8 max-w-md mx-auto">
                    No accounts match the current search and filters.
                  </p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            )}

            {!loadError && users.length > 0 && (
              <>
                <div className="hidden md:block card overflow-hidden">
                  <div className="overflow-x-auto" data-testid="admin-users-table">
                    <table className="w-full text-sm">
                      <thead className="bg-background border-b border-border">
                        <tr className="text-left text-text-muted">
                          <th scope="col" className="px-4 py-3 font-medium">
                            User
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Role
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Status
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Created
                          </th>
                          <th
                            scope="col"
                            className="px-4 py-3 font-medium text-right"
                          >
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {users.map((target) => (
                          <tr
                            key={target.id}
                            className="hover:bg-background"
                            data-testid="admin-user-row"
                          >
                            <td className="px-4 py-3">
                              <UserIdentity user={target} />
                            </td>
                            <td className="px-4 py-3">
                              <RoleBadge role={target.role} />
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={target.status} />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                              {formatDate(target.createdAt)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end flex-wrap gap-1">
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  data-testid="admin-user-view"
                                  disabled={isMutating}
                                  onClick={() => void openDetail(target.id)}
                                >
                                  View
                                </button>
                                {renderStatusActions(target)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="md:hidden space-y-3" data-testid="admin-users-table-mobile">
                  {users.map((target) => (
                    <div key={target.id} className="card" data-testid="admin-user-card">
                      <div className="card-body p-4">
                        <div className="flex items-start justify-between gap-3">
                          <UserIdentity user={target} />
                          <div className="flex flex-col items-end gap-1">
                            <RoleBadge role={target.role} />
                            <StatusBadge status={target.status} />
                          </div>
                        </div>
                        <p className="text-xs text-text-muted mt-2">
                          Created {formatDate(target.createdAt)}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            data-testid="admin-user-view"
                            disabled={isMutating}
                            onClick={() => void openDetail(target.id)}
                          >
                            View
                          </button>
                          {renderStatusActions(target)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!loadError && users.length > 0 && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p
                  className="text-sm text-text-muted"
                  aria-live="polite"
                  data-testid="admin-users-showing"
                >
                  Showing {startItem}–{endItem} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1 || isFetching}
                    data-testid="admin-users-prev"
                  >
                    Previous
                  </button>
                  <span
                    className="text-sm text-text-muted px-2"
                    data-testid="admin-users-page-indicator"
                  >
                    Page {page} of {Math.max(totalPages, 1)}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={isFetching || page >= totalPages}
                    data-testid="admin-users-next"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {detail.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="presentation">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!isMutating && !detail.loading) {
                setDetail((prev) => ({ ...prev, open: false }));
              }
            }}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-lg bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6 max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-user-detail-title"
            data-testid="admin-user-detail"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="admin-user-detail-title" className="heading-3">
                User details
              </h2>
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label="Close user details"
                data-testid="admin-user-detail-close"
                disabled={detail.loading}
                onClick={() => setDetail((prev) => ({ ...prev, open: false }))}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {detail.loading && (
              <p className="text-sm text-text-muted" data-testid="admin-user-detail-loading">
                Loading user details...
              </p>
            )}

            {detail.error && (
              <div
                className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                role="alert"
                data-testid="admin-user-detail-error"
              >
                {detail.error}
              </div>
            )}

            {detail.data && (
              <>
                <section className="mb-6" aria-labelledby="admin-user-detail-identity">
                  <h3 id="admin-user-detail-identity" className="heading-4 mb-3">
                    Identity
                  </h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-text-muted">Name</dt>
                      <dd className="text-text font-medium text-right" data-testid="admin-user-detail-name">
                        {detail.data.user.firstName} {detail.data.user.lastName}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-text-muted">Email</dt>
                      <dd className="text-text text-right" data-testid="admin-user-detail-email">
                        {detail.data.user.email}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-text-muted">User ID</dt>
                      <dd className="text-text text-right break-all" data-testid="admin-user-detail-id">
                        {detail.data.user.id}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-text-muted">Created</dt>
                      <dd className="text-text text-right">
                        {formatDate(detail.data.user.createdAt)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-text-muted">Last login</dt>
                      <dd className="text-text text-right">
                        {detail.data.user.lastLoginAt
                          ? formatDate(detail.data.user.lastLoginAt)
                          : 'Never'}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="mb-6" aria-labelledby="admin-user-detail-auth">
                  <h3 id="admin-user-detail-auth" className="heading-4 mb-3">
                    Authorization
                  </h3>
                  <div className="flex items-center gap-3">
                    <RoleBadge role={detail.data.user.role} />
                    <StatusBadge status={detail.data.user.status} />
                  </div>
                </section>

                <section aria-labelledby="admin-user-detail-counts">
                  <h3 id="admin-user-detail-counts" className="heading-4 mb-1">
                    Operational record counts
                  </h3>
                  <p className="text-xs text-text-muted mb-3">
                    Counts only — no financial values are shown.
                  </p>
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 gap-3"
                    data-testid="admin-user-detail-counts"
                  >
                    {(
                      [
                        ['Transactions', detail.data.counts.transactions],
                        ['Goals', detail.data.counts.goals],
                        ['Assets', detail.data.counts.assets],
                        ['Liabilities', detail.data.counts.liabilities],
                        ['Habits', detail.data.counts.habits],
                        ['Challenges', detail.data.counts.challenges],
                      ] as const
                    ).map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-border p-3"
                      >
                        <p className="text-xs text-text-muted">{label}</p>
                        <p
                          className="text-lg font-semibold text-text"
                          data-testid={`admin-user-count-${label.toLowerCase()}`}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      )}

      {confirmState && confirmCopy && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!isMutating) {
                setConfirmState(null);
              }
            }}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="admin-user-confirm-title"
            aria-describedby="admin-user-confirm-description"
            data-testid="admin-user-confirm"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                {confirmState.kind === 'reactivate' ? (
                  <UserCheck className="w-5 h-5 text-primary" aria-hidden="true" />
                ) : confirmState.kind === 'promote' ? (
                  <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
                ) : (
                  <UserX className="w-5 h-5 text-error" aria-hidden="true" />
                )}
              </div>
              <h2 id="admin-user-confirm-title" className="heading-3">
                {confirmCopy.title}
              </h2>
            </div>
            <p
              id="admin-user-confirm-description"
              className="text-sm text-text-muted mb-6"
            >
              {confirmCopy.description} Target account:{' '}
              <span className="font-medium text-text">
                {confirmState.user.firstName} {confirmState.user.lastName} (
                {confirmState.user.email})
              </span>
              .
            </p>

            {actionError && (
              <div
                className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
                role="alert"
                data-testid="admin-user-confirm-error"
              >
                {actionError}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmState(null)}
                disabled={isMutating}
                data-testid="admin-user-confirm-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className={confirmCopy.danger ? 'btn-danger' : 'btn-primary'}
                onClick={() => void runConfirmedAction()}
                disabled={isMutating}
                data-testid="admin-user-confirm-accept"
              >
                {isMutating ? confirmCopy.pending : confirmCopy.action}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
