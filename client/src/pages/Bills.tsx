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
import { billApi } from '../services/billApi';
import { formatDate, toDateInputValue, todayForDateInput } from '../utils/date';
import type { Category } from '../types/category';
import type { Bill, BillStatus } from '../types/bill';

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const billSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters'),
    amount: z
      .string()
      .trim()
      .min(1, 'Amount is required')
      .regex(MONEY_PATTERN, 'Amount must be a positive number with up to 2 decimal places')
      .refine((value) => Number(value) > 0, 'Amount must be greater than zero')
      .refine((value) => Number(value) <= MONEY_MAX, 'Amount exceeds the maximum allowed value'),
    categoryId: z.string(),
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'], {
      errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY, MONTHLY or YEARLY' }),
    }),
    dueDate: z.string().refine((value) => DATE_PATTERN.test(value), 'Due date is required'),
    status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'], {
      errorMap: () => ({ message: 'Status must be PENDING, PAID, OVERDUE or CANCELLED' }),
    }),
    autoPay: z.boolean(),
  })
  .strict();

type BillForm = z.infer<typeof billSchema>;

const FREQUENCY_LABELS: Record<Bill['frequency'], string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
};

const STATUS_LABELS: Record<BillStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

const STATUS_BADGES: Record<BillStatus, string> = {
  PENDING: 'badge badge-warning',
  PAID: 'badge badge-success',
  OVERDUE: 'badge badge-error',
  CANCELLED: 'badge badge-info',
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

function emptyFormValues(): BillForm {
  return {
    name: '',
    amount: '',
    categoryId: '',
    frequency: 'MONTHLY',
    dueDate: todayForDateInput(),
    status: 'PENDING',
    autoPay: false,
  };
}

function toFormValues(bill: Bill): BillForm {
  return {
    name: bill.name,
    amount: String(bill.amount),
    categoryId: bill.categoryId ?? '',
    frequency: bill.frequency,
    dueDate: toDateInputValue(bill.dueDate),
    status: bill.status,
    autoPay: bill.autoPay,
  };
}

export function Bills() {
  const { user, logout } = useAuth();

  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [currency, setCurrency] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<BillStatus | ''>('');
  const [monthFilter, setMonthFilter] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BillForm>({
    resolver: zodResolver(billSchema),
    defaultValues: emptyFormValues(),
  });

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: true },
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
      const result = await getCategories();
      setCategories(result.categories);
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsLoadingCategories(false);
    }
  }, []);

  const fetchBills = useCallback(
    async (options: { initial?: boolean } = {}) => {
      const { initial = false } = options;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const result = await billApi.getBills({
          status: statusFilter ? statusFilter : undefined,
          month: monthFilter || undefined,
        });
        setBills(result.bills);
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
    [hasLoadedOnce, statusFilter, monthFilter]
  );

  useEffect(() => {
    void fetchProfileCurrency();
    void fetchCategories();
  }, [fetchProfileCurrency, fetchCategories]);

  useEffect(() => {
    void fetchBills({ initial: !hasLoadedOnce });
  }, [fetchBills, hasLoadedOnce]);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingBill(null);
    setActionError(null);
    reset(emptyFormValues());
  }, [reset]);

  const openCreateForm = useCallback(() => {
    setEditingBill(null);
    setActionError(null);
    setSuccessMessage(null);
    reset(emptyFormValues());
    setIsFormOpen(true);
  }, [reset]);

  const openEditForm = useCallback(
    (bill: Bill) => {
      setEditingBill(bill);
      setActionError(null);
      setSuccessMessage(null);
      reset(toFormValues(bill));
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

  const onSubmit = async (data: BillForm) => {
    setActionError(null);
    setSuccessMessage(null);

    const payload = {
      name: data.name.trim(),
      categoryId: data.categoryId ? data.categoryId : null,
      amount: data.amount.trim(),
      frequency: data.frequency,
      dueDate: data.dueDate,
      status: data.status,
      autoPay: data.autoPay,
    };

    try {
      if (editingBill) {
        await billApi.updateBill(editingBill.id, payload);
        setSuccessMessage('Bill updated successfully');
      } else {
        await billApi.createBill(payload);
        setSuccessMessage('Bill created successfully');
      }

      closeForm();
      await fetchBills();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const setBillStatus = async (bill: Bill, status: BillStatus) => {
    setActionError(null);
    setSuccessMessage(null);

    try {
      await billApi.updateBill(bill.id, { status });
      setSuccessMessage(
        status === 'PAID'
          ? `"${bill.name}" marked as paid`
          : `"${bill.name}" status set to ${STATUS_LABELS[status].toLowerCase()}`
      );
      await fetchBills();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setActionError(null);

    try {
      await billApi.deleteBill(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage('Bill deleted successfully');
      await fetchBills();
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

  const showEmpty =
    !isLoading && !loadError && bills.length === 0 && hasLoadedOnce && !statusFilter && !monthFilter;
  const showNoMatches =
    !isLoading &&
    !loadError &&
    bills.length === 0 &&
    hasLoadedOnce &&
    (Boolean(statusFilter) || Boolean(monthFilter));

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
            <h1 className="heading-1">Bills</h1>
            <p className="text-text-muted mt-1">
              Track upcoming bills and mark them paid. Due bills never spend money on their own.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateForm}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add Bill
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
                onClick={() => void fetchBills({ initial: true })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <label htmlFor="bills-status-filter" className="label">
              Status
            </label>
            <select
              id="bills-status-filter"
              className="input sm:w-44"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as BillStatus | '')}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div>
            <label htmlFor="bills-month-filter" className="label">
              Due month
            </label>
            <input
              id="bills-month-filter"
              type="month"
              className="input sm:w-44"
              value={monthFilter}
              onChange={(event) => setMonthFilter(event.target.value)}
            />
          </div>
          {(statusFilter || monthFilter) && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setStatusFilter('');
                setMonthFilter('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {showEmpty && (
          <div className="card">
            <div className="card-body text-center py-16">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                <Receipt className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No bills yet</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Add your rent, utilities, internet or any recurring bill to see what is due and when.
                Marking a bill paid records nothing against your spending.
              </p>
              <button type="button" className="btn-primary" onClick={openCreateForm}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Bill
              </button>
            </div>
          </div>
        )}

        {showNoMatches && (
          <div className="card">
            <div className="card-body text-center py-12">
              <h2 className="heading-3 mb-2">No bills match your filters</h2>
              <p className="text-text-muted">Try a different status or month.</p>
            </div>
          </div>
        )}

        {!loadError && bills.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {bills.map((bill) => (
              <div key={bill.id} className="card">
                <div className="card-body">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <h2 className="heading-4 truncate">{bill.name}</h2>
                      <p className="text-xs text-text-muted mt-0.5">
                        {bill.category ? bill.category.name : 'Uncategorized'} ·{' '}
                        {FREQUENCY_LABELS[bill.frequency]}
                      </p>
                    </div>
                    <span className={STATUS_BADGES[bill.status]}>
                      {STATUS_LABELS[bill.status]}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="text-lg font-semibold text-error">
                      {formatAmount(bill.amount)}
                    </span>
                    <span className="flex items-center gap-2">
                      {bill.dueState === 'DUE' && (
                        <span className="badge badge-warning">Due today</span>
                      )}
                      {bill.dueState === 'OVERDUE' && (
                        <span className="badge badge-error">Overdue</span>
                      )}
                    </span>
                  </div>

                  <dl className="text-sm space-y-1.5 mb-4">
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-muted">Next due</dt>
                      <dd className="text-text font-medium">
                        {formatDate(bill.nextDueDate)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-muted">Original due date</dt>
                      <dd className="text-text">{formatDate(bill.dueDate)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-muted">Autopay</dt>
                      <dd className="text-text">{bill.autoPay ? 'On' : 'Off'}</dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-border">
                    {bill.status !== 'PAID' && bill.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        aria-label={`Mark ${bill.name} as paid`}
                        onClick={() => void setBillStatus(bill, 'PAID')}
                      >
                        Mark Paid
                      </button>
                    )}
                    {bill.status === 'PAID' && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        aria-label={`Reopen ${bill.name}`}
                        onClick={() => void setBillStatus(bill, 'PENDING')}
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      aria-label={`Edit ${bill.name}`}
                      onClick={() => openEditForm(bill)}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-error hover:bg-red-50"
                      aria-label={`Delete ${bill.name}`}
                      onClick={() => setDeleteTarget(bill)}
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

        {isFetching && bills.length > 0 && (
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
            aria-labelledby="bill-form-title"
          >
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface rounded-t-xl">
              <h2 id="bill-form-title" className="heading-3">
                {editingBill ? 'Edit Bill' : 'Add Bill'}
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
                  <label htmlFor="bill-name" className="label">
                    Name
                  </label>
                  <input
                    id="bill-name"
                    type="text"
                    placeholder="e.g. Electricity, Internet, Rent"
                    className={`input ${errors.name ? 'input-error' : ''}`}
                    {...register('name')}
                    aria-invalid={errors.name ? 'true' : 'false'}
                    aria-describedby={errors.name ? 'bill-name-error' : undefined}
                  />
                  {errors.name && (
                    <p id="bill-name-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bill-amount" className="label">
                      Amount
                    </label>
                    <input
                      id="bill-amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`input ${errors.amount ? 'input-error' : ''}`}
                      {...register('amount')}
                      aria-invalid={errors.amount ? 'true' : 'false'}
                      aria-describedby={errors.amount ? 'bill-amount-error' : undefined}
                    />
                    {errors.amount && (
                      <p
                        id="bill-amount-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.amount.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="bill-categoryId" className="label">
                      Category <span className="text-text-muted">(optional)</span>
                    </label>
                    <select
                      id="bill-categoryId"
                      className={`input ${errors.categoryId ? 'input-error' : ''}`}
                      {...register('categoryId')}
                      disabled={isLoadingCategories}
                    >
                      <option value="">
                        {isLoadingCategories ? 'Loading categories...' : 'No category'}
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
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bill-frequency" className="label">
                      Frequency
                    </label>
                    <select
                      id="bill-frequency"
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
                    <label htmlFor="bill-dueDate" className="label">
                      Due date
                    </label>
                    <input
                      id="bill-dueDate"
                      type="date"
                      className={`input ${errors.dueDate ? 'input-error' : ''}`}
                      {...register('dueDate')}
                      aria-invalid={errors.dueDate ? 'true' : 'false'}
                    />
                    {errors.dueDate && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.dueDate.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bill-status" className="label">
                      Status
                    </label>
                    <select
                      id="bill-status"
                      className={`input ${errors.status ? 'input-error' : ''}`}
                      {...register('status')}
                    >
                      <option value="PENDING">Pending</option>
                      <option value="PAID">Paid</option>
                      <option value="OVERDUE">Overdue</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                    {errors.status && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.status.message}
                      </p>
                    )}
                  </div>

                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
                      <input type="checkbox" className="w-4 h-4" {...register('autoPay')} />
                      Autopay enabled
                    </label>
                  </div>
                </div>

                <p className="text-xs text-text-muted">
                  Marking a bill as paid moves the next due date forward. No transaction is created
                  automatically.
                </p>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeForm}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting
                      ? editingBill
                        ? 'Saving...'
                        : 'Adding...'
                      : editingBill
                        ? 'Save Changes'
                        : 'Add Bill'}
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
            aria-labelledby="delete-bill-title"
            aria-describedby="delete-bill-description"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="delete-bill-title" className="heading-3">
                Delete bill?
              </h2>
            </div>
            <p id="delete-bill-description" className="text-sm text-text-muted mb-6">
              This will permanently delete <span className="font-medium text-text">{deleteTarget.name}</span>.
              Transactions are not affected. This action cannot be undone.
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
