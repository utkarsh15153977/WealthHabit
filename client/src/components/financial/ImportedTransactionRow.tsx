import { TransactionReviewActions } from './TransactionReviewActions';
import { formatDate } from '../../utils/date';
import { paymentChannelLabel } from '../../utils/paymentChannel';
import type { ImportedTransaction } from '../../types/financial';

interface ImportedTransactionRowProps {
  transaction: ImportedTransaction;
  isSelected: boolean;
  isPending: boolean;
  formatAmount: (amount: number) => string;
  onToggleSelect: () => void;
  onChangeCategory: () => void;
  onUnlink: () => void;
  onConvert: () => void;
}

export function ImportedTransactionRow({
  transaction,
  isSelected,
  isPending,
  formatAmount,
  onToggleSelect,
  onChangeCategory,
  onUnlink,
  onConvert,
}: ImportedTransactionRowProps) {
  const title = transaction.merchant || transaction.description || 'Imported transaction';
  const subtitle =
    transaction.merchant && transaction.description ? transaction.description : null;
  const paymentLine = [transaction.paymentMethod, paymentChannelLabel(transaction.paymentChannel)]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="card" data-testid={`imported-row-${transaction.id}`}>
      <div className="card-body py-4 flex gap-4 items-start">
        <input
          type="checkbox"
          className="mt-1 w-4 h-4 flex-shrink-0"
          checked={isSelected}
          onChange={onToggleSelect}
          aria-label={`Select ${title}`}
          disabled={isPending}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text truncate">{title}</p>
              {subtitle && <p className="text-xs text-text-muted truncate">{subtitle}</p>}
            </div>
            <span
              className={`text-sm font-semibold ${
                transaction.type === 'INCOME' ? 'text-success' : 'text-text'
              }`}
            >
              {formatAmount(transaction.amount)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="badge badge-primary">{transaction.category.name}</span>
            <span className="badge badge-warning">Imported</span>
            {transaction.financialAccount ? (
              <span className="text-xs text-text-muted truncate">
                {transaction.financialAccount.name} ............ {transaction.financialAccount.mask}
              </span>
            ) : (
              <span className="badge badge-info">Unlinked</span>
            )}
            {paymentLine && (
              <span className="text-xs text-text-muted">{paymentLine}</span>
            )}
            <span className="text-xs text-text-muted">
              {formatDate(transaction.transactionDate)}
            </span>
          </div>

          <div className="mt-3">
            <TransactionReviewActions
              transaction={transaction}
              isPending={isPending}
              onChangeCategory={onChangeCategory}
              onUnlink={onUnlink}
              onConvert={onConvert}
            />
          </div>
        </div>
      </div>
    </li>
  );
}
