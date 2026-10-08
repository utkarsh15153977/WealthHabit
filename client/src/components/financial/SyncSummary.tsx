import { RefreshCw } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import type { FinancialSyncSummary } from '../../types/financial';

interface SyncSummaryProps {
  summary: FinancialSyncSummary | null;
  onRetry: () => void;
  isSyncing: boolean;
}

export function SyncSummary({ summary, onRetry, isSyncing }: SyncSummaryProps) {
  if (summary && summary.lastSyncError) {
    return (
      <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error">
        <p className="font-medium mb-1">Last sync failed</p>
        <p className="mb-3">Sync failed. Please try again.</p>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={onRetry}
          disabled={isSyncing}
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          {isSyncing ? 'Syncing...' : 'Retry'}
        </button>
      </div>
    );
  }

  if (summary && summary.lastSync) {
    return (
      <div className="rounded-lg border border-border bg-background px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
          Last Sync
        </p>
        <dl className="text-sm space-y-1.5">
          <div className="flex justify-between gap-3">
            <dt className="text-text-muted">Fetched</dt>
            <dd className="text-text font-medium">{summary.lastSync.transactionsFetched}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-muted">Imported</dt>
            <dd className="text-text font-medium">{summary.lastSync.transactionsImported}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-muted">Skipped</dt>
            <dd className="text-text font-medium">{summary.lastSync.transactionsSkipped}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-muted">Last synced</dt>
            <dd className="text-text font-medium">
              {formatDateTime(summary.lastSync.syncedAt)}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
      <p className="text-text-muted mb-3">This account has not been synced yet.</p>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={onRetry}
        disabled={isSyncing}
      >
        <RefreshCw className="w-4 h-4" aria-hidden="true" />
        {isSyncing ? 'Syncing...' : 'Sync now'}
      </button>
    </div>
  );
}
