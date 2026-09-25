import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Coins,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Pencil,
  PiggyBank,
  Plus,
  RefreshCw,
  Repeat,
  Receipt,
  Settings,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { getMyProfile } from '../services/userApi';
import { goalApi } from '../services/goalApi';
import { formatDate } from '../utils/date';
import type {
  Goal,
  GoalContribution,
  GoalPriority,
  GoalStatus,
} from '../types/goal';

const PAGE_SIZE = 50;

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_LABELS: Record<GoalStatus, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  CANCELLED: 'Cancelled',
};

const PRIORITY_LABELS: Record<GoalPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

const goalFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Goal name is required')
      .max(100, 'Goal name must be at most 100 characters'),
    targetAmount: z
      .string()
      .trim()
      .min(1, 'Target amount is required')
      .regex(MONEY_PATTERN, 'Target amount must be a positive number with up to 2 decimal places')
      .refine((value) => Number(value) > 0, 'Target amount must be greater than zero')
      .refine((value) => Number(value) <= MONEY_MAX, 'Target amount exceeds the maximum allowed value'),
    targetDate: z
      .string()
      .trim()
      .min(1, 'Target date is required')
      .regex(DATE_PATTERN, 'Target date must be a valid date')
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Target date must be a valid date'),
    description: z
      .string()
      .trim()
      .max(1000, 'Description must be at most 1000 characters')
      .optional(),
    category: z
      .string()
      .trim()
      .max(50, 'Category must be at most 50 characters')
      .optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    monthlyContribution: z
      .string()
      .trim()
      .max(20, 'Monthly contribution must be at most 20 characters')
      .optional()
      .refine(
        (value) =>
          value === undefined ||
          value === '' ||
          (MONEY_PATTERN.test(value) &&
            Number(value) > 0 &&
            Number(value) <= MONEY_MAX),
        'Monthly contribution must be a positive number with up to 2 decimal places'
      ),
    status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
  })
  .strict();

type GoalForm = z.infer<typeof goalFormSchema>;

const contributionFormSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .min(1, 'Amount is required')
      .regex(MONEY_PATTERN, 'Amount must be a positive number with up to 2 decimal places')
      .refine((value) => Number(value) > 0, 'Amount must be greater than zero')
      .refine((value) => Number(value) <= MONEY_MAX, 'Amount exceeds the maximum allowed value'),
    contributionDate: z
      .string()
      .trim()
      .min(1, 'Date is required')
      .regex(DATE_PATTERN, 'Date must be a valid date')
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Date must be a valid date'),
    note: z
      .string()
      .trim()
      .max(500, 'Note must be at most 500 characters')
      .optional(),
  })
  .strict();

type ContributionForm = z.infer<typeof contributionFormSchema>;

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

function todayIsoDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyGoalForm(): GoalForm {
  return {
    name: '',
    targetAmount: '',
    targetDate: todayIsoDay(),
    description: '',
    category: '',
    priority: 'MEDIUM',
    monthlyContribution: '',
    status: 'ACTIVE',
  };
}

function goalToForm(goal: Goal): GoalForm {
  return {
    name: goal.name,
    targetAmount: String(goal.targetAmount),
    targetDate: goal.targetDate.slice(0, 10),
    description: goal.description ?? '',
    category: goal.category,
    priority: goal.priority,
    monthlyContribution:
      goal.monthlyContribution !== null ? String(goal.monthlyContribution) : '',
    status: goal.status === 'COMPLETED' ? 'ACTIVE' : goal.status,
  };
}

