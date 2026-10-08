import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { financialApi } from '../../services/financialApi';
import { getApiErrorMessage } from '../../services/error';
import type { CategorySummary, ImportedTransaction } from '../../types/financial';

const BULK_LIMIT = 100;

interface BulkRecategorizeDialogProps {
  transactions: ImportedTransaction[];
  categories: CategorySummary[];
  onClose: () => void;
  onDone: (transactionCount: number) => void;
}

export function BulkRecategorizeDialog({
  transactions,
  categories,
  onClose,
  onDone,
}: BulkRecategorizeDialogProps) {
  const [categoryId, setCategoryId] = useState('');
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const transactionTypes = useMemo(
    () => Array.from(new Set(transactions.map((transaction) => transaction.type))),
    [transactions]
  );
  const isMixedType = transactionTypes.length > 1;
  const isOverLimit = transactions.length > BULK_LIMIT;

  const options = useMemo(
    () =>
      isMixedType
        ? []
        : categories.filter((category) => category.type === transactionTypes[0]),
    [categories, isMixedType, transactionTypes]
  );

  const handleSubmit = async () => {
    if (isSubmitting || isMixedType || isOverLimit) return;
    if (!categoryId) {
      setSubmitError('Please choose a category');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await financialApi.bulkRecategorize({
        transactionIds: transactions.map((transaction) => transaction.id),
        categoryId,
        rememberForMerchant: remember,
      });
      onDone(result.transactionCount);
    } catch (error) {
      setSubmitError(getApiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="presentation">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !isSubmitting && onClose()}
        aria-hidden="true"
      />
      <div
        className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-recategorize-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id="bulk-recategorize-title" className="heading-3">
              Recategorize {transactions.length} transaction
              {transactions.length === 1 ? '' : 's'}
            </h2>
            <p className="text-sm text-text-muted mt-1">
              {transactions.length} selected
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost p-2"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {isMixedType && (
          <div
            className="rounded-lg border border-warning bg-yellow-50 px-4 py-3 text-sm mb-4"
            role="alert"
          >
            The selection mixes income and expense transactions. Recategorize them in
            separate batches.
          </div>
        )}

        {isOverLimit && (
          <div
            className="rounded-lg border border-warning bg-yellow-50 px-4 py-3 text-sm mb-4"
            role="alert"
          >
            A maximum of {BULK_LIMIT} transactions can be recategorized at once.
          </div>
        )}

        <div className="mb-4">
          <label htmlFor="bulk-category-select" className="label">
            Category
          </label>
          <select
            id="bulk-category-select"
            className="input"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setSubmitError(null);
            }}
            disabled={isSubmitting || isMixedType}
          >
            <option value="">Select a category</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="flex items-start gap-2 text-sm text-text cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={isSubmitting}
            />
            <span>Remember category for these merchants</span>
          </label>
          <p className="text-xs text-text-muted mt-1">
            Creates a merchant rule so future imports use this category.
          </p>
        </div>

        {submitError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
            role="alert"
          >
            {submitError}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || isMixedType || isOverLimit}
          >
            {isSubmitting ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
