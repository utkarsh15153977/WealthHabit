import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  Target,
  Repeat,
  Receipt,
  RefreshCw,
  ListChecks,
  Trophy,
  PiggyBank,
  Landmark,
  Scale,
  TrendingUp,
  Settings,
  Search,
  X,
  Plus,
  Trash2,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { getApiErrorMessage } from '../services/error';
import {
  getAdminChallenge,
  listAdminChallenges,
} from '../services/adminChallengesApi';
import { challengeApi } from '../services/challengeApi';
import { formatDate, toDateInputValue } from '../utils/date';
import { CHALLENGE_STATUSES, CHALLENGE_TYPES } from '../types/adminChallenges';
import type {
  AdminChallengeDetail,
  AdminChallengeSummary,
} from '../types/adminChallenges';
import type {
  ChallengeStatus,
  CreateChallengePayload,
} from '../types/challenge';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  type: '' | 'HABIT_COMPLETION';
  status: '' | ChallengeStatus;
  active: '' | 'true' | 'false';
}

const EMPTY_FILTERS: Filters = { type: '', status: '', active: '' };

const requirementFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be at most 500 characters'),
  frequency: z.enum(FREQUENCIES, {
    errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY or MONTHLY' }),
  }),
  target: z
    .number({ invalid_type_error: 'Target is required' })
    .int('Target must be an integer')
    .min(1, 'Target must be at least 1')
    .max(100, 'Target must be at most 100'),
  unit: z.string().trim().max(30, 'Unit must be at most 30 characters'),
});

const challengeFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters'),
    description: z
      .string()
      .trim()
      .max(1000, 'Description must be at most 1000 characters'),
    category: z
      .string()
      .trim()
      .max(50, 'Category must be at most 50 characters'),
    difficulty: z.enum(DIFFICULTIES, {
      errorMap: () => ({ message: 'Difficulty must be EASY, MEDIUM or HARD' }),
    }),
    points: z
      .number({ invalid_type_error: 'Points are required' })
      .int('Points must be an integer')
      .min(0, 'Points must be at least 0')
      .max(1000000, 'Points must be at most 1000000'),
    startDate: z
      .string()
      .min(1, 'Start date is required')
      .regex(ISO_DAY_PATTERN, 'Invalid date'),
    endDate: z
      .string()
      .min(1, 'End date is required')
      .regex(ISO_DAY_PATTERN, 'Invalid date'),
    isActive: z.boolean(),
    requirements: z
      .array(requirementFormSchema)
      .min(1, 'At least one requirement is required')
      .max(10, 'A challenge must have at most 10 requirements'),
  })
  .superRefine((values, ctx) => {
    if (
      ISO_DAY_PATTERN.test(values.startDate) &&
      ISO_DAY_PATTERN.test(values.endDate) &&
      values.endDate < values.startDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date must be on or after start date',
        path: ['endDate'],
      });
    }
  });

type ChallengeFormValues = z.infer<typeof challengeFormSchema>;

const EMPTY_REQUIREMENT: ChallengeFormValues['requirements'][number] = {
  name: '',
  description: '',
  frequency: 'DAILY',
  target: 1,
  unit: '',
};

function statusBadgeClass(status: ChallengeStatus): string {
  if (status === 'ACTIVE') {
    return 'badge badge-success';
  }
  if (status === 'UPCOMING') {
    return 'badge badge-info';
  }
  return 'badge badge-warning';
}

function buildCreatePayload(
  values: ChallengeFormValues
): CreateChallengePayload {
  return {
    name: values.name,
    description: values.description.trim() || undefined,
    category: values.category.trim() || undefined,
    difficulty: values.difficulty,
    points: values.points,
    startDate: values.startDate,
    endDate: values.endDate,
    requirements: values.requirements.map((requirement) => ({
      name: requirement.name,
      description: requirement.description.trim() || undefined,
      frequency: requirement.frequency,
      target: requirement.target,
      unit: requirement.unit.trim() || undefined,
    })),
  };
}