export function Goals() {
  const { user, logout } = useAuth();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [totalTargetAmount, setTotalTargetAmount] = useState(0);
  const [totalSavedAmount, setTotalSavedAmount] = useState(0);
  const [nearestTargetDate, setNearestTargetDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [contributionsGoal, setContributionsGoal] = useState<Goal | null>(null);
  const [contributions, setContributions] = useState<GoalContribution[]>([]);
  const [contributionsLoading, setContributionsLoading] = useState(false);
  const [contributionsError, setContributionsError] = useState<string | null>(null);
  const [editingContribution, setEditingContribution] =
    useState<GoalContribution | null>(null);
  const [contributionBusy, setContributionBusy] = useState(false);
  const [isContributionsOpen, setIsContributionsOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GoalForm>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: emptyGoalForm(),
  });

  const {
    register: registerContribution,
    handleSubmit: handleContributionSubmit,
    reset: resetContribution,
    formState: { errors: contributionErrors, isSubmitting: contributionSubmitting },
  } = useForm<ContributionForm>({
    resolver: zodResolver(contributionFormSchema),
    defaultValues: {
      amount: '',
      contributionDate: todayIsoDay(),
      note: '',
    },
  });

  const formatAmount = useMemo(() => createCurrencyFormatter(currency), [currency]);

  const fetchProfileCurrency = useCallback(async () => {
    try {
      const result = await getMyProfile();
      setCurrency(result.profile.financialProfile.currency);
    } catch {
      setCurrency(null);
    }
  }, []);

  const hasLoadedOnceRef = useRef(false);

  const fetchGoals = useCallback(async (options: { initial?: boolean } = {}) => {
    const { initial = false } = options;

    if (initial) {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      const result = await goalApi.getGoals({ pageSize: PAGE_SIZE });
      setGoals(result.goals);
      setActiveCount(result.activeCount);
      setTotalTargetAmount(result.totalTargetAmount);
      setTotalSavedAmount(result.totalSavedAmount);
      setNearestTargetDate(result.nearestTargetDate);
      setHasLoadedOnce(true);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      if (initial || hasLoadedOnceRef.current) {
        setGoals([]);
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
    void fetchGoals({ initial: !hasLoadedOnceRef.current });
  }, [fetchGoals]);

  const fetchContributions = useCallback(async (goalId: string) => {
    setContributionsLoading(true);
    setContributionsError(null);

    try {
      const result = await goalApi.getGoalContributions(goalId, {
        pageSize: PAGE_SIZE,
      });
      setContributions(result.contributions);
    } catch (error) {
      setContributions([]);
      setContributionsError(getApiErrorMessage(error));
    } finally {
      setContributionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!contributionsGoal) return;
    void fetchContributions(contributionsGoal.id);
  }, [contributionsGoal, fetchContributions]);

  useEffect(() => {
    if (!isContributionsOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !contributionBusy) {
        setIsContributionsOpen(false);
        setContributionsGoal(null);
        setEditingContribution(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isContributionsOpen, contributionBusy]);

  const openCreateForm = useCallback(() => {
    setEditingGoal(null);
    setActionError(null);
    reset(emptyGoalForm());
    setIsFormOpen(true);
  }, [reset]);

  const openEditForm = useCallback(
    (goal: Goal) => {
      setEditingGoal(goal);
      setActionError(null);
      reset(goalToForm(goal));
      setIsFormOpen(true);
    },
    [reset]
  );

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingGoal(null);
    setActionError(null);
    reset(emptyGoalForm());
  }, [reset]);

  const onSubmit = useCallback(
    async (form: GoalForm) => {
      setActionError(null);

      try {
        if (editingGoal) {
          await goalApi.updateGoal(editingGoal.id, {
            name: form.name,
            targetAmount: form.targetAmount,
            targetDate: form.targetDate,
            description: form.description?.trim() ? form.description : null,
            category: form.category?.trim() || undefined,
            priority: form.priority,
            monthlyContribution: form.monthlyContribution?.trim()
              ? form.monthlyContribution
              : null,
            status: form.status,
          });
          setSuccessMessage(`Goal "${form.name}" updated`);
        } else {
          await goalApi.createGoal({
            name: form.name,
            targetAmount: form.targetAmount,
            targetDate: form.targetDate,
            description: form.description?.trim() || undefined,
            category: form.category?.trim() || undefined,
            priority: form.priority,
            monthlyContribution: form.monthlyContribution?.trim()
              ? form.monthlyContribution
              : null,
          });
          setSuccessMessage(`Goal "${form.name}" created`);
        }

        closeForm();
        await fetchGoals();
      } catch (error) {
        setActionError(getApiErrorMessage(error));
      }
    },
    [editingGoal, closeForm, fetchGoals]
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setActionError(null);

    try {
      await goalApi.deleteGoal(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage(`Goal "${deleteTarget.name}" deleted`);
      await fetchGoals();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, fetchGoals]);

  const openContributions = useCallback((goal: Goal) => {
    setActionError(null);
    setEditingContribution(null);
    resetContribution({
      amount: '',
      contributionDate: todayIsoDay(),
      note: '',
    });
    setContributionsGoal(goal);
    setIsContributionsOpen(true);
  }, [resetContribution]);

  const closeContributions = useCallback(() => {
    setIsContributionsOpen(false);
    setContributionsGoal(null);
    setEditingContribution(null);
    setContributionsError(null);
    resetContribution({
      amount: '',
      contributionDate: todayIsoDay(),
      note: '',
    });
  }, [resetContribution]);

  const onContributionSubmit = useCallback(
    async (form: ContributionForm) => {
      if (!contributionsGoal) return;

      setActionError(null);
      setContributionsError(null);

      try {
        if (editingContribution) {
          await goalApi.updateGoalContribution(
            contributionsGoal.id,
            editingContribution.id,
            {
              amount: form.amount,
              contributionDate: form.contributionDate,
              note: form.note?.trim() ? form.note : null,
            }
          );
          setSuccessMessage('Contribution updated');
        } else {
          await goalApi.createGoalContribution(contributionsGoal.id, {
            amount: form.amount,
            contributionDate: form.contributionDate,
            note: form.note?.trim() || undefined,
          });
          setSuccessMessage('Contribution added');
        }

        setEditingContribution(null);
        resetContribution({
          amount: '',
          contributionDate: todayIsoDay(),
          note: '',
        });
        await fetchContributions(contributionsGoal.id);
        await fetchGoals();
      } catch (error) {
        setActionError(getApiErrorMessage(error));
      }
    },
    [
      contributionsGoal,
      editingContribution,
      resetContribution,
      fetchContributions,
      fetchGoals,
    ]
  );

  const startEditContribution = useCallback(
    (contribution: GoalContribution) => {
      setEditingContribution(contribution);
      setActionError(null);
      resetContribution({
        amount: String(contribution.amount),
        contributionDate: contribution.contributionDate.slice(0, 10),
        note: contribution.note ?? '',
      });
    },
    [resetContribution]
  );

  const cancelEditContribution = useCallback(() => {
    setEditingContribution(null);
    resetContribution({
      amount: '',
      contributionDate: todayIsoDay(),
      note: '',
    });
  }, [resetContribution]);

  const removeContribution = useCallback(
    async (contribution: GoalContribution) => {
      if (!contributionsGoal) return;

      setActionError(null);
      setContributionBusy(true);

      try {
        await goalApi.deleteGoalContribution(
          contributionsGoal.id,
          contribution.id
        );
        if (editingContribution?.id === contribution.id) {
          cancelEditContribution();
        }
        setSuccessMessage('Contribution deleted');
        await fetchContributions(contributionsGoal.id);
        await fetchGoals();
      } catch (error) {
        setActionError(getApiErrorMessage(error));
      } finally {
        setContributionBusy(false);
      }
    },
    [
      contributionsGoal,
      editingContribution,
      cancelEditContribution,
      fetchContributions,
      fetchGoals,
    ]
  );

  const byStatus = useCallback(
    (status: GoalStatus) => goals.filter((goal) => goal.status === status),
    [goals]
  );

  const activeGoals = byStatus('ACTIVE');
  const completedGoals = byStatus('COMPLETED');
  const pausedGoals = byStatus('PAUSED');
  const cancelledGoals = byStatus('CANCELLED');

  const showEmpty = hasLoadedOnce && !isLoading && !loadError && goals.length === 0;

  const renderGoalCard = (goal: Goal) => {
    const percent = Math.min(Math.max(goal.progressPercent, 0), 100);
    const isCompleted = goal.status === 'COMPLETED';

    return (
      <div
        key={goal.id}
        className="card"
        data-testid={`goal-card-${goal.name}`}
      >
        <div className="card-body">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h3 className="heading-4 truncate">{goal.name}</h3>
              <p className="text-xs text-text-muted mt-0.5">
                {goal.category} · {PRIORITY_LABELS[goal.priority]} priority
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {goal.overdue && (
                <span
                  className="badge badge-error"
                  data-testid={`goal-overdue-${goal.name}`}
                >
                  Overdue
                </span>
              )}
              <span
                className="badge"
                data-testid={`goal-status-${goal.name}`}
              >
                {STATUS_LABELS[goal.status]}
              </span>
            </div>
          </div>

          {goal.description && (
            <p className="text-sm text-text-muted mb-3">{goal.description}</p>
          )}

          <p className="text-sm text-text mb-3">
            Target: {formatDate(goal.targetDate)}
            {goal.monthlyContribution !== null && (
              <span className="text-text-muted">
                {' '}
                · {formatAmount(goal.monthlyContribution)}/month
              </span>
            )}
          </p>

          <div
            className="grid grid-cols-2 gap-3 mb-4 text-sm"
            data-testid={`goal-progress-${goal.name}`}
          >
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-text-muted">Current</p>
              <p className="font-medium text-text" data-testid={`goal-current-${goal.name}`}>
                {formatAmount(goal.currentAmount)}
              </p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-text-muted">Target</p>
              <p className="font-medium text-text" data-testid={`goal-target-${goal.name}`}>
                {formatAmount(goal.targetAmount)}
              </p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-text-muted">Progress</p>
              <p className="font-medium text-text" data-testid={`goal-percent-${goal.name}`}>
                {goal.progressPercent}%
              </p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-text-muted">Remaining</p>
              <p className="font-medium text-text" data-testid={`goal-remaining-${goal.name}`}>
                {formatAmount(goal.remainingAmount)}
              </p>
            </div>
          </div>

          <div
            className="h-2 w-full rounded-full bg-border overflow-hidden mb-2"
            role="progressbar"
            aria-label={`Progress for ${goal.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div
              className={`h-full rounded-full ${isCompleted ? 'bg-success' : 'bg-primary'}`}
              style={{ width: `${percent}%` }}
            />
          </div>

          <p className="text-xs text-text-muted mb-4">
            {goal.contributionCount}{' '}
            {goal.contributionCount === 1 ? 'contribution' : 'contributions'}
          </p>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-border">
            <button
              type="button"
              className="btn-ghost btn-sm text-error hover:bg-red-50"
              aria-label={`Delete ${goal.name}`}
              onClick={() => {
                setActionError(null);
                setDeleteTarget(goal);
              }}
              data-testid={`goal-delete-${goal.name}`}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              Delete
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={`Edit ${goal.name}`}
              onClick={() => openEditForm(goal)}
              data-testid={`goal-edit-${goal.name}`}
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              aria-label={`Add money to ${goal.name}`}
              onClick={() => openContributions(goal)}
              data-testid={`goal-add-money-${goal.name}`}
            >
              <Coins className="w-4 h-4" aria-hidden="true" />
              Add money
            </button>
          </div>
        </div>
      </div>
    );
  };

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
    { name: 'Goals', href: '/goals', icon: PiggyBank, current: true },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
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
              <PiggyBank className="w-6 h-6" aria-hidden="true" />
              Savings Goals
            </h1>
            <p className="text-text-muted mt-1">
              Set money aside for what matters. Contributions are tracked separately and
              never create transactions or change your budgets.
            </p>
            <p className="text-sm text-text-muted mt-2">
              <span data-testid="goals-active-count">{activeCount} active</span>
              {' · '}
              <span data-testid="goals-saved-total">
                {formatAmount(totalSavedAmount)} saved
              </span>
              {' · '}
              <span data-testid="goals-target-total">
                {formatAmount(totalTargetAmount)} targeted
              </span>
              {nearestTargetDate && (
                <>
                  {' · '}
                  <span data-testid="goals-nearest-target">
                    Nearest target {formatDate(nearestTargetDate)}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary self-start sm:self-auto"
            onClick={openCreateForm}
            data-testid="create-goal-button"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New goal
          </button>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-success bg-green-50 px-4 py-3 text-sm text-success mb-6"
            role="status"
            data-testid="goals-success"
          >
            {successMessage}
          </div>
        )}

        {actionError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="goals-error"
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
                onClick={() => void fetchGoals({ initial: true })}
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
                <PiggyBank className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No savings goals yet</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Create your first goal — an emergency fund, a vacation, or a new laptop —
                and watch your progress grow with every contribution.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={openCreateForm}
                data-testid="goals-empty-create"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create your first goal
              </button>
            </div>
          </div>
        )}

        {!loadError && goals.length > 0 && (
          <>
            {activeGoals.length > 0 && (
              <section aria-labelledby="active-goals-heading" className="mb-8">
                <h2 id="active-goals-heading" className="heading-3 mb-4">
                  Active goals
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {activeGoals.map(renderGoalCard)}
                </div>
              </section>
            )}

            {completedGoals.length > 0 && (
              <section aria-labelledby="completed-goals-heading" className="mb-8">
                <h2 id="completed-goals-heading" className="heading-3 mb-4">
                  Completed goals
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {completedGoals.map(renderGoalCard)}
                </div>
              </section>
            )}

            {pausedGoals.length > 0 && (
              <section aria-labelledby="paused-goals-heading" className="mb-8">
                <h2 id="paused-goals-heading" className="heading-3 mb-4">
                  Paused goals
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {pausedGoals.map(renderGoalCard)}
                </div>
              </section>
            )}

            {cancelledGoals.length > 0 && (
              <section aria-labelledby="cancelled-goals-heading">
                <h2 id="cancelled-goals-heading" className="heading-3 mb-4">
                  Cancelled goals
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {cancelledGoals.map(renderGoalCard)}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isSubmitting && closeForm()}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-lg bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="goal-form-title"
            data-testid="goal-form"
          >
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 id="goal-form-title" className="heading-3">
                {editingGoal ? 'Edit goal' : 'New goal'}
              </h2>
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label="Close goal form"
                onClick={closeForm}
                disabled={isSubmitting}
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
                    data-testid="goal-form-error"
                  >
                    {actionError}
                  </div>
                )}

                <div>
                  <label htmlFor="goal-name" className="label">
                    Name
                  </label>
                  <input
                    id="goal-name"
                    type="text"
                    placeholder="e.g. Emergency fund"
                    className={`input ${errors.name ? 'input-error' : ''}`}
                    {...register('name')}
                    aria-invalid={errors.name ? 'true' : 'false'}
                    aria-describedby={errors.name ? 'goal-name-error' : undefined}
                    data-testid="goal-name-input"
                  />
                  {errors.name && (
                    <p id="goal-name-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="goal-targetAmount" className="label">
                      Target amount
                    </label>
                    <input
                      id="goal-targetAmount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`input ${errors.targetAmount ? 'input-error' : ''}`}
                      {...register('targetAmount')}
                      aria-invalid={errors.targetAmount ? 'true' : 'false'}
                      aria-describedby={
                        errors.targetAmount ? 'goal-targetAmount-error' : undefined
                      }
                      data-testid="goal-target-amount-input"
                    />
                    {errors.targetAmount && (
                      <p
                        id="goal-targetAmount-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.targetAmount.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="goal-targetDate" className="label">
                      Target date
                    </label>
                    <input
                      id="goal-targetDate"
                      type="date"
                      className={`input ${errors.targetDate ? 'input-error' : ''}`}
                      {...register('targetDate')}
                      aria-invalid={errors.targetDate ? 'true' : 'false'}
                      aria-describedby={
                        errors.targetDate ? 'goal-targetDate-error' : undefined
                      }
                      data-testid="goal-target-date-input"
                    />
                    {errors.targetDate && (
                      <p
                        id="goal-targetDate-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.targetDate.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="goal-description" className="label">
                    Description
                  </label>
                  <textarea
                    id="goal-description"
                    rows={2}
                    placeholder="What are you saving for?"
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
                    <label htmlFor="goal-category" className="label">
                      Category
                    </label>
                    <input
                      id="goal-category"
                      type="text"
                      placeholder="e.g. emergency"
                      className={`input ${errors.category ? 'input-error' : ''}`}
                      {...register('category')}
                      aria-invalid={errors.category ? 'true' : 'false'}
                    />
                    {errors.category && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.category.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="goal-priority" className="label">
                      Priority
                    </label>
                    <select
                      id="goal-priority"
                      className="input"
                      {...register('priority')}
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="goal-monthlyContribution" className="label">
                      Monthly contribution
                    </label>
                    <input
                      id="goal-monthlyContribution"
                      type="text"
                      inputMode="decimal"
                      placeholder="Optional"
                      className={`input ${
                        errors.monthlyContribution ? 'input-error' : ''
                      }`}
                      {...register('monthlyContribution')}
                      aria-invalid={errors.monthlyContribution ? 'true' : 'false'}
                    />
                    {errors.monthlyContribution && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.monthlyContribution.message}
                      </p>
                    )}
                  </div>

                  {editingGoal && (
                    <div>
                      <label htmlFor="goal-status" className="label">
                        Status
                      </label>
                      <select
                        id="goal-status"
                        className="input"
                        {...register('status')}
                        data-testid="goal-status-select"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="PAUSED">Paused</option>
                        <option value="CANCELLED">Cancelled</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeForm}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isSubmitting}
                    data-testid="goal-submit"
                  >
                    {isSubmitting
                      ? 'Saving...'
                      : editingGoal
                        ? 'Save changes'
                        : 'Create goal'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

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
            aria-labelledby="delete-goal-title"
            aria-describedby="delete-goal-description"
            data-testid="delete-goal-modal"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <X className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="delete-goal-title" className="heading-3">
                Delete goal?
              </h2>
            </div>
            <p
              id="delete-goal-description"
              className="text-sm text-text-muted mb-6"
            >
              This permanently removes{' '}
              <span className="font-medium text-text">{deleteTarget.name}</span> and its{' '}
              {deleteTarget.contributionCount}{' '}
              {deleteTarget.contributionCount === 1 ? 'contribution' : 'contributions'}.
              This cannot be undone.
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
                data-testid="delete-goal-confirm"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isContributionsOpen && contributionsGoal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !contributionBusy && closeContributions()}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-xl bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contributions-title"
            data-testid="contributions-modal"
          >
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 id="contributions-title" className="heading-3">
                  {contributionsGoal.name}
                </h2>
                <p className="text-sm text-text-muted mt-0.5">
                  <Wallet className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                  {formatAmount(contributionsGoal.currentAmount)} of{' '}
                  {formatAmount(contributionsGoal.targetAmount)}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label="Close contributions"
                onClick={closeContributions}
                disabled={contributionBusy}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <form
                onSubmit={handleContributionSubmit(onContributionSubmit)}
                className="space-y-4"
                noValidate
                data-testid="contribution-form"
              >
                {actionError && (
                  <div
                    className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                    data-testid="contribution-form-error"
                  >
                    {actionError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="contribution-amount" className="label">
                      Amount
                    </label>
                    <input
                      id="contribution-amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`input ${
                        contributionErrors.amount ? 'input-error' : ''
                      }`}
                      {...registerContribution('amount')}
                      aria-invalid={contributionErrors.amount ? 'true' : 'false'}
                      data-testid="contribution-amount-input"
                    />
                    {contributionErrors.amount && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {contributionErrors.amount.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="contribution-date" className="label">
                      Date
                    </label>
                    <input
                      id="contribution-date"
                      type="date"
                      className={`input ${
                        contributionErrors.contributionDate ? 'input-error' : ''
                      }`}
                      {...registerContribution('contributionDate')}
                      aria-invalid={
                        contributionErrors.contributionDate ? 'true' : 'false'
                      }
                      data-testid="contribution-date-input"
                    />
                    {contributionErrors.contributionDate && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {contributionErrors.contributionDate.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="contribution-note" className="label">
                    Note
                  </label>
                  <input
                    id="contribution-note"
                    type="text"
                    placeholder="Optional"
                    className={`input ${contributionErrors.note ? 'input-error' : ''}`}
                    {...registerContribution('note')}
                    aria-invalid={contributionErrors.note ? 'true' : 'false'}
                  />
                  {contributionErrors.note && (
                    <p className="mt-1.5 text-sm text-error" role="alert">
                      {contributionErrors.note.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  {editingContribution && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={cancelEditContribution}
                      disabled={contributionSubmitting}
                    >
                      Cancel edit
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={contributionSubmitting}
                    data-testid="contribution-submit"
                  >
                    {contributionSubmitting
                      ? 'Saving...'
                      : editingContribution
                        ? 'Update contribution'
                        : 'Add contribution'}
                  </button>
                </div>
              </form>

              <div>
                <h3 className="heading-4 mb-3">History</h3>

                {contributionsLoading && (
                  <p className="text-sm text-text-muted text-center py-4">
                    Loading contributions...
                  </p>
                )}

                {!contributionsLoading && contributionsError && (
                  <span
                    className="text-sm text-error block text-center py-4"
                    role="alert"
                  >
                    {contributionsError}
                  </span>
                )}

                {!contributionsLoading && !contributionsError && (
                  <>
                    {contributions.length === 0 && (
                      <p
                        className="text-sm text-text-muted py-4"
                        data-testid="contributions-empty"
                      >
                        No contributions yet. Add your first one above.
                      </p>
                    )}

                    {contributions.length > 0 && (
                      <ul className="space-y-2">
                        {contributions.map((contribution) => (
                          <li
                            key={contribution.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                            data-testid={`contribution-row-${contribution.id}`}
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-text">
                                {formatAmount(contribution.amount)}
                                <span className="text-text-muted font-normal">
                                  {' '}
                                  · {formatDate(contribution.contributionDate)}
                                </span>
                              </p>
                              {contribution.note && (
                                <p className="text-xs text-text-muted truncate">
                                  {contribution.note}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                aria-label="Edit contribution"
                                onClick={() => startEditContribution(contribution)}
                                data-testid={`contribution-edit-${contribution.id}`}
                              >
                                <Pencil className="w-4 h-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-sm text-error hover:bg-red-50"
                                aria-label="Delete contribution"
                                onClick={() => void removeContribution(contribution)}
                                disabled={contributionBusy}
                                data-testid={`contribution-delete-${contribution.id}`}
                              >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
