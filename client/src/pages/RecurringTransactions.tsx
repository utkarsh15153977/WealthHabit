import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard,
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
  Zap,
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
import { recurringTransactionApi } from '../services/recurringTransactionApi';
import { formatDate, toDateInputValue, todayForDateInput } from '../utils/date';
import type { Category } from '../types/category';
import type {
  RecurringFrequency,
  RecurringTransaction,
} from '../types/recurringTransaction';

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const recurringSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters'),
    type: z.enum(['INCOME', 'EXPENSE'], {
      errorMap: () => ({ message: 'Type must be INCOME or EXPENSE' }),
    }),
    amount: z
      .string()
      .trim()
      .min(1, 'Amount is required')
      .regex(MONEY_PATTERN, 'Amount must be a positive number with up to 2 decimal places')
      .refine((value) => Number(value) > 0, 'Amount must be greater than zero')
      .refine((value) => Number(value) <= MONEY_MAX, 'Amount exceeds the maximum allowed value'),
    categoryId: z.string().min(1, 'Category is required'),
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'], {
      errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY, MONTHLY or YEARLY' }),
    }),
    startDate: z
      .string()
      .refine((value) => DATE_PATTERN.test(value), 'Start date is required'),
    endDate: z
      .string()
      .refine((value) => value === '' || DATE_PATTERN.test(value), 'Invalid end date'),
  })
  .strict()
  .refine((data) => !data.endDate || data.endDate >= data.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after start date',
  });

type RecurringForm = z.infer<typeof recurringSchema>;

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
};

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

function emptyFormValues(): RecurringForm {
  return {
    name: '',
    type: 'EXPENSE',
    amount: '',
    categoryId: '',
    frequency: 'MONTHLY',
    startDate: todayForDateInput(),
    endDate: '',
  };
}

function toFormValues(rule: RecurringTransaction): RecurringForm {
  return {
    name: rule.name,
    type: rule.type,
    amount: String(rule.amount),
    categoryId: rule.categoryId,
    frequency: rule.frequency,
    startDate: toDateInputValue(rule.startDate),
    endDate: rule.endDate ? toDateInputValue(rule.endDate) : '',
  };
}

