import { Plug, PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { SyncStatus } from './SyncStatus';
import { formatDateTime, formatRelativeTime } from '../../utils/date';
import type { FinancialConnection, FinancialSyncSummary } from '../../types/financial';

interface FinancialConnectionCardProps {
  connection: FinancialConnection;
  latestSummary: FinancialSyncSummary | null;
  isSyncing: boolean;
  onSync: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
}

export function FinancialConnectionCard({
  connection,
  latestSummary,
  isSyncing,
  onSync,
  onDisconnect,
  onReconnect,
}: FinancialConnectionCardProps) {
  const lastSync = latestSummary?.lastSync ?? null;
  const isDisconnected = connection.status === 'DISCONNECTED';
  const isRevoked = connection.status === 'REVOKED';
  const isErrored = connection.status === 'ERROR';
  const isActive = connection.status === 'ACTIVE';

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="heading-4 truncate">{connection.institutionName ?? 'Mock provider'}</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {connection.provider} · <span className="badge badge-info">Development / Mock</span>
            </p>
          </div>
          <SyncStatus status={connection.status} />
        </div>

        {isActive && (
          <p className="text-sm text-text-muted mb-3">
            {connection.lastSyncedAt
              ? `Last synced ${formatRelativeTime(connection.lastSyncedAt)}`
              : 'Not synced yet'}
          </p>
        )}

        {isErrored && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-3"
            role="alert"
          >
            <p className="font-medium mb-1">Sync needs attention</p>
            <p>Unable to sync this account.</p>
          </div>
        )}

        {isDisconnected && (
          <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm mb-3">
            <p className="text-text font-medium mb-1">Disconnected</p>
            <p className="text-text-muted">Historical transactions are preserved.</p>
          </div>
        )}

        {isRevoked && (
          <div className="rounded-lg border border-warning bg-yellow-50 px-4 py-3 text-sm mb-3">
            <p className="text-text font-medium mb-1">Access revoked</p>
            <p className="text-text-muted">
              The provider revoked access to this connection. Historical transactions are preserved.
            </p>
          </div>
        )}

        {lastSync && !isDisconnected && !isRevoked && (
          <p className="text-sm text-text-muted mb-3" data-testid="connection-last-sync">
            Last sync: {lastSync.transactionsFetched} fetched ·{' '}
            {lastSync.transactionsImported} imported · {lastSync.transactionsSkipped} skipped
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
          {(isActive || isErrored) && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={onSync}
              disabled={isSyncing}
              aria-label={`Sync ${connection.institutionName ?? 'connection'} accounts`}
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              {isSyncing
                ? 'Syncing...'
                : isErrored
                  ? 'Retry'
                  : 'Sync'}
            </button>
          )}

          <a
            href="#financial-accounts"
            className="btn-ghost btn-sm"
            aria-label={`View accounts for ${connection.institutionName ?? 'connection'}`}
          >
            View accounts
          </a>

          {isDisconnected && (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={onReconnect}
              disabled={isSyncing}
              aria-label={`Reconnect ${connection.institutionName ?? 'connection'}`}
            >
              {isSyncing ? (
                <PlugZap className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Plug className="w-4 h-4" aria-hidden="true" />
              )}
              {isSyncing ? 'Reconnecting...' : 'Reconnect'}
            </button>
          )}

          {!isDisconnected && (
            <button
              type="button"
              className="btn-ghost btn-sm text-error hover:bg-red-50"
              onClick={onDisconnect}
              aria-label={`Disconnect ${connection.institutionName ?? 'connection'}`}
            >
              <Unplug className="w-4 h-4" aria-hidden="true" />
              Disconnect
            </button>
          )}
        </div>

        {!isActive && !isDisconnected && !isRevoked && !isErrored && (
          <p className="text-xs text-text-muted mt-2">
            {connection.revokedAt
              ? `Revoked ${formatDateTime(connection.revokedAt)}`
              : 'No accounts are available for syncing.'}
          </p>
        )}
      </div>
    </div>
  );
}
