import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SyncSummary } from './SyncSummary';
import { financialApi } from '../../services/financialApi';
import { getApiErrorMessage } from '../../services/error';
import type { FinancialAccount, FinancialSyncSummary, SyncResult } from '../../types/financial';

const ACCOUNT_TYPE_LABELS: Record<FinancialAccount['type'], string> = {
  SAVINGS: 'Savings',
  CURRENT: 'Current',
  DEBIT_CARD: 'Debit Card',
  CREDIT_CARD: 'Credit Card',
  UPI_LINKED: 'UPI Linked',
};

interface FinancialAccountCardProps {
  account: FinancialAccount;
  summary: FinancialSyncSummary | null;
  onSynced: () => void;
}

export function FinancialAccountCard({ account, summary, onSynced }: FinancialAccountCardProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);

    try {
      const result = await financialApi.syncFinancialAccount(account.id);
      setSyncResult(result);
      await onSynced();
    } catch (error) {
      setSyncResult(null);
      setSyncError(getApiErrorMessage(error));
    } finally {
      setIsSyncing(false);
    }
  };

  const skippedLabel =
    syncResult && syncResult.transactionsSkipped > 0
      ? `${syncResult.transactionsSkipped} already imported`
      : `${syncResult?.transactionsSkipped ?? 0} skipped`;

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="heading-4 truncate">{account.name}</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {account.mask ? `............ ${account.mask}` : ACCOUNT_TYPE_LABELS[account.type]}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{account.currency}</p>
          </div>
          <span className={account.isActive ? 'badge badge-success' : 'badge badge-info'}>
            {account.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        <p className="text-xs text-text-muted mb-3">
          {ACCOUNT_TYPE_LABELS[account.type]}
          {account.institutionName ? ` · ${account.institutionName}` : ''}
        </p>

        <div className="mb-3">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => void handleSync()}
            disabled={isSyncing || !account.isActive}
            aria-label={`Sync ${account.name}`}
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>

        {syncError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-3"
            role="alert"
          >
            {syncError}
          </div>
        )}

        {syncResult && !syncError && (
          <div
            className="rounded-lg border border-border bg-background px-4 py-3 text-sm mb-3"
            aria-live="polite"
          >
            <p className="text-text font-medium">
              {syncResult.transactionsFetched} transactions checked
            </p>
            <p className="text-text">{syncResult.transactionsImported} imported</p>
            <p className="text-text-muted">{skippedLabel}</p>
          </div>
        )}

        <SyncSummary
          summary={summary}
          onRetry={() => void handleSync()}
          isSyncing={isSyncing}
        />
      </div>
    </div>
  );
}
