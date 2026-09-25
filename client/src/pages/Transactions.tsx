import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Plus,
  Search,
  Settings,
    Target,
    Receipt,
    RefreshCw,
    Repeat,
    TrendingUp,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Calendar,
  X,
  ReceiptText,
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
import {
  createTransaction,
  deleteTransaction,
  getTransactions,
  updateTransaction,
} from '../services/transactionApi';
import type { Category } from '../types/category';
import type { Transaction, TransactionType } from '../types/transaction';
import { formatDate, toDateInputValue, todayForDateInput } from '../utils/date';

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;

const transactionSchema = z
  .object({
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
    transactionDate: z
      .string()
      .min(1, 'Transaction date is required')
      .refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid transaction date'),
    description: z.string().max(500, 'Description must be at most 500 characters').optional(),
    paymentMethod: z.string().max(100, 'Payment method must be at most 100 characters').optional(),
    notes: z.string().max(1000, 'Notes must be at most 1000 characters').optional(),
  })
  .strict();

type TransactionForm = z.infer<typeof transactionSchema>;

interface Filters {
  search: string;
  type: '' | TransactionType;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  type: '',
  categoryId: '',
  dateFrom: '',
  dateTo: '',
};

const DEFAULT_LIMIT = 20;

function toFormValues(transaction: Transaction): TransactionForm {
  return {
    type: transaction.type,
    amount: String(transaction.amount),
    categoryId: transaction.categoryId,
    transactionDate: toDateInputValue(transaction.transactionDate),
    description: transaction.description ?? '',
    paymentMethod: transaction.paymentMethod ?? '',
    notes: transaction.notes ?? '',
  };
}

function emptyFormValues(type: TransactionType = 'EXPENSE'): TransactionForm {
  return {
    type,
    amount: '',
    categoryId: '',
    transactionDate: todayForDateInput(),
    description: '',
    paymentMethod: '',
    notes: '',
  };
}

function optionalText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

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

