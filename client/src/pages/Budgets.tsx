import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Pencil,
  Plus,
  Settings,
    Target,
    Receipt,
    RefreshCw,
    Repeat,
    TrendingUp,
  Trash2,
  Wallet,
  X,
  Trophy,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { getMyProfile } from '../services/userApi';
import { getCategories } from '../services/categoryApi';
import { budgetApi } from '../services/budgetApi';
import { formatMonth } from '../utils/date';
import type { Category } from '../types/category';
import type { BudgetWithProgress } from '../types/budget';

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const budgetSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Budget name is required')
      .max(100, 'Budget name must be at most 100 characters'),
    amount: z
      .string()
      .trim()
      .min(1, 'Amount is required')
      .regex(MONEY_PATTERN, 'Amount must be a positive number with up to 2 decimal places')
      .refine((value) => Number(value) > 0, 'Amount must be greater than zero')
      .refine((value) => Number(value) <= MONEY_MAX, 'Amount exceeds the maximum allowed value'),
    month: z.string().regex(MONTH_PATTERN, 'Invalid month'),
    categoryId: z.string().optional(),
  })
  .strict();

type BudgetForm = z.infer<typeof budgetSchema>;

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

function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function emptyBudgetForm(): BudgetForm {
  return {
    name: '',
    amount: '',
    month: currentUtcMonth(),
    categoryId: '',
  };
}

function toBudgetFormValues(budget: BudgetWithProgress): BudgetForm {
  return {
    name: budget.name,
    amount: String(budget.amount),
    month: budget.month,
    categoryId: budget.category?.id ?? '',
  };
}

function optionalCategoryId(categoryId: string | undefined): string | null {
  return categoryId ? categoryId : null;
}