export function RecurringTransactions() {
  const { user, logout } = useAuth();

  const [rules, setRules] = useState<RecurringTransaction[]>([]);
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
  const [editingRule, setEditingRule] = useState<RecurringTransaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringTransaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RecurringForm>({
    resolver: zodResolver(recurringSchema),
    defaultValues: emptyFormValues(),
  });

  const watchedType = watch('type');

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: true },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Habits', href: '/habits', icon: ListChecks, current: false },
    { name: 'Challenges', href: '/challenges', icon: Trophy, current: false },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  const typeCategories = useMemo(
    () => categories.filter((category) => category.type === watchedType),
    [categories, watchedType]
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
      const result = await getCategories();
      setCategories(result.categories);
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsLoadingCategories(false);
    }
  }, []);

  const fetchRules = useCallback(
    async (options: { initial?: boolean } = {}) => {
      const { initial = false } = options;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const result = await recurringTransactionApi.getRecurringTransactions();
        setRules(result.recurringTransactions);
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
    },
    [hasLoadedOnce]
  );

  useEffect(() => {
    void fetchProfileCurrency();
    void fetchCategories();
  }, [fetchProfileCurrency, fetchCategories]);

  useEffect(() => {
    void fetchRules({ initial: !hasLoadedOnce });
  }, [fetchRules, hasLoadedOnce]);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingRule(null);
    setActionError(null);
    reset(emptyFormValues());
  }, [reset]);

  const openCreateForm = useCallback(() => {
    setEditingRule(null);
    setActionError(null);
    setSuccessMessage(null);
    reset(emptyFormValues());
    setIsFormOpen(true);
  }, [reset]);

  const openEditForm = useCallback(
    (rule: RecurringTransaction) => {
      setEditingRule(rule);
      setActionError(null);
      setSuccessMessage(null);
      reset(toFormValues(rule));
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

  const onSubmit = async (data: RecurringForm) => {
    setActionError(null);
    setSuccessMessage(null);

    const payload = {
      name: data.name.trim(),
      categoryId: data.categoryId,
      type: data.type,
      amount: data.amount.trim(),
      frequency: data.frequency,
      startDate: data.startDate,
      ...(data.endDate ? { endDate: data.endDate } : {}),
    };

    try {
      if (editingRule) {
        await recurringTransactionApi.updateRecurringTransaction(editingRule.id, payload);
        setSuccessMessage('Recurring transaction updated successfully');
      } else {
        await recurringTransactionApi.createRecurringTransaction(payload);
        setSuccessMessage('Recurring transaction created successfully');
      }

      closeForm();
      await fetchRules();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const toggleActive = async (rule: RecurringTransaction) => {
    setActionError(null);
    setSuccessMessage(null);

    try {
      await recurringTransactionApi.updateRecurringTransaction(rule.id, {
        isActive: !rule.isActive,
      });
      setSuccessMessage(
        rule.isActive
          ? `"${rule.name}" deactivated`
          : `"${rule.name}" activated`
      );
      await fetchRules();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const generateNow = async (rule: RecurringTransaction) => {
    setActionError(null);
    setSuccessMessage(null);

    try {
      const result = await recurringTransactionApi.generateOccurrences(rule.id);
      setSuccessMessage(
        result.occurrencesCreated > 0
          ? `Created ${result.occurrencesCreated} occurrence${
              result.occurrencesCreated === 1 ? '' : 's'
            } for "${rule.name}"`
          : `No occurrences due for "${rule.name}" yet`
      );
      await fetchRules();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setActionError(null);

    try {
      await recurringTransactionApi.deleteRecurringTransaction(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage('Recurring transaction deleted successfully');
      await fetchRules();
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

  const showEmpty = !isLoading && !loadError && rules.length === 0 && hasLoadedOnce;

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
            <h1 className="heading-1">Recurring Transactions</h1>
            <p className="text-text-muted mt-1">
              Automate regular income and expenses. Occurrences become normal transactions.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateForm}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Create Recurring
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
                onClick={() => void fetchRules({ initial: true })}
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
                <Repeat className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No recurring transactions</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Create a rule for regular income or expenses like salary or subscriptions, and
                generate occurrences whenever they are due.
              </p>
              <button type="button" className="btn-primary" onClick={openCreateForm}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create Recurring
              </button>
            </div>
          </div>
        )}

        {!loadError && rules.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rules.map((rule) => (
              <div key={rule.id} className="card">
                <div className="card-body">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <h2 className="heading-4 truncate">{rule.name}</h2>
                      <p className="text-xs text-text-muted mt-0.5">
                        {rule.category.name} · {FREQUENCY_LABELS[rule.frequency]}
                      </p>
                    </div>
                    <span
                      className={
                        rule.isActive ? 'badge badge-success' : 'badge badge-warning'
                      }
                    >
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span
                      className={`text-lg font-semibold ${
                        rule.type === 'INCOME' ? 'text-primary' : 'text-error'
                      }`}
                    >
                      {formatAmount(rule.amount)}
                    </span>
                    <span
                      className={
                        rule.type === 'INCOME' ? 'badge badge-success' : 'badge badge-warning'
                      }
                    >
                      {rule.type === 'INCOME' ? 'Income' : 'Expense'}
                    </span>
                  </div>

                  <dl className="text-sm space-y-1.5 mb-4">
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-muted">Next occurrence</dt>
                      <dd className="text-text font-medium">
                        {formatDate(rule.nextOccurrenceDate)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-muted">Starts</dt>
                      <dd className="text-text">{formatDate(rule.startDate)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-muted">Ends</dt>
                      <dd className="text-text">
                        {rule.endDate ? formatDate(rule.endDate) : 'Ongoing'}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-border">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      aria-label={`Generate due occurrences for ${rule.name}`}
                      onClick={() => void generateNow(rule)}
                      disabled={!rule.isActive}
                      title={
                        rule.isActive
                          ? 'Generate due occurrences'
                          : 'Activate the rule to generate occurrences'
                      }
                    >
                      <Zap className="w-4 h-4" aria-hidden="true" />
                      Generate
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => void toggleActive(rule)}
                      aria-label={`${rule.isActive ? 'Deactivate' : 'Activate'} ${rule.name}`}
                    >
                      {rule.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      aria-label={`Edit ${rule.name}`}
                      onClick={() => openEditForm(rule)}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-error hover:bg-red-50"
                      aria-label={`Delete ${rule.name}`}
                      onClick={() => setDeleteTarget(rule)}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isFetching && rules.length > 0 && (
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
            aria-labelledby="recurring-form-title"
          >
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface rounded-t-xl">
              <h2 id="recurring-form-title" className="heading-3">
                {editingRule ? 'Edit Recurring Transaction' : 'Create Recurring Transaction'}
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
                  <label htmlFor="recurring-name" className="label">
                    Name
                  </label>
                  <input
                    id="recurring-name"
                    type="text"
                    placeholder="e.g. Salary, Gym membership"
                    className={`input ${errors.name ? 'input-error' : ''}`}
                    {...register('name')}
                    aria-invalid={errors.name ? 'true' : 'false'}
                    aria-describedby={errors.name ? 'recurring-name-error' : undefined}
                  />
                  {errors.name && (
                    <p id="recurring-name-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="recurring-type" className="label">
                      Type
                    </label>
                    <select
                      id="recurring-type"
                      className={`input ${errors.type ? 'input-error' : ''}`}
                      {...register('type', {
                        onChange: () => setValue('categoryId', ''),
                      })}
                    >
                      <option value="EXPENSE">Expense</option>
                      <option value="INCOME">Income</option>
                    </select>
                    {errors.type && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.type.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="recurring-amount" className="label">
                      Amount
                    </label>
                    <input
                      id="recurring-amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`input ${errors.amount ? 'input-error' : ''}`}
                      {...register('amount')}
                      aria-invalid={errors.amount ? 'true' : 'false'}
                      aria-describedby={errors.amount ? 'recurring-amount-error' : undefined}
                    />
                    {errors.amount && (
                      <p
                        id="recurring-amount-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.amount.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="recurring-frequency" className="label">
                      Frequency
                    </label>
                    <select
                      id="recurring-frequency"
                      className={`input ${errors.frequency ? 'input-error' : ''}`}
                      {...register('frequency')}
                    >
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="YEARLY">Yearly</option>
                    </select>
                    {errors.frequency && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.frequency.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="recurring-categoryId" className="label">
                      Category
                    </label>
                    <select
                      id="recurring-categoryId"
                      className={`input ${errors.categoryId ? 'input-error' : ''}`}
                      {...register('categoryId')}
                      disabled={isLoadingCategories}
                      aria-invalid={errors.categoryId ? 'true' : 'false'}
                    >
                      <option value="">
                        {isLoadingCategories ? 'Loading categories...' : 'Select a category'}
                      </option>
                      {typeCategories.map((category) => (
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
                    {!isLoadingCategories && typeCategories.length === 0 && (
                      <p className="mt-1.5 text-sm text-text-muted">
                        No {watchedType.toLowerCase()} categories available.
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="recurring-startDate" className="label">
                      Start date
                    </label>
                    <input
                      id="recurring-startDate"
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

                  <div>
                    <label htmlFor="recurring-endDate" className="label">
                      End date <span className="text-text-muted">(optional)</span>
                    </label>
                    <input
                      id="recurring-endDate"
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
                </div>

                <p className="text-xs text-text-muted">
                  Occurrences are generated on demand and created as normal transactions.
                </p>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeForm}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting
                      ? editingRule
                        ? 'Saving...'
                        : 'Creating...'
                      : editingRule
                        ? 'Save Changes'
                        : 'Create Recurring'}
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
            aria-labelledby="delete-recurring-title"
            aria-describedby="delete-recurring-description"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="delete-recurring-title" className="heading-3">
                Delete recurring transaction?
              </h2>
            </div>
            <p id="delete-recurring-description" className="text-sm text-text-muted mb-6">
              This will permanently delete{' '}
              <span className="font-medium text-text">{deleteTarget.name}</span>. Transactions that
              were already generated are kept. This action cannot be undone.
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