export function Transactions() {
  const { user, logout } = useAuth();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 0,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const hasLoadedOnce = useRef(false);

  const formatAmount = useMemo(() => createCurrencyFormatter(currency), [currency]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TransactionForm>({
    resolver: zodResolver(transactionSchema),
    defaultValues: emptyFormValues(),
  });

  const watchedType = watch('type');
  const watchedCategoryId = watch('categoryId');

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: true },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Habits', href: '/habits', icon: ListChecks, current: false },
    { name: 'Challenges', href: '/challenges', icon: Trophy, current: false },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  const filteredCategories = useMemo(() => {
    if (!watchedType) return categories;
    return categories.filter((category) => category.type === watchedType);
  }, [categories, watchedType]);

  const hasActiveFilters =
    filters.search !== '' ||
    filters.type !== '' ||
    filters.categoryId !== '' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '';

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

  const fetchTransactions = useCallback(
    async (options: { page: number; currentFilters: Filters; initial?: boolean }) => {
      const { page: requestedPage, currentFilters, initial } = options;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const result = await getTransactions({
          page: requestedPage,
          limit: DEFAULT_LIMIT,
          type: currentFilters.type || undefined,
          categoryId: currentFilters.categoryId || undefined,
          dateFrom: currentFilters.dateFrom || undefined,
          dateTo: currentFilters.dateTo || undefined,
          search: currentFilters.search || undefined,
        });

        setTransactions(result.transactions);
        setPagination(result.pagination);
        hasLoadedOnce.current = true;
      } catch (error) {
        if (initial || hasLoadedOnce.current) {
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
    []
  );

  useEffect(() => {
    void fetchProfileCurrency();
    void fetchCategories();
  }, [fetchProfileCurrency, fetchCategories]);

  useEffect(() => {
    void fetchTransactions({ page, currentFilters: filters, initial: !hasLoadedOnce.current });
  }, [page, filters, fetchTransactions]);

  useEffect(() => {
    if (searchInput === filters.search) return;

    const handle = window.setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput }));
      setPage(1);
    }, 400);

    return () => window.clearTimeout(handle);
  }, [searchInput, filters.search]);

  useEffect(() => {
    if (watchedCategoryId && filteredCategories.length > 0) {
      const stillValid = filteredCategories.some((category) => category.id === watchedCategoryId);
      if (!stillValid) {
        setValue('categoryId', '');
      }
    }
  }, [watchedType, filteredCategories, watchedCategoryId, setValue]);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingTransaction(null);
    setActionError(null);
    reset(emptyFormValues());
  }, [reset]);

  const openCreateForm = useCallback(() => {
    setEditingTransaction(null);
    setActionError(null);
    reset(emptyFormValues('EXPENSE'));
    setIsFormOpen(true);
  }, [reset]);

  const openEditForm = useCallback(
    (transaction: Transaction) => {
      setEditingTransaction(transaction);
      setActionError(null);
      reset(toFormValues(transaction));
      setIsFormOpen(true);
    },
    [reset]
  );

  useEffect(() => {
    if (!isFormOpen) return undefined;

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

  const onFilterChange = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput('');
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const onSubmit = async (data: TransactionForm) => {
    setActionError(null);
    setSuccessMessage(null);

    const payload = {
      type: data.type,
      amount: data.amount.trim(),
      categoryId: data.categoryId,
      transactionDate: data.transactionDate,
      description: optionalText(data.description),
      paymentMethod: optionalText(data.paymentMethod),
      notes: optionalText(data.notes),
    };

    try {
      if (editingTransaction) {
        await updateTransaction(editingTransaction.id, payload);
        setSuccessMessage('Transaction updated successfully');
      } else {
        await createTransaction(payload);
        setSuccessMessage('Transaction added successfully');
      }

      closeForm();
      await fetchTransactions({ page, currentFilters: filters });
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setActionError(null);

    try {
      await deleteTransaction(deleteTarget.id);
      setDeleteTarget(null);
      setActionError(null);
      setSuccessMessage('Transaction deleted successfully');

      const isLastOnPage = transactions.length === 1 && page > 1;
      if (isLastOnPage) {
        setPage(page - 1);
      } else {
        await fetchTransactions({ page, currentFilters: filters });
      }
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const showInitialLoading = isLoading && !hasLoadedOnce.current;
  const showEmpty =
    !showInitialLoading &&
    !loadError &&
    transactions.length === 0 &&
    hasLoadedOnce.current;

  if (showInitialLoading) {
    return <Loading />;
  }

  const startItem = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const endItem = Math.min(pagination.page * pagination.limit, pagination.total);

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
            <h1 className="heading-1">Transactions</h1>
            <p className="text-text-muted mt-1">
              Track income and expenses to understand where your money goes.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateForm}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add Transaction
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

        <div className="card mb-6">
          <div className="card-body">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="lg:col-span-2">
                <label htmlFor="filter-search" className="label">
                  Search
                </label>
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted"
                    aria-hidden="true"
                  />
                  <input
                    id="filter-search"
                    type="search"
                    placeholder="Description or notes"
                    className="input pl-10"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="filter-type" className="label">
                  Type
                </label>
                <select
                  id="filter-type"
                  className="input"
                  value={filters.type}
                  onChange={(event) =>
                    onFilterChange('type', event.target.value as Filters['type'])
                  }
                >
                  <option value="">All types</option>
                  <option value="INCOME">Income</option>
                  <option value="EXPENSE">Expense</option>
                </select>
              </div>

              <div>
                <label htmlFor="filter-category" className="label">
                  Category
                </label>
                <select
                  id="filter-category"
                  className="input"
                  value={filters.categoryId}
                  onChange={(event) => onFilterChange('categoryId', event.target.value)}
                  disabled={isLoadingCategories}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="filter-dateFrom" className="label">
                  Date From
                </label>
                <input
                  id="filter-dateFrom"
                  type="date"
                  className="input"
                  value={filters.dateFrom}
                  onChange={(event) => onFilterChange('dateFrom', event.target.value)}
                />
              </div>

              <div>
                <label htmlFor="filter-dateTo" className="label">
                  Date To
                </label>
                <input
                  id="filter-dateTo"
                  type="date"
                  className="input"
                  value={filters.dateTo}
                  onChange={(event) => onFilterChange('dateTo', event.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={clearFilters}
                disabled={!hasActiveFilters && searchInput === ''}
              >
                <X className="w-4 h-4" aria-hidden="true" />
                Clear filters
              </button>
            </div>
          </div>
        </div>

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
                onClick={() => void fetchTransactions({ page, currentFilters: filters, initial: true })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="relative">
          {isFetching && (
            <div
              className="absolute top-0 right-0 z-10 flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted bg-surface border border-border rounded-lg"
              role="status"
            >
              <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Updating...
            </div>
          )}

          {showEmpty ? (
            <div className="card">
              <div className="card-body text-center py-16">
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                  <ReceiptText className="w-8 h-8 text-primary" aria-hidden="true" />
                </div>
                {hasActiveFilters || searchInput ? (
                  <>
                    <h2 className="heading-2 mb-3">No matching transactions</h2>
                    <p className="text-text-muted mb-8 max-w-md mx-auto">
                      No transactions match your current filters. Try adjusting or clearing them.
                    </p>
                    <button type="button" className="btn-secondary" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="heading-2 mb-3">No transactions yet</h2>
                    <p className="text-text-muted mb-8 max-w-md mx-auto">
                      Add your first transaction to start tracking your income and expenses.
                    </p>
                    <button type="button" className="btn-primary" onClick={openCreateForm}>
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Add Transaction
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-background border-b border-border">
                      <tr className="text-left text-text-muted">
                        <th scope="col" className="px-4 py-3 font-medium">
                          Date
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Description
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Category
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Type
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          Payment Method
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium text-right">
                          Amount
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {transactions.map((transaction) => (
                        <tr key={transaction.id} className="hover:bg-background">
                          <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                            {formatDate(transaction.transactionDate)}
                          </td>
                          <td className="px-4 py-3 text-text">
                            {transaction.description || (
                              <span className="text-text-muted">No description</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full bg-primary flex-shrink-0"
                                aria-hidden="true"
                              />
                              {transaction.category.name}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                transaction.type === 'INCOME'
                                  ? 'badge badge-success'
                                  : 'badge badge-warning'
                              }
                            >
                              {transaction.type === 'INCOME' ? 'Income' : 'Expense'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text-muted">
                            {transaction.paymentMethod || '—'}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-medium whitespace-nowrap ${
                              transaction.type === 'INCOME' ? 'text-success' : 'text-error'
                            }`}
                          >
                            {transaction.type === 'INCOME' ? '+' : '−'}
                            {formatAmount(transaction.amount)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                className="btn-ghost p-2"
                                aria-label={`Edit transaction ${transaction.description || transaction.id}`}
                                onClick={() => openEditForm(transaction)}
                              >
                                <Pencil className="w-4 h-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn-ghost p-2 text-error hover:bg-red-50"
                                aria-label={`Delete transaction ${transaction.description || transaction.id}`}
                                onClick={() => setDeleteTarget(transaction)}
                              >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {transactions.map((transaction) => (
                  <div key={transaction.id} className="card">
                    <div className="card-body p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <p className="font-medium text-text truncate">
                            {transaction.description || 'No description'}
                          </p>
                          <p className="text-sm text-text-muted mt-0.5">
                            {transaction.category.name}
                          </p>
                        </div>
                        <span
                          className={
                            transaction.type === 'INCOME' ? 'badge badge-success' : 'badge badge-warning'
                          }
                        >
                          {transaction.type === 'INCOME' ? 'Income' : 'Expense'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5 text-sm text-text-muted">
                          <Calendar className="w-4 h-4" aria-hidden="true" />
                          {formatDate(transaction.transactionDate)}
                        </div>
                        <p
                          className={`font-semibold ${
                            transaction.type === 'INCOME' ? 'text-success' : 'text-error'
                          }`}
                        >
                          {transaction.type === 'INCOME' ? '+' : '−'}
                          {formatAmount(transaction.amount)}
                        </p>
                      </div>

                      {transaction.paymentMethod && (
                        <p className="text-xs text-text-muted mt-2">
                          Paid via {transaction.paymentMethod}
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          aria-label={`Edit transaction ${transaction.description || transaction.id}`}
                          onClick={() => openEditForm(transaction)}
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-error hover:bg-red-50"
                          aria-label={`Delete transaction ${transaction.description || transaction.id}`}
                          onClick={() => setDeleteTarget(transaction)}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-sm text-text-muted" aria-live="polite">
                  Showing {startItem}–{endItem} of {pagination.total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={pagination.page <= 1 || isFetching}
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    Previous
                  </button>
                  <span className="text-sm text-text-muted px-2">
                    Page {Math.max(pagination.page, 1)} of{' '}
                    {Math.max(pagination.totalPages, 1)}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={
                      pagination.totalPages === 0 ||
                      pagination.page >= pagination.totalPages ||
                      isFetching
                    }
                  >
                    Next
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
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
            aria-labelledby="transaction-form-title"
          >
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-border bg-surface rounded-t-xl">
              <h2 id="transaction-form-title" className="heading-3">
                {editingTransaction ? 'Edit Transaction' : 'Add Transaction'}
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
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-5"
                noValidate
              >
                {actionError && (
                  <div
                    className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                  >
                    {actionError}
                  </div>
                )}

                <fieldset className="border-0 p-0 m-0">
                  <legend className="label p-0 mb-2">Type</legend>
                  <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Transaction type">
                    <label
                      className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium cursor-pointer transition-colors min-h-[44px] ${
                        watchedType === 'EXPENSE'
                          ? 'border-error bg-red-50 text-error'
                          : 'border-border bg-surface text-text-muted hover:bg-background'
                      }`}
                    >
                      <input
                        type="radio"
                        value="EXPENSE"
                        className="sr-only"
                        {...register('type')}
                      />
                      Expense
                    </label>
                    <label
                      className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium cursor-pointer transition-colors min-h-[44px] ${
                        watchedType === 'INCOME'
                          ? 'border-primary bg-primary-light text-primary'
                          : 'border-border bg-surface text-text-muted hover:bg-background'
                      }`}
                    >
                      <input
                        type="radio"
                        value="INCOME"
                        className="sr-only"
                        {...register('type')}
                      />
                      Income
                    </label>
                  </div>
                  {errors.type && (
                    <p className="mt-1.5 text-sm text-error" role="alert">
                      {errors.type.message}
                    </p>
                  )}
                </fieldset>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="amount" className="label">
                      Amount
                    </label>
                    <input
                      id="amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`input ${errors.amount ? 'input-error' : ''}`}
                      {...register('amount')}
                      aria-invalid={errors.amount ? 'true' : 'false'}
                      aria-describedby={errors.amount ? 'amount-error' : undefined}
                    />
                    {errors.amount && (
                      <p id="amount-error" className="mt-1.5 text-sm text-error" role="alert">
                        {errors.amount.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="transactionDate" className="label">
                      Date
                    </label>
                    <input
                      id="transactionDate"
                      type="date"
                      className={`input ${errors.transactionDate ? 'input-error' : ''}`}
                      {...register('transactionDate')}
                      aria-invalid={errors.transactionDate ? 'true' : 'false'}
                      aria-describedby={
                        errors.transactionDate ? 'transactionDate-error' : undefined
                      }
                    />
                    {errors.transactionDate && (
                      <p
                        id="transactionDate-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.transactionDate.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="categoryId" className="label">
                    Category
                  </label>
                  <select
                    id="categoryId"
                    className={`input ${errors.categoryId ? 'input-error' : ''}`}
                    {...register('categoryId')}
                    disabled={isLoadingCategories}
                    aria-invalid={errors.categoryId ? 'true' : 'false'}
                    aria-describedby={errors.categoryId ? 'categoryId-error' : undefined}
                  >
                    <option value="">
                      {isLoadingCategories ? 'Loading categories...' : 'Select a category'}
                    </option>
                    {filteredCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                        {category.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  {errors.categoryId && (
                    <p id="categoryId-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.categoryId.message}
                    </p>
                  )}
                  {!isLoadingCategories && filteredCategories.length === 0 && (
                    <p className="mt-1.5 text-sm text-text-muted">
                      No {watchedType === 'INCOME' ? 'income' : 'expense'} categories available.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="description" className="label">
                    Description
                  </label>
                  <input
                    id="description"
                    type="text"
                    placeholder="What was this for?"
                    className={`input ${errors.description ? 'input-error' : ''}`}
                    {...register('description')}
                    aria-invalid={errors.description ? 'true' : 'false'}
                    aria-describedby={errors.description ? 'description-error' : undefined}
                  />
                  {errors.description && (
                    <p id="description-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.description.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="paymentMethod" className="label">
                    Payment Method
                  </label>
                  <input
                    id="paymentMethod"
                    type="text"
                    placeholder="e.g. Card, Cash, UPI"
                    className={`input ${errors.paymentMethod ? 'input-error' : ''}`}
                    {...register('paymentMethod')}
                    aria-invalid={errors.paymentMethod ? 'true' : 'false'}
                    aria-describedby={errors.paymentMethod ? 'paymentMethod-error' : undefined}
                  />
                  {errors.paymentMethod && (
                    <p
                      id="paymentMethod-error"
                      className="mt-1.5 text-sm text-error"
                      role="alert"
                    >
                      {errors.paymentMethod.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="notes" className="label">
                    Notes
                  </label>
                  <textarea
                    id="notes"
                    rows={3}
                    placeholder="Optional notes"
                    className={`input ${errors.notes ? 'input-error' : ''}`}
                    {...register('notes')}
                    aria-invalid={errors.notes ? 'true' : 'false'}
                    aria-describedby={errors.notes ? 'notes-error' : undefined}
                  />
                  {errors.notes && (
                    <p id="notes-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.notes.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                  <button type="button" className="btn-secondary" onClick={closeForm}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting
                      ? editingTransaction
                        ? 'Saving...'
                        : 'Adding...'
                      : editingTransaction
                        ? 'Save Changes'
                        : 'Add Transaction'}
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
            aria-labelledby="delete-transaction-title"
            aria-describedby="delete-transaction-description"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="delete-transaction-title" className="heading-3">
                Delete transaction?
              </h2>
            </div>
            <p id="delete-transaction-description" className="text-sm text-text-muted mb-6">
              This will permanently delete{' '}
              <span className="font-medium text-text">
                {deleteTarget.description || formatDate(deleteTarget.transactionDate)}
              </span>{' '}
              ({formatAmount(deleteTarget.amount)}). This action cannot be undone.
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
