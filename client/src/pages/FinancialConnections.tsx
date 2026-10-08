import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ReceiptText } from 'lucide-react';
import { Loading } from '../components/Loading';
import { CategoryRuleManager } from '../components/financial/CategoryRuleManager';
import { ConnectMockDialog } from '../components/financial/ConnectMockDialog';
import { ConfirmDialog } from '../components/financial/ConfirmDialog';
import { FinancialAccountCard } from '../components/financial/FinancialAccountCard';
import { FinancialConnectionCard } from '../components/financial/FinancialConnectionCard';
import { financialApi } from '../services/financialApi';
import { getApiErrorMessage } from '../services/error';
import type {
  FinancialConnection,
  FinancialSyncSummary,
} from '../types/financial';

interface ConnectionWithSummary {
  connection: FinancialConnection;
  latestSummary: FinancialSyncSummary | null;
}

export function FinancialConnections() {
  const [connections, setConnections] = useState<FinancialConnection[]>([]);
  const [summaries, setSummaries] = useState<Record<string, FinancialSyncSummary>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [syncingConnectionId, setSyncingConnectionId] = useState<string | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);

  const [disconnectTarget, setDisconnectTarget] = useState<FinancialConnection | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const fetchSummaries = useCallback(async (connectionList: FinancialConnection[]) => {
    const accounts = connectionList.flatMap((connection) => connection.accounts);
    if (accounts.length === 0) {
      setSummaries({});
      return;
    }

    const results = await Promise.allSettled(
      accounts.map((account) => financialApi.getFinancialSyncSummary(account.id))
    );

    const next: Record<string, FinancialSyncSummary> = {};
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        next[result.value.accountId] = result.value;
      }
    });
    setSummaries(next);
  }, []);

  const loadAll = useCallback(
    async (initial = false) => {
      if (initial) setIsLoading(true);
      setLoadError(null);

      try {
        const list = await financialApi.listFinancialConnections();
        setConnections(list);
        await fetchSummaries(list);
      } catch (error) {
        setLoadError(getApiErrorMessage(error));
      } finally {
        if (initial) setIsLoading(false);
      }
    },
    [fetchSummaries]
  );

  useEffect(() => {
    void loadAll(true);
  }, [loadAll]);

  const accounts = useMemo(
    () => connections.flatMap((connection) => connection.accounts),
    [connections]
  );

  const connectionsWithSummary: ConnectionWithSummary[] = useMemo(
    () =>
      connections.map((connection) => {
        const accountSummaries = connection.accounts
          .map((account) => summaries[account.id])
          .filter((summary): summary is FinancialSyncSummary => Boolean(summary));

        const latestSummary =
          accountSummaries
            .slice()
            .sort((a, b) => {
              const aTime = a.lastSync?.syncedAt ?? a.lastSyncedAt ?? '';
              const bTime = b.lastSync?.syncedAt ?? b.lastSyncedAt ?? '';
              return bTime.localeCompare(aTime);
            })[0] ?? null;

        return { connection, latestSummary };
      }),
    [connections, summaries]
  );

  const openConnect = () => {
    setConnectError(null);
    setIsConnectOpen(true);
  };

  const handleConnect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    setConnectError(null);

    try {
      await financialApi.createMockFinancialConnection();
      setIsConnectOpen(false);
      setSuccessMessage('Mock financial account connected');
      await loadAll();
    } catch (error) {
      setConnectError(getApiErrorMessage(error));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleReconnect = async (connection: FinancialConnection) => {
    if (reconnectingId || syncingConnectionId) return;
    setReconnectingId(connection.id);
    setActionError(null);
    setSuccessMessage(null);

    try {
      await financialApi.createMockFinancialConnection();
      setSuccessMessage('Connection reconnected');
      await loadAll();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setReconnectingId(null);
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget || isDisconnecting) return;
    setIsDisconnecting(true);
    setDisconnectError(null);

    try {
      await financialApi.disconnectFinancialConnection(disconnectTarget.id);
      setDisconnectTarget(null);
      setSuccessMessage('Connection disconnected');
      await loadAll();
    } catch (error) {
      setDisconnectError(getApiErrorMessage(error));
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSyncConnection = async (connection: FinancialConnection) => {
    if (syncingConnectionId || reconnectingId) return;
    const activeAccounts = connection.accounts.filter((account) => account.isActive);
    if (activeAccounts.length === 0) {
      setActionError('There are no active accounts to sync');
      return;
    }

    setSyncingConnectionId(connection.id);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const results = await Promise.all(
        activeAccounts.map((account) => financialApi.syncFinancialAccount(account.id))
      );
      const fetched = results.reduce((sum, result) => sum + result.transactionsFetched, 0);
      const imported = results.reduce((sum, result) => sum + result.transactionsImported, 0);
      const skipped = results.reduce((sum, result) => sum + result.transactionsSkipped, 0);

      setSuccessMessage(
        `Sync complete: ${fetched} fetched · ${imported} imported · ${skipped} skipped`
      );
      await loadAll();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
      await loadAll();
    } finally {
      setSyncingConnectionId(null);
    }
  };

  const handleAccountSynced = useCallback(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="page-container">
      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1">Financial Connections</h1>
            <p className="text-text-muted mt-1">
              Connect a development account to import transactions automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/transactions/imported" className="btn-secondary">
              <ReceiptText className="w-4 h-4" aria-hidden="true" />
              Imported transactions
            </Link>
            <button type="button" className="btn-primary" onClick={openConnect}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Connect Mock Account
            </button>
          </div>
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

        {isLoading ? (
          <Loading />
        ) : (
          <>
            {loadError && (
              <div className="mb-6">
                <div
                  className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                  role="alert"
                >
                  {loadError}
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm mt-3"
                  onClick={() => void loadAll(true)}
                >
                  Try again
                </button>
              </div>
            )}

            {!loadError && (
              <>
                <section aria-labelledby="connected-accounts-heading" className="mb-10">
                  <h2 id="connected-accounts-heading" className="heading-2 mb-4">
                    Connected Accounts
                  </h2>

                  {connectionsWithSummary.length === 0 ? (
                    <div className="card">
                      <div className="card-body text-center py-12">
                        <p className="heading-4">No financial connections yet.</p>
                        <p className="text-text-muted mt-2 mx-auto max-w-md text-sm">
                          Connect a development account to automatically import transactions
                          into WealthHabit.
                        </p>
                        <button
                          type="button"
                          className="btn-primary mt-6"
                          onClick={openConnect}
                        >
                          <Plus className="w-4 h-4" aria-hidden="true" />
                          Connect Mock Account
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {connectionsWithSummary.map(({ connection, latestSummary }) => (
                        <FinancialConnectionCard
                          key={connection.id}
                          connection={connection}
                          latestSummary={latestSummary}
                          isSyncing={
                            syncingConnectionId === connection.id ||
                            reconnectingId === connection.id
                          }
                          onSync={() => void handleSyncConnection(connection)}
                          onDisconnect={() => {
                            setDisconnectError(null);
                            setDisconnectTarget(connection);
                          }}
                          onReconnect={() => void handleReconnect(connection)}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section
                  id="financial-accounts"
                  aria-labelledby="financial-accounts-heading"
                  className="mb-10 scroll-mt-6"
                >
                  <h2 id="financial-accounts-heading" className="heading-2 mb-4">
                    Financial Accounts
                  </h2>

                  {accounts.length === 0 ? (
                    <p className="text-sm text-text-muted">No accounts available.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                      {accounts.map((account) => (
                        <FinancialAccountCard
                          key={account.id}
                          account={account}
                          summary={summaries[account.id] ?? null}
                          onSynced={handleAccountSynced}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            <CategoryRuleManager />
          </>
        )}
      </main>

      {isConnectOpen && (
        <ConnectMockDialog
          isConnecting={isConnecting}
          error={connectError}
          onCancel={() => setIsConnectOpen(false)}
          onConfirm={() => void handleConnect()}
        />
      )}

      {disconnectTarget && (
        <ConfirmDialog
          title="Disconnect this connection?"
          description="Your imported transactions will be kept, but this connection will no longer sync new transactions."
          confirmLabel="Disconnect"
          danger
          isPending={isDisconnecting}
          error={disconnectError}
          onCancel={() => setDisconnectTarget(null)}
          onConfirm={() => void handleDisconnect()}
        />
      )}
    </div>
  );
}