export function AdminChallenges() {
  const { user: authUser, logout } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [challenges, setChallenges] = useState<AdminChallengeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<
    { mode: 'create' } | { mode: 'edit'; summary: AdminChallengeSummary } | null
  >(null);
  const [deleteTarget, setDeleteTarget] =
    useState<AdminChallengeSummary | null>(null);
  const hasLoadedOnce = useRef(false);

  const fetchChallenges = useCallback(
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
        const data = await listAdminChallenges({
          page: requestedPage,
          pageSize: PAGE_SIZE,
          search: requestedSearch || undefined,
          type: requestedFilters.type || undefined,
          status: requestedFilters.status || undefined,
          active:
            requestedFilters.active === ''
              ? undefined
              : requestedFilters.active === 'true',
          dateFrom: undefined,
          dateTo: undefined,
        });
        hasLoadedOnce.current = true;
        setChallenges(data.challenges);
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
    void fetchChallenges({ page, filters, search, initial: !hasLoadedOnce.current });
  }, [page, filters, search, fetchChallenges]);

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

  const refresh = () => {
    void fetchChallenges({ page, filters, search });
  };

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

  const afterMutation = () => {
    setFormTarget(null);
    setDeleteTarget(null);
    setDetailId(null);
    void fetchChallenges({ page, filters, search });
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);
  const hasActiveFilters =
    search !== '' ||
    filters.type !== '' ||
    filters.status !== '' ||
    filters.active !== '';
  const showInitialLoading = isLoading && !hasLoadedOnce.current;

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Admin', href: '/admin', icon: LayoutDashboard, current: false },
    { name: 'Admin Users', href: '/admin/users', icon: Users, current: false },
    {
      name: 'Admin Challenges',
      href: '/admin/challenges',
      icon: Trophy,
      current: true,
    },
    { name: 'Audit Logs', href: '/admin/audit-logs', icon: FileText, current: false },
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
              <Trophy className="w-6 h-6" aria-hidden="true" />
              Challenge Administration
            </h1>
            <p className="text-text-muted mt-1">
              Create, edit, activate and delete challenges. Progress and
              participant completion are always derived from real habit data —
              never edited here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              className="btn-primary btn-sm inline-flex items-center gap-2"
              onClick={() => setFormTarget({ mode: 'create' })}
              data-testid="admin-challenges-create"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Create challenge
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm inline-flex items-center gap-2"
              onClick={refresh}
              disabled={isFetching || isLoading}
              data-testid="admin-challenges-refresh"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              {isFetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {loadError && !showInitialLoading && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="admin-challenges-error"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{loadError}</span>
              <button
                type="button"
                className="btn-secondary btn-sm self-start sm:self-auto"
                onClick={refresh}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {showInitialLoading && (
          <p className="text-sm text-text-muted" data-testid="admin-challenges-loading">
            Loading challenges...
          </p>
        )}

        {!showInitialLoading && (
          <>
            <div className="card mb-6">
              <div className="card-body">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="admin-challenges-search" className="label">
                      Search
                    </label>
                    <div className="relative">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted"
                        aria-hidden="true"
                      />
                      <input
                        id="admin-challenges-search"
                        type="search"
                        className="input pl-10"
                        placeholder="Name, description or category"
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        data-testid="admin-challenges-search"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="admin-challenges-type" className="label">
                      Type
                    </label>
                    <select
                      id="admin-challenges-type"
                      className="input"
                      value={draft.type}
                      onChange={(event) =>
                        onDraftChange(
                          'type',
                          event.target.value as Filters['type']
                        )
                      }
                      data-testid="admin-challenges-type-filter"
                    >
                      <option value="">All types</option>
                      {CHALLENGE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-challenges-status" className="label">
                      Status
                    </label>
                    <select
                      id="admin-challenges-status"
                      className="input"
                      value={draft.status}
                      onChange={(event) =>
                        onDraftChange(
                          'status',
                          event.target.value as Filters['status']
                        )
                      }
                      data-testid="admin-challenges-status-filter"
                    >
                      <option value="">All statuses</option>
                      {CHALLENGE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-challenges-active" className="label">
                      Active
                    </label>
                    <select
                      id="admin-challenges-active"
                      className="input"
                      value={draft.active}
                      onChange={(event) =>
                        onDraftChange(
                          'active',
                          event.target.value as Filters['active']
                        )
                      }
                      data-testid="admin-challenges-active-filter"
                    >
                      <option value="">Any</option>
                      <option value="true">Active only</option>
                      <option value="false">Inactive only</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2"
                      onClick={applyFilters}
                      data-testid="admin-challenges-apply"
                    >
                      Apply filters
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full sm:w-auto inline-flex items-center justify-center gap-2"
                      onClick={clearFilters}
                      disabled={!hasActiveFilters && searchInput === ''}
                      data-testid="admin-challenges-clear-filters"
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
                data-testid="admin-challenges-updating"
              >
                <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Updating...
              </div>
            )}

            {!loadError && challenges.length === 0 && hasActiveFilters && (
              <div className="card">
                <div
                  className="card-body text-center py-16"
                  data-testid="admin-challenges-no-results"
                >
                  <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-primary" aria-hidden="true" />
                  </div>
                  <h2 className="heading-2 mb-3">No matching challenges</h2>
                  <p className="text-text-muted mb-8 max-w-md mx-auto">
                    No challenges match the current search and filters.
                  </p>
                  <button type="button" className="btn-secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              </div>
            )}

            {!loadError && challenges.length === 0 && !hasActiveFilters && (
              <div className="card">
                <div className="card-body text-center py-16" data-testid="admin-challenges-empty">
                  <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-4">
                    <Trophy className="w-8 h-8 text-primary" aria-hidden="true" />
                  </div>
                  <h2 className="heading-2 mb-3">No challenges yet</h2>
                  <p className="text-text-muted mb-8 max-w-md mx-auto">
                    Create the first challenge to let users compete by
                    completing their habits.
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setFormTarget({ mode: 'create' })}
                  >
                    Create challenge
                  </button>
                </div>
              </div>
            )}

            {!loadError && challenges.length > 0 && (
              <>
                <div className="hidden md:block card overflow-hidden">
                  <div className="overflow-x-auto" data-testid="admin-challenges-table">
                    <table className="w-full text-sm">
                      <thead className="bg-background border-b border-border">
                        <tr className="text-left text-text-muted">
                          <th scope="col" className="px-4 py-3 font-medium">
                            Challenge
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Type
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Start
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            End
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Status
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Active
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Participants
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
                        {challenges.map((challenge) => (
                          <tr
                            key={challenge.id}
                            className="hover:bg-background"
                            data-testid="admin-challenges-row"
                          >
                            <td className="px-4 py-3">
                              <p className="font-medium text-text" data-testid="admin-challenges-row-name">
                                {challenge.name}
                              </p>
                              <p className="text-xs text-text-muted">
                                {challenge.category} · {challenge.requirementCount}{' '}
                                {challenge.requirementCount === 1
                                  ? 'requirement'
                                  : 'requirements'}
                              </p>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                              {challenge.type}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                              {formatDate(challenge.startDate)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                              {formatDate(challenge.endDate)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={statusBadgeClass(challenge.status)}
                                data-testid="admin-challenges-row-status"
                              >
                                {challenge.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={
                                  challenge.isActive
                                    ? 'badge badge-success'
                                    : 'badge badge-error'
                                }
                                data-testid="admin-challenges-row-active"
                              >
                                {challenge.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                              {challenge.participants.total}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  onClick={() => setDetailId(challenge.id)}
                                  data-testid="admin-challenges-view"
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  onClick={() =>
                                    setFormTarget({ mode: 'edit', summary: challenge })
                                  }
                                  data-testid="admin-challenges-edit"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm text-error"
                                  onClick={() => setDeleteTarget(challenge)}
                                  data-testid="admin-challenges-delete"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="md:hidden space-y-3" data-testid="admin-challenges-table-mobile">
                  {challenges.map((challenge) => (
                    <div
                      key={challenge.id}
                      className="card"
                      data-testid="admin-challenges-card"
                    >
                      <div className="card-body">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-text truncate">
                              {challenge.name}
                            </p>
                            <p className="text-xs text-text-muted">
                              {challenge.type}
                            </p>
                          </div>
                          <span
                            className={statusBadgeClass(challenge.status)}
                            data-testid="admin-challenges-row-status"
                          >
                            {challenge.status}
                          </span>
                        </div>
                        <p className="text-xs text-text-muted">
                          {formatDate(challenge.startDate)} –{' '}
                          {formatDate(challenge.endDate)}
                        </p>
                        <p className="text-xs text-text-muted" data-testid="admin-challenges-card-participants">
                          {challenge.participants.total} participants ·{' '}
                          {challenge.isActive ? 'Active' : 'Inactive'}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            className="btn-secondary btn-sm flex-1"
                            onClick={() => setDetailId(challenge.id)}
                            data-testid="admin-challenges-view"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm flex-1"
                            onClick={() =>
                              setFormTarget({ mode: 'edit', summary: challenge })
                            }
                            data-testid="admin-challenges-edit"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-danger btn-sm flex-1"
                            onClick={() => setDeleteTarget(challenge)}
                            data-testid="admin-challenges-delete"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!loadError && challenges.length > 0 && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p
                  className="text-sm text-text-muted"
                  aria-live="polite"
                  data-testid="admin-challenges-showing"
                >
                  Showing {startItem}–{endItem} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1 || isFetching}
                    data-testid="admin-challenges-prev"
                  >
                    Previous
                  </button>
                  <span
                    className="text-sm text-text-muted px-2"
                    data-testid="admin-challenges-page-indicator"
                  >
                    Page {page} of {Math.max(totalPages, 1)}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={isFetching || page >= totalPages}
                    data-testid="admin-challenges-next"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {detailId && (
        <ChallengeDetailDialog
          challengeId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(summary) => {
            setDetailId(null);
            setFormTarget({ mode: 'edit', summary });
          }}
          onDelete={(summary) => {
            setDetailId(null);
            setDeleteTarget(summary);
          }}
        />
      )}

      {formTarget && formTarget.mode === 'create' && (
        <ChallengeFormDialog mode="create" onClose={() => setFormTarget(null)} onSaved={afterMutation} />
      )}

      {formTarget && formTarget.mode === 'edit' && (
        <ChallengeFormDialog
          mode="edit"
          summary={formTarget.summary}
          onClose={() => setFormTarget(null)}
          onSaved={afterMutation}
        />
      )}

      {deleteTarget && (
        <DeleteChallengeDialog
          challenge={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={afterMutation}
        />
      )}
    </div>
  );
}

function ChallengeDetailDialog({
  challengeId,
  onClose,
  onEdit,
  onDelete,
}: {
  challengeId: string;
  onClose: () => void;
  onEdit: (summary: AdminChallengeSummary) => void;
  onDelete: (summary: AdminChallengeSummary) => void;
}) {
  const [detail, setDetail] = useState<AdminChallengeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getAdminChallenge(challengeId);
      setDetail(data.challenge);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    }
  }, [challengeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const summaryLike: AdminChallengeSummary | null = detail
    ? {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        category: detail.category,
        difficulty: detail.difficulty,
        points: detail.points,
        type: detail.type,
        startDate: detail.startDate,
        endDate: detail.endDate,
        isActive: detail.isActive,
        status: detail.status,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        requirementCount: detail.requirementCount,
        participants: { total: detail.participants.total },
      }
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative w-full sm:max-w-xl bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-challenge-detail-title"
        data-testid="admin-challenges-detail"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="admin-challenge-detail-title" className="heading-3">
            Challenge details
          </h2>
          <button
            type="button"
            className="btn-ghost p-2"
            aria-label="Close challenge details"
            data-testid="admin-challenges-detail-close"
            onClick={onClose}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
            role="alert"
            data-testid="admin-challenges-detail-error"
          >
            <div className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setIsReloading(true);
                  void load().finally(() => setIsReloading(false));
                }}
              >
                {isReloading ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          </div>
        )}

        {!error && !detail && (
          <p className="text-sm text-text-muted" data-testid="admin-challenges-detail-loading">
            Loading challenge...
          </p>
        )}

        {!error && detail && (
          <>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Name</dt>
                <dd
                  className="text-text font-medium text-right break-all"
                  data-testid="admin-challenges-detail-name"
                >
                  {detail.name}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Description</dt>
                <dd className="text-text text-right break-words" data-testid="admin-challenges-detail-description">
                  {detail.description || '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Type</dt>
                <dd className="text-text text-right" data-testid="admin-challenges-detail-type">
                  {detail.type}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Category</dt>
                <dd className="text-text text-right">{detail.category}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Difficulty</dt>
                <dd className="text-text text-right">{detail.difficulty}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Points</dt>
                <dd className="text-text text-right">{detail.points}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Period</dt>
                <dd className="text-text text-right" data-testid="admin-challenges-detail-period">
                  {formatDate(detail.startDate)} – {formatDate(detail.endDate)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Status</dt>
                <dd className="text-right" data-testid="admin-challenges-detail-status">
                  <span className={statusBadgeClass(detail.status)}>
                    {detail.status}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Activation</dt>
                <dd className="text-right" data-testid="admin-challenges-detail-active">
                  <span
                    className={
                      detail.isActive ? 'badge badge-success' : 'badge badge-error'
                    }
                  >
                    {detail.isActive ? 'Active' : 'Inactive'}
                  </span>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">Participants</dt>
                <dd
                  className="text-text text-right"
                  data-testid="admin-challenges-detail-participants"
                >
                  {detail.participants.total} joined ·{' '}
                  {detail.participants.completed} completed
                </dd>
              </div>
            </dl>

            <section
              className="mt-5"
              aria-labelledby="admin-challenge-detail-requirements-heading"
            >
              <h3
                id="admin-challenge-detail-requirements-heading"
                className="heading-4 mb-2"
              >
                Requirements ({detail.requirements.length})
              </h3>
              <div
                className="rounded-lg border border-border overflow-hidden"
                data-testid="admin-challenges-detail-requirements"
              >
                <table className="w-full text-sm">
                  <thead className="bg-background border-b border-border">
                    <tr className="text-left text-text-muted">
                      <th scope="col" className="px-3 py-2 font-medium">
                        Requirement
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Frequency
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Target
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Mapped
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.requirements.map((requirement) => (
                      <tr key={requirement.id} data-testid="admin-challenges-requirement-row">
                        <td className="px-3 py-2">
                          <span className="text-text">{requirement.name}</span>
                          {requirement.unit ? (
                            <span className="block text-xs text-text-muted">
                              unit: {requirement.unit}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {requirement.frequency}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {requirement.target}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {requirement.mappedParticipants}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-text-muted mt-2">
                Requirements are configured when the challenge is created and
                cannot be changed afterwards. Completion is derived from real
                habit completions only.
              </p>
            </section>

            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                data-testid="admin-challenges-detail-dismiss"
              >
                Close
              </button>
              <button
                type="button"
                className="btn-secondary inline-flex items-center justify-center gap-2"
                onClick={() => summaryLike && onEdit(summaryLike)}
                data-testid="admin-challenges-detail-edit"
              >
                Edit
              </button>
              <button
                type="button"
                className="btn-danger inline-flex items-center justify-center gap-2"
                onClick={() => summaryLike && onDelete(summaryLike)}
                data-testid="admin-challenges-detail-delete"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChallengeFormDialog({
  mode,
  summary,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  summary?: AdminChallengeSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<AdminChallengeDetail | null>(
    mode === 'edit' ? null : null
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !summary) {
      return;
    }
    let cancelled = false;
    void getAdminChallenge(summary.id)
      .then((data) => {
        if (!cancelled) {
          setDetail(data.challenge);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(getApiErrorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, summary]);

  if (mode === 'edit' && loadError) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        role="presentation"
      >
        <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
        <div
          className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
          role="dialog"
          aria-modal="true"
          data-testid="admin-challenges-form"
        >
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
            role="alert"
            data-testid="admin-challenges-form-load-error"
          >
            {loadError}
          </div>
          <button type="button" className="btn-secondary w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'edit' && !detail) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        role="presentation"
      >
        <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
        <div
          className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
          role="dialog"
          aria-modal="true"
          data-testid="admin-challenges-form"
        >
          <p className="text-sm text-text-muted" data-testid="admin-challenges-form-loading">
            Loading challenge...
          </p>
        </div>
      </div>
    );
  }

  return (
    <ChallengeForm
      key={mode === 'edit' && detail ? detail.id : 'create'}
      mode={mode}
      detail={detail}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function ChallengeForm({
  mode,
  detail,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  detail: AdminChallengeDetail | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaultValues: ChallengeFormValues =
    mode === 'edit' && detail
      ? {
          name: detail.name,
          description: detail.description,
          category: detail.category,
          difficulty: detail.difficulty,
          points: detail.points,
          startDate: toDateInputValue(detail.startDate),
          endDate: toDateInputValue(detail.endDate),
          isActive: detail.isActive,
          requirements: detail.requirements.map((requirement) => ({
            name: requirement.name,
            description: requirement.description ?? '',
            frequency: requirement.frequency,
            target: requirement.target,
            unit: requirement.unit ?? '',
          })),
        }
      : {
          name: '',
          description: '',
          category: '',
          difficulty: 'MEDIUM',
          points: 0,
          startDate: '',
          endDate: '',
          isActive: true,
          requirements: [{ ...EMPTY_REQUIREMENT }],
        };

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ChallengeFormValues>({
    resolver: zodResolver(challengeFormSchema),
    defaultValues,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'requirements',
  });

  const onSubmit = async (values: ChallengeFormValues) => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        await challengeApi.createChallenge(buildCreatePayload(values));
      } else if (detail) {
        await challengeApi.updateChallenge(detail.id, {
          name: values.name,
          description: values.description.trim() || undefined,
          category: values.category.trim() || undefined,
          difficulty: values.difficulty,
          points: values.points,
          startDate: values.startDate,
          endDate: values.endDate,
          isActive: values.isActive,
        });
      }
      onSaved();
    } catch (error) {
      setSubmitError(getApiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldError = (name: string): string | undefined => {
    const root = errors as Record<string, { message?: string } | undefined>;
    return root[name]?.message;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !isSubmitting && onClose()}
        aria-hidden="true"
      />
      <div
        className="relative w-full sm:max-w-2xl bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-challenge-form-title"
        data-testid="admin-challenges-form"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="admin-challenge-form-title" className="heading-3">
            {mode === 'create' ? 'Create challenge' : 'Edit challenge'}
          </h2>
          <button
            type="button"
            className="btn-ghost p-2"
            aria-label="Close challenge form"
            data-testid="admin-challenges-form-close"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {submitError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
            role="alert"
            data-testid="admin-challenges-form-error"
          >
            {submitError}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit(onSubmit)(event);
          }}
          noValidate
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="challenge-name" className="label">
                Name
              </label>
              <input
                id="challenge-name"
                type="text"
                className="input"
                autoComplete="off"
                {...register('name')}
                data-testid="admin-challenges-form-name"
              />
              {fieldError('name') && (
                <p className="text-xs text-error mt-1" role="alert">
                  {fieldError('name')}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="challenge-description" className="label">
                Description
              </label>
              <textarea
                id="challenge-description"
                className="input min-h-[80px]"
                {...register('description')}
                data-testid="admin-challenges-form-description"
              />
              {fieldError('description') && (
                <p className="text-xs text-error mt-1" role="alert">
                  {fieldError('description')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="challenge-category" className="label">
                Category
              </label>
              <input
                id="challenge-category"
                type="text"
                placeholder="general"
                className="input"
                {...register('category')}
                data-testid="admin-challenges-form-category"
              />
              {fieldError('category') && (
                <p className="text-xs text-error mt-1" role="alert">
                  {fieldError('category')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="challenge-difficulty" className="label">
                Difficulty
              </label>
              <select
                id="challenge-difficulty"
                className="input"
                {...register('difficulty')}
                data-testid="admin-challenges-form-difficulty"
              >
                <option value="EASY">EASY</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HARD">HARD</option>
              </select>
              {fieldError('difficulty') && (
                <p className="text-xs text-error mt-1" role="alert">
                  {fieldError('difficulty')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="challenge-points" className="label">
                Points
              </label>
              <input
                id="challenge-points"
                type="number"
                className="input"
                {...register('points', { valueAsNumber: true })}
                data-testid="admin-challenges-form-points"
              />
              {fieldError('points') && (
                <p className="text-xs text-error mt-1" role="alert">
                  {fieldError('points')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="challenge-active" className="label">
                Activation
              </label>
              {mode === 'edit' ? (
                <label className="flex items-center gap-2 text-sm text-text h-[42px] px-3 rounded-lg border border-border bg-background">
                  <input
                    type="checkbox"
                    {...register('isActive')}
                    data-testid="admin-challenges-form-active"
                  />
                  Active (users can join while the window is live)
                </label>
              ) : (
                <p
                  className="text-sm text-text-muted h-[42px] flex items-center px-3 rounded-lg border border-border bg-background"
                  data-testid="admin-challenges-form-active-readonly"
                >
                  Active by default
                </p>
              )}
            </div>

            <div>
              <label htmlFor="challenge-start" className="label">
                Start date
              </label>
              <input
                id="challenge-start"
                type="date"
                className="input"
                {...register('startDate')}
                data-testid="admin-challenges-form-start"
              />
              {fieldError('startDate') && (
                <p className="text-xs text-error mt-1" role="alert">
                  {fieldError('startDate')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="challenge-end" className="label">
                End date
              </label>
              <input
                id="challenge-end"
                type="date"
                className="input"
                {...register('endDate')}
                data-testid="admin-challenges-form-end"
              />
              {fieldError('endDate') && (
                <p className="text-xs text-error mt-1" role="alert">
                  {fieldError('endDate')}
                </p>
              )}
            </div>
          </div>

          <section className="mt-6" aria-labelledby="challenge-requirements-heading">
            <div className="flex items-center justify-between mb-2">
              <h3 id="challenge-requirements-heading" className="heading-4">
                Requirements
              </h3>
              {mode === 'create' && (
                <button
                  type="button"
                  className="btn-secondary btn-sm inline-flex items-center gap-2"
                  onClick={() => append({ ...EMPTY_REQUIREMENT })}
                  disabled={fields.length >= 10}
                  data-testid="admin-challenges-add-requirement"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add requirement
                </button>
              )}
            </div>

            {mode === 'edit' && (
              <p className="text-xs text-text-muted mb-3">
                Requirements are fixed after creation and shown read-only in
                the challenge details view.
              </p>
            )}

            {mode === 'create' && (
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="rounded-lg border border-border p-4"
                    data-testid="admin-challenges-requirement"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-text">
                        Requirement {index + 1}
                      </span>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-error inline-flex items-center gap-1"
                        onClick={() => remove(index)}
                        disabled={fields.length <= 1}
                        data-testid="admin-challenges-remove-requirement"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className="label">Name</label>
                        <input
                          type="text"
                          className="input"
                          {...register(`requirements.${index}.name`)}
                          data-testid="admin-challenges-requirement-name"
                        />
                        {errors.requirements?.[index]?.name && (
                          <p className="text-xs text-error mt-1" role="alert">
                            {errors.requirements[index]?.name?.message}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="label">Frequency</label>
                        <select
                          className="input"
                          {...register(`requirements.${index}.frequency`)}
                          data-testid="admin-challenges-requirement-frequency"
                        >
                          <option value="DAILY">DAILY</option>
                          <option value="WEEKLY">WEEKLY</option>
                          <option value="MONTHLY">MONTHLY</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Target</label>
                        <input
                          type="number"
                          className="input"
                          {...register(`requirements.${index}.target`, {
                            valueAsNumber: true,
                          })}
                          data-testid="admin-challenges-requirement-target"
                        />
                        {errors.requirements?.[index]?.target && (
                          <p className="text-xs text-error mt-1" role="alert">
                            {errors.requirements[index]?.target?.message}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="label">Unit</label>
                        <input
                          type="text"
                          className="input"
                          placeholder="times"
                          {...register(`requirements.${index}.unit`)}
                        />
                      </div>
                      <div>
                        <label className="label">Description</label>
                        <input
                          type="text"
                          className="input"
                          {...register(`requirements.${index}.description`)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {errors.requirements?.message && (
                  <p className="text-xs text-error" role="alert">
                    {errors.requirements.message}
                  </p>
                )}
              </div>
            )}
          </section>

          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="admin-challenges-form-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
              data-testid="admin-challenges-form-submit"
            >
              {isSubmitting
                ? 'Saving...'
                : mode === 'create'
                  ? 'Create challenge'
                  : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteChallengeDialog({
  challenge,
  onClose,
  onDeleted,
}: {
  challenge: AdminChallengeSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    setError(null);
    setIsDeleting(true);
    try {
      await challengeApi.deleteChallenge(challenge.id);
      onDeleted();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !isDeleting && onClose()}
        aria-hidden="true"
      />
      <div
        className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-challenge-delete-title"
        aria-describedby="admin-challenge-delete-description"
        data-testid="admin-challenges-confirm"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
          </div>
          <h2 id="admin-challenge-delete-title" className="heading-3">
            Delete challenge?
          </h2>
        </div>
        <p
          id="admin-challenge-delete-description"
          className="text-sm text-text-muted mb-6"
        >
          <span className="font-medium text-text">{challenge.name}</span> and
          its requirements, participants and requirement→habit mappings will be
          removed permanently ({challenge.participants.total} participant
          records). Users keep their habits and habit completions — no
          financial data is deleted.
        </p>
        {error && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
            role="alert"
            data-testid="admin-challenges-confirm-error"
          >
            {error}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isDeleting}
            data-testid="admin-challenges-confirm-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => void confirmDelete()}
            disabled={isDeleting}
            data-testid="admin-challenges-confirm-accept"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
