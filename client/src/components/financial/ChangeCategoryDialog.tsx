import { useEffect, useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import { X } from 'lucide-react';
import { CategorizationSuggestion } from './CategorizationSuggestion';
import { financialApi } from '../../services/financialApi';
import { getApiErrorMessage } from '../../services/error';
import type {
  CategorySummary,
  CategorizationPreview,
  ImportedTransaction,
} from '../../types/financial';

interface ChangeCategoryDialogProps {
  transaction: ImportedTransaction;
  categories: CategorySummary[];
  onClose: () => void;
  onUpdated: (updated: ImportedTransaction) => void;
}

export function ChangeCategoryDialog({
  transaction,
  categories,
  onClose,
  onUpdated,
}: ChangeCategoryDialogProps) {
  const [categoryId, setCategoryId] = useState(transaction.category.id);
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [preview, setPreview] = useState<CategorizationPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const options = useMemo(
    () => categories.filter((category) => category.type === transaction.type),
    [categories, transaction.type]
  );

  useEffect(() => {
    let cancelled = false;

    setIsPreviewLoading(true);
    setPreviewError(null);

    financialApi
      .previewCategorization({
        type: transaction.type,
        merchant: transaction.merchant,
        description: transaction.description,
        paymentMethod: transaction.paymentMethod,
        paymentChannel: transaction.paymentChannel,
      })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreview(null);
        if (isAxiosError(error) && error.response?.status === 404) {
          setPreviewError(null);
        } else {
          setPreviewError(getApiErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [transaction.id, transaction.type, transaction.merchant, transaction.description, transaction.paymentMethod, transaction.paymentChannel]);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!categoryId) {
      setSubmitError('Please choose a category');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const updated = await financialApi.recategorizeImportedTransaction(
        transaction.id,
        categoryId,
        remember && Boolean(transaction.merchant)
      );
      onUpdated(updated);
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
        aria-labelledby="change-category-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id="change-category-title" className="heading-3">
              Change Category
            </h2>
            <p className="text-sm text-text-muted truncate mt-1">
              {transaction.merchant || transaction.description || 'Imported transaction'}
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

        <div className="mb-4">
          <CategorizationSuggestion
            preview={preview}
            isLoading={isPreviewLoading}
            error={previewError}
            onUseSuggestion={
              preview ? () => setCategoryId(preview.category.id) : undefined
            }
          />
        </div>

        <div className="mb-4">
          <label htmlFor="change-category-select" className="label">
            Category
          </label>
          <select
            id="change-category-select"
            className="input"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setSubmitError(null);
            }}
            disabled={isSubmitting}
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
              disabled={!transaction.merchant || isSubmitting}
            />
            <span>Remember this category for this merchant</span>
          </label>
          <p className="text-xs text-text-muted mt-1">
            {transaction.merchant
              ? `Future imported transactions from ${transaction.merchant} will use this category.`
              : 'This transaction has no merchant, so the preference cannot be remembered.'}
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
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