export function Budgets() {
  const { user, logout } = useAuth();

  const [budgets, setBudgets] = useState<BudgetWithProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [currency, setCurrency] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetWithProgress | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BudgetWithProgress | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BudgetForm>({
    resolver: zodResolver(budgetSchema),
    defaultValues: emptyBudgetForm(),
  });

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: true },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Habits', href: '/habits', icon: ListChecks, current: false },
    { name: 'Challenges', href: '/challenges', icon: Trophy, current: false },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === 'EXPENSE'),
    [categories]
  );

  const fetchProfileCurrency = useCallback(async () => {
    try {
      const result = await getMyProfile();
      setCurrency(result.profile.financialProfile.currency);
    } catch {
      setCurrency(null);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    setIsLoadingCategories(true);
    try {
      const result = await getCategories({ type: 'EXPENSE' });
      setCategories(result.categories);
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsLoadingCategories(false);
    }
  }, []);

  const fetchBudgets = useCallback(async (options: { initial?: boolean } = {}) => {
    const { initial = false } = options;

    if (initial) {
      setIsLoading(true);
    } else {
      setIsFetching(true);
    }
    setLoadError(null);

    try {
      const result = await budgetApi.getBudgets();
      setBudgets(result.budgets);
      setHasLoadedOnce(true);
    } catch (error) {
      if (initial || hasLoadedOnce) {
        setLoadError(getApiErrorMessage(error));
      }
    } finally {
      if (initial) {
        setIsLoading(false);
      } else {
        setIsFetching(false);
      }
    }
  }, [hasLoadedOnce]);

  useEffect(() => {
    void fetchProfileCurrency();
    void fetchCategories();
  }, [fetchProfileCurrency, fetchCategories]);

  useEffect(() => {
    void fetchBudgets({ initial: !hasLoadedOnce });
  }, [fetchBudgets, hasLoadedOnce]);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingBudget(null);
    setActionError(null);
    reset(emptyBudgetForm());
  }, [reset]);

  const openCreateForm = useCallback(() => {
    setEditingBudget(null);
    setActionError(null);
    setSuccessMessage(null);
    reset(emptyBudgetForm());
    setIsFormOpen(true);
  }, [reset]);

  const openEditForm = useCallback(
    (budget: BudgetWithProgress) => {
      setEditingBudget(budget);
      setActionError(null);
      setSuccessMessage(null);
      reset(toBudgetFormValues(budget));
      setIsFormOpen(true);
    },
    [reset]
  );

  useEffect(() => {
    if (!isFormOpen && !deleteTarget) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (deleteTarget) {
          setDeleteTarget(null);
        } else {
          closeForm();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFormOpen, deleteTarget, closeForm]);

  const onSubmit = async (data: BudgetForm) => {
    setActionError(null);
    setSuccessMessage(null);

    const payload = {
      name: data.name.trim(),
      amount: data.amount.trim(),
      month: data.month,
      categoryId: optionalCategoryId(data.categoryId),
    };

    try {
      if (editingBudget) {
        await budgetApi.updateBudget(editingBudget.id, payload);
        setSuccessMessage('Budget updated successfully');
      } else {
        await budgetApi.createBudget(payload);
        setSuccessMessage('Budget created successfully');
      }

      closeForm();
      await fetchBudgets();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setActionError(null);

    try {
      await budgetApi.deleteBudget(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage('Budget deleted successfully');
      await fetchBudgets();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const formatAmount = useMemo(() => createCurrencyFormatter(currency), [currency]);

  if (isLoading && !hasLoadedOnce) {
    return <Loading />;
  }

  const showEmpty = !isLoading && !loadError && budgets.length === 0 && hasLoadedOnce;

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
            <h1 className="heading-1">Budgets</h1>
            <p className="text-text-muted mt-1">
              Set monthly limits and track how much of each budget you have spent.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateForm}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Create Budget
          </button>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-primary bg-primary-light px-4 py-3 text-sm text-primary mb-6"
            role="status"
          >
            {successMessage}
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
                onClick={() => void fetchBudgets({ initial: true })}
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
                <Wallet className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No budgets yet</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Create your first budget to set a spending limit for a category or for the whole
                month.
              </p>
              <button type="button" className="btn-primary" onClick={openCreateForm}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create Budget
              </button>
            </div>
          </div>
        )}

        {!loadError && budgets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {budgets.map((budget) => {
              const overBudget = budget.progress.remaining < 0;
              const width = Math.min(budget.progress.percentageUsed, 100);
              return (
                <div key={budget.id} className="card">
                  <div className="card-body">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <h2 className="heading-4 truncate">{budget.name}</h2>
                        <p className="text-xs text-text-muted mt-0.5">
                          {formatMonth(budget.month)}
                          {budget.category && <> · {budget.category.name}</>}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
                          overBudget ? 'bg-red-50 text-error' : 'bg-primary-light text-primary'
                        }`}
                      >
                        {budget.progress.percentageUsed}%
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 mb-1.5 text-sm">
                      <span className="text-text">
                        {formatAmount(budget.progress.spent)}
                        <span className="text-text-muted">
                          {' '}
                          of {formatAmount(budget.progress.budgetAmount)}
                        </span>
                      </span>
                      <span
                        className={`whitespace-nowrap ${overBudget ? 'text-error' : 'text-text-muted'}`}
                      >
                        {overBudget
                          ? `-${formatAmount(Math.abs(budget.progress.remaining))}`
                          : `${formatAmount(budget.progress.remaining)} left`}
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
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${width}%`,
                          backgroundColor: overBudget
                            ? '#ef4444'
                            : (budget.category?.color ?? '#10b981'),
                        }}
                      />
                    </div>

                    <p className="text-xs text-text-muted mt-2">
                      {budget.progress.transactionCount}{' '}
                      {budget.progress.transactionCount === 1 ? 'transaction' : 'transactions'} in{' '}
                      {formatMonth(budget.month)}
                    </p>

                    <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        aria-label={`Edit budget ${budget.name}`}
                        onClick={() => openEditForm(budget)}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-error hover:bg-red-50"
                        aria-label={`Delete budget ${budget.name}`}
                        onClick={() => setDeleteTarget(budget)}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {isFetching && budgets.length > 0 && (
          <p className="text-xs text-text-muted text-center mt-4" aria-live="polite">
            Refreshing budgets...
          </p>
        )}
      </main>

      {/* Add / Edit modal */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeForm}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-form-title"
          >
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface rounded-t-xl">
              <h2 id="budget-form-title" className="heading-3">
                {editingBudget ? 'Edit Budget' : 'Create Budget'}
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
                  <label htmlFor="budget-name" className="label">
                    Name
                  </label>
                  <input
                    id="budget-name"
                    type="text"
                    placeholder="e.g. Groceries"
                    className={`input ${errors.name ? 'input-error' : ''}`}
                    {...register('name')}
                    aria-invalid={errors.name ? 'true' : 'false'}
                    aria-describedby={errors.name ? 'budget-name-error' : undefined}
                  />
                  {errors.name && (
                    <p id="budget-name-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="budget-amount" className="label">
                      Amount
                    </label>
                    <input
                      id="budget-amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`input ${errors.amount ? 'input-error' : ''}`}
                      {...register('amount')}
                      aria-invalid={errors.amount ? 'true' : 'false'}
                      aria-describedby={errors.amount ? 'budget-amount-error' : undefined}
                    />
                    {errors.amount && (
                      <p
                        id="budget-amount-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.amount.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="budget-month" className="label">
                      Month
                    </label>
                    <input
                      id="budget-month"
                      type="month"
                      className={`input ${errors.month ? 'input-error' : ''}`}
                      {...register('month')}
                      aria-invalid={errors.month ? 'true' : 'false'}
                      aria-describedby={errors.month ? 'budget-month-error' : undefined}
                    />
                    {errors.month && (
                      <p
                        id="budget-month-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.month.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="budget-categoryId" className="label">
                    Category
                  </label>
                  <select
                    id="budget-categoryId"
                    className={`input ${errors.categoryId ? 'input-error' : ''}`}
                    {...register('categoryId')}
                    disabled={isLoadingCategories}
                    aria-invalid={errors.categoryId ? 'true' : 'false'}
                  >
                    <option value="">
                      {isLoadingCategories
                        ? 'Loading categories...'
                        : 'All expenses (no category)'}
                    </option>
                    {expenseCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                        {category.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  {errors.categoryId && (
                    <p className="mt-1.5 text-sm text-error" role="alert">
                      {errors.categoryId.message}
                    </p>
                  )}
                  {!isLoadingCategories && expenseCategories.length === 0 && (
                    <p className="mt-1.5 text-sm text-text-muted">
                      No expense categories available. Create a category first.
                    </p>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeForm}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting
                      ? editingBudget
                        ? 'Saving...'
                        : 'Creating...'
                      : editingBudget
                        ? 'Save Changes'
                        : 'Create Budget'}
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
            aria-labelledby="delete-budget-title"
            aria-describedby="delete-budget-description"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="delete-budget-title" className="heading-3">
                Delete budget?
              </h2>
            </div>
            <p id="delete-budget-description" className="text-sm text-text-muted mb-6">
              This will permanently delete{' '}
              <span className="font-medium text-text">{deleteTarget.name}</span> (
              {formatAmount(deleteTarget.amount)} for {formatMonth(deleteTarget.month)}). This
              action cannot be undone.
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
    </div>
  );
}
