import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FinancialConnections } from './FinancialConnections';
import { financialApi } from '../services/financialApi';
import { getCategories } from '../services/categoryApi';
import type { Category } from '../types/category';
import type {
  CategoryRule,
  FinancialAccount,
  FinancialConnection,
  FinancialSyncSummary,
  SyncResult,
} from '../types/financial';

vi.mock('../services/financialApi', () => ({
  financialApi: {
    listFinancialConnections: vi.fn(),
    createMockFinancialConnection: vi.fn(),
    getFinancialConnection: vi.fn(),
    disconnectFinancialConnection: vi.fn(),
    listFinancialAccounts: vi.fn(),
    getFinancialAccount: vi.fn(),
    syncFinancialAccount: vi.fn(),
    getFinancialSyncSummary: vi.fn(),
    listImportedTransactions: vi.fn(),
    recategorizeImportedTransaction: vi.fn(),
    unlinkImportedTransaction: vi.fn(),
    convertImportedTransactionToManual: vi.fn(),
    previewCategorization: vi.fn(),
    bulkRecategorize: vi.fn(),
    listCategoryRules: vi.fn(),
    createCategoryRule: vi.fn(),
    updateCategoryRule: vi.fn(),
    deleteCategoryRule: vi.fn(),
  },
}));

vi.mock('../services/categoryApi', () => ({
  getCategories: vi.fn(),
}));

const mockedFinancialApi = vi.mocked(financialApi);
const mockedGetCategories = vi.mocked(getCategories);

function makeAccount(overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: 'acc-1',
    externalAccountId: 'ext-acc-1',
    name: 'HDFC Savings',
    mask: '1234',
    type: 'SAVINGS',
    currency: 'INR',
    institutionName: 'HDFC',
    isActive: true,
    lastSyncedAt: null,
    lastSyncError: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<FinancialConnection> = {}): FinancialConnection {
  return {
    id: 'conn-1',
    provider: 'MOCK',
    status: 'ACTIVE',
    institutionName: 'HDFC',
    consentGivenAt: '2026-10-01T00:00:00.000Z',
    revokedAt: null,
    lastSyncedAt: null,
    lastSyncError: null,
    accounts: [makeAccount()],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<FinancialSyncSummary> = {}): FinancialSyncSummary {
  return {
    accountId: 'acc-1',
    accountName: 'HDFC Savings',
    status: 'ACTIVE',
    isActive: true,
    lastSyncedAt: '2026-10-08T12:00:00.000Z',
    lastSyncError: null,
    lastSync: {
      transactionsFetched: 19,
      transactionsImported: 19,
      transactionsSkipped: 0,
      syncedAt: '2026-10-08T12:00:00.000Z',
    },
    ...overrides,
  };
}

function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    accountId: 'acc-1',
    transactionsFetched: 19,
    transactionsImported: 19,
    transactionsSkipped: 0,
    lastSyncedAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  };
}

function makeRule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 'rule-1',
    merchant: 'Amazon',
    categoryId: 'cat-shopping',
    category: {
      id: 'cat-shopping',
      name: 'Shopping',
      type: 'EXPENSE',
      icon: null,
      color: null,
      isDefault: false,
    },
    priority: 0,
    isActive: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-shopping',
    name: 'Shopping',
    type: 'EXPENSE',
    icon: null,
    color: null,
    isDefault: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <FinancialConnections />
    </MemoryRouter>
  );
}

