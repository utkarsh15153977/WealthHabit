import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarCheck,
  CheckCircle2,
  Circle,
  CreditCard,
  Flame,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Settings,
  Target,
  TrendingUp,
  Trash2,
  X,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { habitApi } from '../services/habitApi';
import { formatDate, toDateInputValue, todayForDateInput } from '../utils/date';
import type {
  Habit,
  HabitFrequency,
  HabitProgressHistoryItem,
  HabitWithProgress,
} from '../types/habit';

const PAGE_SIZE = 10;
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const habitSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters'),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be at most 500 characters')
      .optional(),
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY'], {
      errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY or MONTHLY' }),
    }),
    target: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || MONEY_PATTERN.test(value),
        'Target must be a positive number with up to 2 decimal places'
      )
      .optional(),
    unit: z
      .string()
      .trim()
      .max(30, 'Unit must be at most 30 characters')
      .optional(),
    startDate: z
      .string()
      .refine((value) => DATE_PATTERN.test(value), 'Start date is required'),
    endDate: z
      .string()
      .refine(
        (value) => value === '' || DATE_PATTERN.test(value),
        'End date must be a valid date'
      )
      .optional(),
  })
  .strict()
  .refine(
    (form) =>
      !form.endDate ||
      form.endDate === '' ||
      form.endDate >= form.startDate,
    { message: 'End date must be on or after start date', path: ['endDate'] }
  );

type HabitForm = z.infer<typeof habitSchema>;

const FREQUENCY_LABELS: Record<HabitFrequency, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

function emptyFormValues(): HabitForm {
  return {
    name: '',
    description: '',
    frequency: 'DAILY',
    target: '',
    unit: '',
    startDate: todayForDateInput(),
    endDate: '',
  };
}

function toFormValues(habit: Habit): HabitForm {
  return {
    name: habit.name,
    description: habit.description ?? '',
    frequency: habit.frequency,
    target: habit.target !== null ? String(habit.target) : '',
    unit: habit.unit ?? '',
    startDate: toDateInputValue(habit.startDate),
    endDate: habit.endDate ? toDateInputValue(habit.endDate) : '',
  };
}

