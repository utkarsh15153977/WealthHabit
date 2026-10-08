import { RefreshCw, Unlink, Wand2 } from 'lucide-react';
import type { ImportedTransaction } from '../../types/financial';

interface TransactionReviewActionsProps {
  transaction: ImportedTransaction;
  isPending: boolean;
  onChangeCategory: () => void;
  onUnlink: () => void;
  onConvert: () => void;
}

export function TransactionReviewActions({
  transaction,
  isPending,
  onChangeCategory,
  onUnlink,
  onConvert,
}: TransactionReviewActionsProps) {
  const isLinked = Boolean(transaction.financialAccountId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={onChangeCategory}
        disabled={isPending}
        aria-label={`Change category for ${
          transaction.merchant || transaction.description || 'transaction'
        }`}
      >
        <Wand2 className="w-4 h-4" aria-hidden="true" />
        Change category
      </button>

      {isLinked && (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={onUnlink}
          disabled={isPending}
          aria-label={`Unlink account for ${
            transaction.merchant || transaction.description || 'transaction'
          }`}
        >
          <Unlink className="w-4 h-4" aria-hidden="true" />
          Unlink account
        </button>
      )}

      {isLinked && (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={onConvert}
          disabled={isPending}
          aria-label={`Convert ${
            transaction.merchant || transaction.description || 'transaction'
          } to manual`}
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Convert to manual
        </button>
      )}
    </div>
  );
}