describe('FinancialConnections page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCategories.mockResolvedValue({ categories: [] });
    mockedFinancialApi.listCategoryRules.mockResolvedValue([]);
    mockedFinancialApi.listFinancialConnections.mockResolvedValue([makeConnection()]);
    mockedFinancialApi.getFinancialSyncSummary.mockResolvedValue(makeSummary());
  });

  it('shows loading, then renders connections, accounts, and sync details', async () => {
    let resolveList!: (value: FinancialConnection[]) => void;
    mockedFinancialApi.listFinancialConnections.mockReturnValue(
      new Promise<FinancialConnection[]>((resolve) => {
        resolveList = resolve;
      })
    );

    renderPage();
    expect(screen.getByLabelText('Loading')).toBeDefined();

    resolveList([makeConnection()]);

    expect(await screen.findByText('HDFC Savings')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Connected Accounts' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Financial Accounts' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'HDFC' })).toBeDefined();
    expect(screen.getByText('Development / Mock')).toBeDefined();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('............ 1234')).toBeDefined();
    expect(screen.getByText('INR')).toBeDefined();
    expect(screen.getByText('Savings · HDFC')).toBeDefined();
    expect(screen.getByTestId('connection-last-sync')).toHaveTextContent(
      'Last sync: 19 fetched · 19 imported · 0 skipped'
    );
    expect(screen.getByText('Fetched')).toBeDefined();
    expect(screen.getAllByText('19').length).toBeGreaterThan(0);

    expect(mockedFinancialApi.listFinancialConnections).toHaveBeenCalledTimes(1);
    expect(mockedFinancialApi.getFinancialSyncSummary).toHaveBeenCalledWith('acc-1');
  });

  it('shows the empty state copy when there are no connections', async () => {
    mockedFinancialApi.listFinancialConnections.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('No financial connections yet.')).toBeDefined();
    expect(
      screen.getByText(
        'Connect a development account to automatically import transactions into WealthHabit.'
      )
    ).toBeDefined();
    expect(screen.getByText('No accounts available.')).toBeDefined();
    expect(await screen.findByText('No merchant rules yet.')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Connect Mock Account' }).length).toBeGreaterThan(
      0
    );
    expect(mockedFinancialApi.getFinancialSyncSummary).not.toHaveBeenCalled();
  });

  it('connects a mock account through the dialog', async () => {
    mockedFinancialApi.listFinancialConnections.mockResolvedValueOnce([]);
    mockedFinancialApi.createMockFinancialConnection.mockResolvedValue(makeConnection());

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect Mock Account' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();
    expect(screen.getByText('Connect Mock Financial Account')).toBeDefined();
    expect(
      screen.getByText('This development connection uses simulated financial data.')
    ).toBeDefined();
    expect(
      screen.getByText('No bank credentials, UPI PIN, OTP, CVV, or password are required.')
    ).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(mockedFinancialApi.createMockFinancialConnection).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Mock financial account connected')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockedFinancialApi.listFinancialConnections).toHaveBeenCalledTimes(2);
  });

  it('keeps the connect dialog open and shows the provider error', async () => {
    mockedFinancialApi.listFinancialConnections.mockResolvedValue([]);
    mockedFinancialApi.createMockFinancialConnection.mockRejectedValue(
      new Error('Provider unavailable')
    );

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Connect Mock Account' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable');
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(mockedFinancialApi.listFinancialConnections).toHaveBeenCalledTimes(1);
  });

  it('syncs a connection and reports the imported counts', async () => {
    mockedFinancialApi.syncFinancialAccount.mockResolvedValue(makeSyncResult());

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sync HDFC accounts' })
    );

    await waitFor(() => {
      expect(mockedFinancialApi.syncFinancialAccount).toHaveBeenCalledWith('acc-1');
    });
    expect(
      await screen.findByText('Sync complete: 19 fetched · 19 imported · 0 skipped')
    ).toBeDefined();
    expect(mockedFinancialApi.listFinancialConnections).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed connection sync in the page alert', async () => {
    mockedFinancialApi.syncFinancialAccount.mockRejectedValue(
      new Error('Sync failed. Please try again')
    );

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sync HDFC accounts' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sync failed. Please try again'
    );
  });

  it('does not offer sync when the account list is empty', async () => {
    mockedFinancialApi.listFinancialConnections.mockResolvedValue([
      makeConnection({ accounts: [] }),
    ]);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Sync HDFC accounts' }));
    expect(screen.getByRole('alert')).toHaveTextContent('There are no active accounts to sync');
    expect(mockedFinancialApi.syncFinancialAccount).not.toHaveBeenCalled();
  });

  it('renders the error connection state with a retry action', async () => {
    mockedFinancialApi.listFinancialConnections.mockResolvedValue([
      makeConnection({
        status: 'ERROR',
        lastSyncError: 'boom',
        lastSyncedAt: null,
      }),
    ]);
    mockedFinancialApi.getFinancialSyncSummary.mockResolvedValue(
      makeSummary({ lastSync: null, lastSyncedAt: null })
    );

    renderPage();

    expect(await screen.findByText('Sync needs attention')).toBeDefined();
    expect(screen.getByText('Unable to sync this account.')).toBeDefined();
    expect(screen.getByText('Retry')).toBeDefined();
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('reconnects a disconnected connection', async () => {
    mockedFinancialApi.listFinancialConnections.mockResolvedValue([
      makeConnection({ status: 'DISCONNECTED', lastSyncedAt: null }),
    ]);
    mockedFinancialApi.getFinancialSyncSummary.mockResolvedValue(
      makeSummary({ lastSync: null, lastSyncedAt: null })
    );
    mockedFinancialApi.createMockFinancialConnection.mockResolvedValue(makeConnection());

    renderPage();

    expect(await screen.findByText('Historical transactions are preserved.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect HDFC' }));

    await waitFor(() => {
      expect(mockedFinancialApi.createMockFinancialConnection).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Connection reconnected')).toBeDefined();
  });

  it('disconnects a connection only after confirmation', async () => {
    mockedFinancialApi.disconnectFinancialConnection.mockResolvedValue();

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Disconnect HDFC' })
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Disconnect this connection?');
    expect(mockedFinancialApi.disconnectFinancialConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(mockedFinancialApi.disconnectFinancialConnection).toHaveBeenCalledWith('conn-1');
    });
    expect(await screen.findByText('Connection disconnected')).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('retries loading after the connections request fails', async () => {
    mockedFinancialApi.listFinancialConnections
      .mockRejectedValueOnce(new Error('Unable to fetch connections'))
      .mockResolvedValueOnce([makeConnection()]);

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to fetch connections'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('HDFC Savings')).toBeDefined();
    expect(mockedFinancialApi.listFinancialConnections).toHaveBeenCalledTimes(2);
  });

  it('links View accounts to the financial accounts section', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: 'View accounts for HDFC' });
    expect(link).toHaveAttribute('href', '#financial-accounts');
  });

  it('syncs a single account from its card and shows the sync result', async () => {
    mockedFinancialApi.syncFinancialAccount.mockResolvedValue(makeSyncResult());

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sync HDFC Savings' })
    );

    await waitFor(() => {
      expect(mockedFinancialApi.syncFinancialAccount).toHaveBeenCalledWith('acc-1');
    });
    expect(await screen.findByText('19 transactions checked')).toBeDefined();
    expect(screen.getByText('19 imported')).toBeDefined();
    expect(screen.getByText('0 skipped')).toBeDefined();
    expect(mockedFinancialApi.listFinancialConnections).toHaveBeenCalledTimes(2);
  });

  it('shows the not-synced-yet state when the account has never synced', async () => {
    mockedFinancialApi.getFinancialSyncSummary.mockResolvedValue(
      makeSummary({ lastSync: null, lastSyncedAt: null })
    );

    renderPage();

    expect(
      await screen.findByText('This account has not been synced yet.')
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDefined();
  });

  it('lists merchant rules with status and edit/delete actions', async () => {
    mockedFinancialApi.listCategoryRules.mockResolvedValue([makeRule()]);

    renderPage();

    expect(await screen.findByText('Transaction Category Rules')).toBeDefined();
    expect(screen.getByText('Amazon')).toBeDefined();
    expect(screen.getByText('Shopping')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add merchant rule' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit rule for Amazon' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete rule for Amazon' })).toBeDefined();
  });

  it('deletes a merchant rule after confirmation', async () => {
    mockedFinancialApi.listCategoryRules
      .mockResolvedValueOnce([makeRule()])
      .mockResolvedValueOnce([]);
    mockedFinancialApi.deleteCategoryRule.mockResolvedValue({
      ruleId: 'rule-1',
      deleted: true,
    });

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete rule for Amazon' })
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete this merchant rule?');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockedFinancialApi.deleteCategoryRule).toHaveBeenCalledWith('rule-1');
    });
    expect(await screen.findByText('Rule deleted')).toBeDefined();
    expect(await screen.findByText('No merchant rules yet.')).toBeDefined();
  });

  it('shows the syncing state while a connection sync is in flight', async () => {
    let resolveSync!: (value: SyncResult) => void;
    mockedFinancialApi.syncFinancialAccount.mockReturnValue(
      new Promise<SyncResult>((resolve) => {
        resolveSync = resolve;
      })
    );

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sync HDFC accounts' })
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sync HDFC accounts' })).toBeDisabled();
      expect(screen.getByText('Syncing...')).toBeDefined();
    });
    expect(mockedFinancialApi.syncFinancialAccount).toHaveBeenCalledTimes(1);

    resolveSync(makeSyncResult());

    expect(
      await screen.findByText('Sync complete: 19 fetched · 19 imported · 0 skipped')
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Sync HDFC accounts' })
    ).not.toBeDisabled();
  });

  it('surfaces an account sync failure on the card', async () => {
    mockedFinancialApi.syncFinancialAccount.mockRejectedValue(
      new Error('Sync failed. Please try again')
    );

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sync HDFC Savings' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sync failed. Please try again'
    );
    expect(mockedFinancialApi.listFinancialConnections).toHaveBeenCalledTimes(1);
  });

  it('creates a merchant rule from the add form', async () => {
    mockedGetCategories.mockResolvedValue({ categories: [makeCategory()] });
    mockedFinancialApi.listCategoryRules
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeRule()]);
    mockedFinancialApi.createCategoryRule.mockResolvedValue(makeRule());

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add merchant rule' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Add Merchant Rule');

    fireEvent.change(within(dialog).getByLabelText('Merchant'), {
      target: { value: 'Amazon' },
    });
    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: 'cat-shopping' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedFinancialApi.createCategoryRule).toHaveBeenCalledWith({
        merchant: 'Amazon',
        categoryId: 'cat-shopping',
        isActive: true,
      });
    });
    expect(await screen.findByText('Rule saved')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Amazon')).toBeDefined();
  });

  it('edits an existing merchant rule', async () => {
    mockedGetCategories.mockResolvedValue({ categories: [makeCategory()] });
    mockedFinancialApi.listCategoryRules.mockResolvedValue([makeRule()]);
    mockedFinancialApi.updateCategoryRule.mockResolvedValue(
      makeRule({ merchant: 'Amazon Prime' })
    );

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit rule for Amazon' })
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Edit Merchant Rule');
    expect(within(dialog).getByLabelText('Merchant')).toHaveValue('Amazon');

    fireEvent.change(within(dialog).getByLabelText('Merchant'), {
      target: { value: 'Amazon Prime' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedFinancialApi.updateCategoryRule).toHaveBeenCalledWith('rule-1', {
        merchant: 'Amazon Prime',
        categoryId: 'cat-shopping',
        isActive: true,
      });
    });
    expect(await screen.findByText('Rule saved')).toBeDefined();
  });

  it('shows a friendly error when a duplicate rule is rejected', async () => {
    mockedGetCategories.mockResolvedValue({ categories: [makeCategory()] });
    mockedFinancialApi.createCategoryRule.mockRejectedValue(
      new Error('A rule for this merchant already exists')
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add merchant rule' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Merchant'), {
      target: { value: 'Amazon' },
    });
    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: 'cat-shopping' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A rule for this merchant already exists'
    );
    expect(within(dialog).getByRole('button', { name: 'Save' })).not.toBeDisabled();
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(mockedFinancialApi.listCategoryRules).toHaveBeenCalledTimes(1);
  });

  it('never asks for bank credentials on the page', async () => {
    renderPage();
    await screen.findByText('HDFC Savings');

    expect(screen.queryByText(/UPI PIN/i)).toBeNull();
    expect(screen.queryByText(/password/i)).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
});