function describePeriod(habit: HabitWithProgress): string {
  if (!habit.progress) return '';
  return habit.progress.currentPeriod.completed
    ? habit.frequency === 'DAILY'
      ? 'Completed today'
      : 'Completed this period'
    : habit.frequency === 'DAILY'
      ? 'Due today'
      : 'Due this period';
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatPeriodLabel(frequency: HabitFrequency, period: string): string {
  if (frequency === 'MONTHLY') {
    const [year, month] = period.split('-');
    return `${MONTH_LONG[Number(month) - 1]} ${year}`;
  }
  const [, month, day] = period.split('-');
  const label = `${MONTH_SHORT[Number(month) - 1]} ${Number(day)}`;
  return frequency === 'WEEKLY' ? `Week of ${label}` : label;
}

export function Habits() {
  const { user, logout } = useAuth();

  const [activeHabits, setActiveHabits] = useState<HabitWithProgress[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pausedHabits, setPausedHabits] = useState<HabitWithProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const [historyTarget, setHistoryTarget] = useState<Habit | null>(null);
  const [historyStatus, setHistoryStatus] = useState<
    'idle' | 'loading' | 'error' | 'loaded'
  >('idle');
  const [historyItems, setHistoryItems] = useState<HabitProgressHistoryItem[]>(
    []
  );
  const [historyError, setHistoryError] = useState<string | null>(null);

  const requestIdRef = useState(() => ({ current: 0 }))[0];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HabitForm>({
    resolver: zodResolver(habitSchema),
    defaultValues: emptyFormValues(),
  });

  const fetchHabits = useCallback(
    async (options: { initial?: boolean } = {}) => {
      const { initial = false } = options;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const [activeResult, pausedResult] = await Promise.all([
          habitApi.getHabits({
            page,
            pageSize: PAGE_SIZE,
            active: true,
            includeProgress: true,
          }),
          habitApi.getHabits({
            pageSize: 50,
            active: false,
            includeProgress: true,
          }),
        ]);

        if (requestId !== requestIdRef.current) return;

        setActiveHabits(activeResult.habits);
        setActiveTotal(activeResult.total);
        setPausedHabits(pausedResult.habits);
        setHasLoadedOnce(true);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setActiveHabits([]);
        setPausedHabits([]);
        setLoadError(getApiErrorMessage(error));
      } finally {
        if (requestId === requestIdRef.current) {
          if (initial) {
            setIsLoading(false);
          } else {
            setIsFetching(false);
          }
        }
      }
    },
    [page, requestIdRef]
  );

  useEffect(() => {
    void fetchHabits({ initial: !hasLoadedOnce });
  }, [fetchHabits, hasLoadedOnce]);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingHabit(null);
    setActionError(null);
    reset(emptyFormValues());
  }, [reset]);

  const openCreateForm = useCallback(() => {
    setEditingHabit(null);
    setActionError(null);
    setSuccessMessage(null);
    reset(emptyFormValues());
    setIsFormOpen(true);
  }, [reset]);

  const openEditForm = useCallback(
    (habit: Habit) => {
      setEditingHabit(habit);
      setActionError(null);
      setSuccessMessage(null);
      reset(toFormValues(habit));
      setIsFormOpen(true);
    },
    [reset]
  );

  const fetchHistory = useCallback(async (habit: Habit) => {
    setHistoryStatus('loading');
    setHistoryError(null);
    try {
      const result = await habitApi.getHabitProgressHistory(habit.id, {
        page: 1,
        pageSize: 12,
      });
      setHistoryItems(result.items);
      setHistoryStatus('loaded');
    } catch (error) {
      setHistoryItems([]);
      setHistoryError(getApiErrorMessage(error));
      setHistoryStatus('error');
    }
  }, []);

  const openHistory = useCallback(
    (habit: Habit) => {
      setActionError(null);
      setSuccessMessage(null);
      setHistoryTarget(habit);
      void fetchHistory(habit);
    },
    [fetchHistory]
  );

  const closeHistory = useCallback(() => {
    setHistoryTarget(null);
    setHistoryItems([]);
    setHistoryError(null);
    setHistoryStatus('idle');
  }, []);

  useEffect(() => {
    if (!isFormOpen && !deleteTarget && !historyTarget) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (deleteTarget) {
          setDeleteTarget(null);
        } else if (historyTarget) {
          closeHistory();
        } else {
          closeForm();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFormOpen, deleteTarget, historyTarget, closeForm, closeHistory]);

  const onSubmit = async (form: HabitForm) => {
    setActionError(null);
    setSuccessMessage(null);

    const payload = {
      name: form.name.trim(),
      description: form.description ? form.description.trim() : null,
      frequency: form.frequency,
      target: form.target ? form.target.trim() : null,
      unit: form.unit ? form.unit.trim() : null,
      startDate: form.startDate,
      endDate: form.endDate ? form.endDate : null,
    };

    try {
      if (editingHabit) {
        await habitApi.updateHabit(editingHabit.id, payload);
        setSuccessMessage('Habit updated successfully');
      } else {
        await habitApi.createHabit(payload);
        setSuccessMessage('Habit created successfully');
      }

      closeForm();
      await fetchHabits();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const handleComplete = async (habit: HabitWithProgress) => {
    setActionError(null);
    setSuccessMessage(null);
    setCompletingId(habit.id);

    try {
      const result = await habitApi.completeHabit(habit.id);
      setSuccessMessage(
        result.alreadyCompleted
          ? `"${habit.name}" is already completed for this period`
          : `"${habit.name}" completed`
      );
      await fetchHabits();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setCompletingId(null);
    }
  };

  const handleToggleActive = async (habit: Habit) => {
    setActionError(null);
    setSuccessMessage(null);

    try {
      await habitApi.updateHabit(habit.id, { isActive: !habit.isActive });
      setSuccessMessage(
        habit.isActive
          ? `"${habit.name}" paused`
          : `"${habit.name}" resumed`
      );
      await fetchHabits();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setActionError(null);

    try {
      await habitApi.deleteHabit(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage('Habit deleted successfully');
      await fetchHabits();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(activeTotal / PAGE_SIZE));
  const showEmpty =
    hasLoadedOnce &&
    !isLoading &&
    !loadError &&
    activeHabits.length === 0 &&
    pausedHabits.length === 0;

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Habits', href: '/habits', icon: ListChecks, current: true },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  const renderHabitCard = (habit: HabitWithProgress) => {
    const isCompleting = completingId === habit.id;
    const periodCompleted = habit.progress?.currentPeriod.completed ?? false;

    return (
      <div key={habit.id} className="card" data-testid={`habit-card-${habit.name}`}>
        <div className="card-body">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="heading-4 truncate">{habit.name}</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {FREQUENCY_LABELS[habit.frequency]}
                {habit.unit ? ` · target ${habit.target} ${habit.unit}` : ''}
              </p>
            </div>
            <span className={habit.isActive ? 'badge badge-success' : 'badge'}>
              {habit.isActive ? 'Active' : 'Paused'}
            </span>
          </div>

          {habit.description && (
            <p className="text-sm text-text-muted mb-3">{habit.description}</p>
          )}

          <dl className="text-sm space-y-1.5 mb-4">
            <div className="flex justify-between gap-3">
              <dt className="text-text-muted">Started</dt>
              <dd className="text-text">{formatDate(habit.startDate)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-muted">Ends</dt>
              <dd className="text-text">
                {habit.endDate ? formatDate(habit.endDate) : 'No end date'}
              </dd>
            </div>
            {habit.progress && (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">This period</dt>
                  <dd
                    className={
                      periodCompleted ? 'text-success font-medium' : 'text-text'
                    }
                  >
                    {describePeriod(habit)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Completions</dt>
                  <dd className="text-text">
                    {habit.progress.totalCompletions} ·{' '}
                    {habit.progress.completionRate}%
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Current streak</dt>
                  <dd
                    className="text-text inline-flex items-center gap-1.5"
                    data-testid={`habit-current-streak-${habit.name}`}
                  >
                    <Flame className="w-4 h-4 text-orange-500" aria-hidden="true" />
                    {habit.progress.streak.current}{' '}
                    {habit.progress.streak.current === 1 ? 'period' : 'periods'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Best streak</dt>
                  <dd
                    className="text-text inline-flex items-center gap-1.5"
                    data-testid={`habit-best-streak-${habit.name}`}
                  >
                    {habit.progress.streak.longest}{' '}
                    {habit.progress.streak.longest === 1 ? 'period' : 'periods'}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {habit.progress && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>Completion rate</span>
                <span>{habit.progress.completionRate}%</span>
              </div>
              <div
                className="h-2 w-full rounded-full bg-border overflow-hidden"
                role="progressbar"
                aria-label={`Completion rate for ${habit.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={habit.progress.completionRate}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${habit.progress.completionRate}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-border">
            {habit.isActive && (
              <button
                type="button"
                className="btn-primary btn-sm"
                aria-label={`Complete ${habit.name}`}
                onClick={() => void handleComplete(habit)}
                disabled={isCompleting || periodCompleted}
              >
                {isCompleting ? (
                  'Completing...'
                ) : periodCompleted ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    Completed
                  </span>
                ) : (
                  'Mark complete'
                )}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label={`History ${habit.name}`}
              onClick={() => openHistory(habit)}
            >
              <History className="w-4 h-4" aria-hidden="true" />
              History
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label={`Edit ${habit.name}`}
              onClick={() => openEditForm(habit)}
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label={habit.isActive ? `Pause ${habit.name}` : `Resume ${habit.name}`}
              onClick={() => void handleToggleActive(habit)}
            >
              {habit.isActive ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm text-error hover:bg-red-50"
              aria-label={`Delete ${habit.name}`}
              onClick={() => setDeleteTarget(habit)}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading && !hasLoadedOnce) {
    return <Loading />;
  }

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
              <ListChecks className="w-6 h-6" aria-hidden="true" />
              Financial Habits
            </h1>
            <p className="text-text-muted mt-1">
              Build money habits one day at a time. Completing a habit records nothing against
              your transactions or budgets.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateForm}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            New habit
          </button>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-success bg-green-50 px-4 py-3 text-sm text-success mb-6"
            role="status"
          >
            {successMessage}
          </div>
        )}

        {actionError && !isFormOpen && !deleteTarget && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
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
                onClick={() => void fetchHabits({ initial: true })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {showEmpty && (
          <div className="card">
            <div className="card-body text-center py-16">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                <CalendarCheck className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No habits yet</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Create your first financial habit - track daily expenses, review spending weekly,
                or anything you want to build into a routine.
              </p>
              <button type="button" className="btn-primary" onClick={openCreateForm}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create habit
              </button>
            </div>
          </div>
        )}

        {!loadError && (activeHabits.length > 0 || pausedHabits.length > 0) && (
          <>
            {activeHabits.length > 0 && (
              <section aria-labelledby="active-habits-heading" className="mb-8">
                <h2 id="active-habits-heading" className="heading-3 mb-4">
                  Active habits
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {activeHabits.map(renderHabitCard)}
                </div>

                {activeTotal > PAGE_SIZE && (
                  <div className="mt-6 flex items-center justify-between">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      disabled={page <= 1 || isFetching}
                    >
                      Previous
                    </button>
                    <span className="text-sm text-text-muted" data-testid="page-indicator">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                      disabled={page >= totalPages || isFetching}
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>
            )}

            {pausedHabits.length > 0 && (
              <section aria-labelledby="paused-habits-heading">
                <h2 id="paused-habits-heading" className="heading-3 mb-4">
                  Paused habits
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {pausedHabits.map(renderHabitCard)}
                </div>
              </section>
            )}
          </>
        )}

        {isFetching && hasLoadedOnce && (
          <p className="text-xs text-text-muted text-center mt-4" aria-live="polite">
            Refreshing...
          </p>
        )}
      </main>

      {/* Add / Edit modal */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div className="absolute inset-0 bg-black/40" onClick={closeForm} aria-hidden="true" />
          <div
            className="relative w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="habit-form-title"
          >
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface rounded-t-xl">
              <h2 id="habit-form-title" className="heading-3">
                {editingHabit ? 'Edit Habit' : 'New Habit'}
              </h2>
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label="Close dialog"
                onClick={closeForm}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                {actionError && (
                  <div
                    className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                  >
                    {actionError}
                  </div>
                )}

                <div>
                  <label htmlFor="habit-name" className="label">
                    Name
                  </label>
                  <input
                    id="habit-name"
                    type="text"
                    placeholder="e.g. Track daily expenses"
                    className={`input ${errors.name ? 'input-error' : ''}`}
                    {...register('name')}
                    aria-invalid={errors.name ? 'true' : 'false'}
                    aria-describedby={errors.name ? 'habit-name-error' : undefined}
                  />
                  {errors.name && (
                    <p id="habit-name-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="habit-description" className="label">
                    Description <span className="text-text-muted">(optional)</span>
                  </label>
                  <textarea
                    id="habit-description"
                    rows={2}
                    placeholder="Why this habit matters"
                    className={`input ${errors.description ? 'input-error' : ''}`}
                    {...register('description')}
                    aria-invalid={errors.description ? 'true' : 'false'}
                  />
                  {errors.description && (
                    <p className="mt-1.5 text-sm text-error" role="alert">
                      {errors.description.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="habit-frequency" className="label">
                      Frequency
                    </label>
                    <select
                      id="habit-frequency"
                      className={`input ${errors.frequency ? 'input-error' : ''}`}
                      {...register('frequency')}
                    >
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                    {errors.frequency && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.frequency.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="habit-target" className="label">
                      Target <span className="text-text-muted">(optional)</span>
                    </label>
                    <input
                      id="habit-target"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 500"
                      className={`input ${errors.target ? 'input-error' : ''}`}
                      {...register('target')}
                      aria-invalid={errors.target ? 'true' : 'false'}
                    />
                    {errors.target && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.target.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="habit-unit" className="label">
                      Unit <span className="text-text-muted">(optional)</span>
                    </label>
                    <input
                      id="habit-unit"
                      type="text"
                      placeholder="e.g. INR, times"
                      className={`input ${errors.unit ? 'input-error' : ''}`}
                      {...register('unit')}
                    />
                    {errors.unit && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.unit.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="habit-startDate" className="label">
                      Start date
                    </label>
                    <input
                      id="habit-startDate"
                      type="date"
                      className={`input ${errors.startDate ? 'input-error' : ''}`}
                      {...register('startDate')}
                      aria-invalid={errors.startDate ? 'true' : 'false'}
                    />
                    {errors.startDate && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.startDate.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="habit-endDate" className="label">
                    End date <span className="text-text-muted">(optional)</span>
                  </label>
                  <input
                    id="habit-endDate"
                    type="date"
                    className={`input ${errors.endDate ? 'input-error' : ''}`}
                    {...register('endDate')}
                    aria-invalid={errors.endDate ? 'true' : 'false'}
                  />
                  {errors.endDate && (
                    <p className="mt-1.5 text-sm text-error" role="alert">
                      {errors.endDate.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeForm}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingHabit ? 'Save changes' : 'Create habit'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isDeleting && setDeleteTarget(null)}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-habit-title"
            aria-describedby="delete-habit-description"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="delete-habit-title" className="heading-3">
                Delete habit?
              </h2>
            </div>
            <p id="delete-habit-description" className="text-sm text-text-muted mb-6">
              This will permanently delete{' '}
              <span className="font-medium text-text">{deleteTarget.name}</span> and its
              completion history. Transactions and budgets are not affected. This action cannot
              be undone.
            </p>
            {actionError && (
              <div
                className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
                role="alert"
              >
                {actionError}
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void confirmDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Period history modal */}
      {historyTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeHistory}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="habit-history-title"
          >
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface rounded-t-xl">
              <div className="min-w-0">
                <h2 id="habit-history-title" className="heading-3 truncate">
                  Habit history
                </h2>
                <p className="text-xs text-text-muted truncate">
                  {historyTarget.name} · {FREQUENCY_LABELS[historyTarget.frequency]}{' '}
                  periods
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label="Close dialog"
                onClick={closeHistory}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6">
              {historyStatus === 'loading' && (
                <p
                  className="text-sm text-text-muted text-center py-4"
                  aria-live="polite"
                >
                  Loading history...
                </p>
              )}

              {historyStatus === 'error' && (
                <div
                  className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                  role="alert"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <span>{historyError}</span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm self-start sm:self-auto"
                      onClick={() => void fetchHistory(historyTarget)}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}

              {historyStatus === 'loaded' && historyItems.length === 0 && (
                <p className="text-sm text-text-muted text-center py-4">
                  No eligible periods yet.
                </p>
              )}

              {historyStatus === 'loaded' && historyItems.length > 0 && (
                <ul
                  className="divide-y divide-border max-h-80 overflow-y-auto"
                  data-testid="habit-history-list"
                >
                  {historyItems.map((item) => (
                    <li
                      key={item.period}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="text-text">
                        {formatPeriodLabel(historyTarget.frequency, item.period)}
                      </span>
                      <span
                        className={
                          item.completed
                            ? 'text-success inline-flex items-center gap-1'
                            : 'text-text-muted inline-flex items-center gap-1'
                        }
                      >
                        {item.completed ? (
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Circle className="w-4 h-4" aria-hidden="true" />
                        )}
                        {item.completed ? 'Completed' : 'Missed'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
