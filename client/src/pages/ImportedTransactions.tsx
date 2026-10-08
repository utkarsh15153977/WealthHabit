import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronLeft, ChevronRight, FilterX } from 'lucide-react';
import { Loading } from '../components/Loading';
import { BulkRecategorizeDialog } from '../components/financial/BulkRecategorizeDialog';
import { ChangeCategoryDialog } from '../components/financial/ChangeCategoryDialog';
import { ConfirmDialog } from '../components/financial/ConfirmDialog';
import { ImportedTransactionRow } from '../components/financial/ImportedTransactionRow';
import { financialApi } from '../services/financialApi';
import { getCategories } from '../services/categoryApi';
import { getMyProfile } from '../services/userApi';
import { getApiErrorMessage } from '../services/error';
import type { Category } from '../types/category';
import type { FinancialAccount, ImportedTransaction, TransactionType } from '../types/financial';

const DEFAULT_LIMIT = 20;

interface Filters {
  type: '' | TransactionType;
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  financialAccountId: string;
}

const EMPTY_FILTERS: Filters = {
  type: '',
  dateFrom: '',
  dateTo: '',
  categoryId: '',
  financialAccountId: '',
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

export function ImportedTransactions() {
  const [transactions, setTransactions] = useState<ImportedTransaction[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 0,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [changeTarget, setChangeTarget] = useState<ImportedTransaction | null>(null);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<ImportedTransaction | null>(null);
  const [convertTarget, setConvertTarget] = useState<ImportedTransaction | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const hasLoadedOnce = useRef(false);

  const formatAmount = useMemo(() => createCurrencyFormatter(currency), [currency]);

  const hasActiveFilters = Object.values(filters).some((value) => value !== '');

  const fetchList = useCallback(
    async (options: { page: number; currentFilters: Filters; initial?: boolean }) => {
      const { page: requestedPage, currentFilters, initial } = options;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const result = await financialApi.listImportedTransactions({
          page: requestedPage,
          limit: DEFAULT_LIMIT,
          type: currentFilters.type || undefined,
          dateFrom: currentFilters.dateFrom || undefined,
          dateTo: currentFilters.dateTo || undefined,
          categoryId: currentFilters.categoryId || undefined,
          financialAccountId: currentFilters.financialAccountId || undefined,
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

  const fetchSupportingData = useCallback(async () => {
    try {
      const profile = await getMyProfile();
      setCurrency(profile.profile.financialProfile.currency);
    } catch {
      setCurrency(null);
    }

    try {
      const result = await getCategories();
      setCategories(result.categories);
    } catch {
      setCategories([]);
    }

    try {
      const result = await financialApi.listFinancialAccounts();
      setAccounts(result);
    } catch {
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    void fetchSupportingData();
  }, [fetchSupportingData]);

  useEffect(() => {
    void fetchList({ page, currentFilters: filters, initial: !hasLoadedOnce.current });
  }, [page, filters, fetchList]);

  useEffect(() => {
    if (!changeTarget && !isBulkOpen && !unlinkTarget && !convertTarget) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingId) return;
      setChangeTarget(null);
      setIsBulkOpen(false);
      setUnlinkTarget(null);
      setConvertTarget(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeTarget, isBulkOpen, unlinkTarget, convertTarget, pendingId]);

  const onFilterChange = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
    setSelectedIds([]);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setSelectedIds([]);
  };

  const refresh = useCallback(() => {
    void fetchList({ page, currentFilters: filters });
  }, [fetchList, page, filters]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectedTransactions = useMemo(
    () => transactions.filter((transaction) => selectedIds.includes(transaction.id)),
    [transactions, selectedIds]
  );

  const handleUnlink = async () => {
    if (!unlinkTarget || pendingId) return;
    setPendingId(unlinkTarget.id);
    setConfirmError(null);

    try {
      await financialApi.unlinkImportedTransaction(unlinkTarget.id);
      setUnlinkTarget(null);
      setSuccessMessage('Transaction unlinked');
      refresh();
    } catch (error) {
      setConfirmError(getApiErrorMessage(error));
    } finally {
      setPendingId(null);
    }
  };

  const handleConvert = async () => {
    if (!convertTarget || pendingId) return;
    setPendingId(convertTarget.id);
    setConfirmError(null);

    try {
      await financialApi.convertImportedTransactionToManual(convertTarget.id);
      setConvertTarget(null);
      setSuccessMessage('Transaction converted to manual');
      refresh();
    } catch (error) {
      setConfirmError(getApiErrorMessage(error));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="page-container">
      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1">Imported Transactions</h1>
            <p className="text-text-muted mt-1">
              Review and recategorize transactions imported from your connected accounts.
            </p>
          </div>
          <Link to="/financial-connections" className="btn-secondary self-start sm:self-auto">
            <Building2 className="w-4 h-4" aria-hidden="true" />
            Financial Connections
          </Link>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-success bg-green-50 px-4 py-3 text-sm text-green-700 mb-6"
            role="status"
          >
            {successMessage}
          </div>
        )}

        {actionError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
          >
            {actionError}
          </div>
        )}

        <div className="card mb-6">
          <div className="card-body">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-text">Filters</h2>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="btn-ghost btn-sm ml-auto"
                  onClick={clearFilters}
                >
                  <FilterX className="w-4 h-4" aria-hidden="true" />
                  Clear filters
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label htmlFor="filter-type" className="label">
                  Type
                </label>
                <select
                  id="filter-type"
                  className="input"
                  value={filters.type}
                  onChange={(event) => onFilterChange('type', event.target.value as Filters['type'])}
                >
                  <option value="">All types</option>
                  <option value="INCOME">Income</option>
                  <option value="EXPENSE">Expense</option>
                </select>
              </div>

              <div>
                <label htmlFor="filter-date-from" className="label">
                  From
                </label>
                <input
                  id="filter-date-from"
                  type="date"
                  className="input"
                  value={filters.dateFrom}
                  onChange={(event) => onFilterChange('dateFrom', event.target.value)}
                />
              </div>

              <div>
                <label htmlFor="filter-date-to" className="label">
                  To
                </label>
                <input
                  id="filter-date-to"
                  type="date"
                  className="input"
                  value={filters.dateTo}
                  onChange={(event) => onFilterChange('dateTo', event.target.value)}
                />
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
                <label htmlFor="filter-account" className="label">
                  Account
                </label>
                <select
                  id="filter-account"
                  className="input"
                  value={filters.financialAccountId}
                  onChange={(event) => onFilterChange('financialAccountId', event.target.value)}
                >
                  <option value="">All accounts</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div
            className="rounded-lg border border-border bg-surface px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            role="status"
          >
            <span className="text-sm text-text">{selectedIds.length} selected</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setSelectedIds([])}
              >
                Clear selection
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => setIsBulkOpen(true)}
                disabled={isFetching}
              >
                Recategorize
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <Loading />
        ) : loadError ? (
          <div>
            <div
              className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
              role="alert"
            >
              {loadError}
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm mt-3"
              onClick={() => void fetchList({ page, currentFilters: filters, initial: true })}
            >
              Try again
            </button>
          </div>
        ) : transactions.length === 0 ? (
          hasActiveFilters ? (
            <div className="card">
              <div className="card-body text-center py-12">
                <p className="heading-4">No transactions match your filters.</p>
                <button type="button" className="btn-secondary mt-4" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-body text-center py-12">
                <p className="heading-4">No imported transactions.</p>
                <p className="text-text-muted mt-2 text-sm">
                  Sync a connected account to bring in transactions.
                </p>
                <Link to="/financial-connections" className="btn-primary mt-6">
                  Financial Connections
                </Link>
              </div>
            </div>
          )
        ) : (
          <>
            <p className="text-sm text-text-muted mb-3" aria-live="polite">
              {pagination.total} transaction{pagination.total === 1 ? '' : 's'}
              {isFetching ? ' · Refreshing...' : ''}
            </p>

            <ul className="space-y-4">
              {transactions.map((transaction) => (
                <ImportedTransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  isSelected={selectedIds.includes(transaction.id)}
                  isPending={pendingId === transaction.id}
                  formatAmount={formatAmount}
                  onToggleSelect={() => toggleSelected(transaction.id)}
                  onChangeCategory={() => {
                    setActionError(null);
                    setChangeTarget(transaction);
                  }}
                  onUnlink={() => {
                    setConfirmError(null);
                    setUnlinkTarget(transaction);
                  }}
                  onConvert={() => {
                    setConfirmError(null);
                    setConvertTarget(transaction);
                  }}
                />
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-6">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setPage((current) => Math.max(current - 1, 1))}
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
          </>
        )}
      </main>

      {changeTarget && (
        <ChangeCategoryDialog
          transaction={changeTarget}
          categories={categories}
          onClose={() => setChangeTarget(null)}
          onUpdated={() => {
            setChangeTarget(null);
            setSuccessMessage('Category updated');
            refresh();
          }}
        />
      )}

      {isBulkOpen && selectedTransactions.length > 0 && (
        <BulkRecategorizeDialog
          transactions={selectedTransactions}
          categories={categories}
          onClose={() => setIsBulkOpen(false)}
          onDone={(count) => {
            setIsBulkOpen(false);
            setSelectedIds([]);
            setSuccessMessage(`${count} transaction${count === 1 ? '' : 's'} recategorized`);
            refresh();
          }}
        />
      )}

      {unlinkTarget && (
        <ConfirmDialog
          title="Unlink this imported transaction?"
          description="The transaction will remain in your transaction history, but it will no longer be associated with this financial account."
          confirmLabel="Unlink"
          danger
          isPending={pendingId === unlinkTarget.id}
          error={confirmError}
          onCancel={() => setUnlinkTarget(null)}
          onConfirm={() => void handleUnlink()}
        />
      )}

      {convertTarget && (
        <ConfirmDialog
          title="Convert this imported transaction to manual?"
          description="It will no longer appear in Imported Transactions."
          confirmLabel="Convert"
          isPending={pendingId === convertTarget.id}
          error={confirmError}
          onCancel={() => setConvertTarget(null)}
          onConfirm={() => void handleConvert()}
        />
      )}
    </div>
  );
}
