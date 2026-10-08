import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ImportedTransactions } from './ImportedTransactions';
import { BulkRecategorizeDialog } from '../components/financial/BulkRecategorizeDialog';
import { CategorizationSuggestion } from '../components/financial/CategorizationSuggestion';
import { financialApi } from '../services/financialApi';
import { getCategories } from '../services/categoryApi';
import { getMyProfile } from '../services/userApi';
import type { Category } from '../types/category';
import type {
  CategorizationPreview,
  FinancialAccount,
  ImportedTransaction,
  ImportedTransactionList,
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

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

const mockedFinancialApi = vi.mocked(financialApi);
const mockedGetCategories = vi.mocked(getCategories);
const mockedGetMyProfile = vi.mocked(getMyProfile);

const FOOD: Category = {
  id: 'cat-food',
  name: 'Food',
  type: 'EXPENSE',
  icon: null,
  color: null,
  isDefault: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const GROCERIES: Category = {
  id: 'cat-groceries',
  name: 'Groceries',
  type: 'EXPENSE',
  icon: null,
  color: null,
  isDefault: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const SALARY: Category = {
  id: 'cat-salary',
  name: 'Salary',
  type: 'INCOME',
  icon: null,
  color: null,
  isDefault: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

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

function makeImported(overrides: Partial<ImportedTransaction> = {}): ImportedTransaction {
  return {
    id: 'tx-1',
    amount: 42,
    type: 'EXPENSE',
    description: 'Coffee purchase',
    merchant: 'Blue Tokai',
    transactionDate: '2026-10-08T09:30:00.000Z',
    paymentMethod: 'UPI',
    paymentChannel: 'GOOGLEPAY',
    category: {
      id: 'cat-food',
      name: 'Food',
      type: 'EXPENSE',
      icon: null,
      color: null,
      isDefault: false,
    },
    financialAccountId: 'acc-1',
    financialAccount: {
      id: 'acc-1',
      name: 'HDFC Savings',
      mask: '1234',
      type: 'SAVINGS',
      currency: 'INR',
      institutionName: 'HDFC',
    },
    source: 'IMPORTED',
    externalTransactionId: 'ext-tx-1',
    importedAt: '2026-10-08T10:00:00.000Z',
    ...overrides,
  };
}

function listResponse(
  transactions: ImportedTransaction[],
  overrides: Partial<ImportedTransactionList['pagination']> = {}
): ImportedTransactionList {
  return {
    transactions,
    pagination: {
      page: 1,
      limit: 20,
      total: transactions.length,
      totalPages: 1,
      ...overrides,
    },
  };
}

function expectedAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    amount
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportedTransactions />
    </MemoryRouter>
  );
}

describe('ImportedTransactions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCategories.mockResolvedValue({ categories: [FOOD, GROCERIES, SALARY] });
    mockedGetMyProfile.mockResolvedValue({
      profile: {
        id: 'u1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'USER',
        status: 'ACTIVE',
        financialProfile: {
          currency: 'USD',
          monthlyIncomeTarget: null,
          monthlySavingsTarget: null,
        },
      },
    });
    mockedFinancialApi.listFinancialAccounts.mockResolvedValue([makeAccount()]);
    mockedFinancialApi.listImportedTransactions.mockResolvedValue(
      listResponse([makeImported()])
    );
    mockedFinancialApi.previewCategorization.mockResolvedValue({
      category: {
        id: 'cat-groceries',
        name: 'Groceries',
        type: 'EXPENSE',
        icon: null,
        color: null,
        isDefault: false,
      },
      confidence: 0.97,
      reason: 'USER_RULE',
      matchedRule: 'blue tokai',
    } satisfies CategorizationPreview);
  });

  it('shows loading, then renders the imported transaction once', async () => {
    let resolveList!: (value: ImportedTransactionList) => void;
    mockedFinancialApi.listImportedTransactions.mockReturnValue(
      new Promise<ImportedTransactionList>((resolve) => {
        resolveList = resolve;
      })
    );

    renderPage();
    expect(screen.getByLabelText('Loading')).toBeDefined();

    resolveList(listResponse([makeImported()]));

    expect(await screen.findByText('Blue Tokai')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Imported Transactions' })).toBeDefined();
    expect(screen.getAllByText('Food').length).toBeGreaterThan(0);
    expect(screen.getByText('Imported')).toBeDefined();
    expect(screen.getByText('HDFC Savings ............ 1234')).toBeDefined();
    expect(screen.getByText('UPI · Google Pay')).toBeDefined();
    expect(screen.getByText(expectedAmount(42))).toBeDefined();
    expect(screen.getByText('1 transaction')).toBeDefined();

    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(1);
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 })
    );
    expect(mockedGetMyProfile).toHaveBeenCalledTimes(1);
    expect(mockedFinancialApi.listFinancialAccounts).toHaveBeenCalledTimes(1);
  });

  it('requests the selected type filter and clears back to the default query', async () => {
    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();
    await waitFor(() =>
      expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(1)
    );

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'EXPENSE' } });

    await waitFor(() => {
      expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'EXPENSE', page: 1 })
      );
    });
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(mockedFinancialApi.listImportedTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 })
      );
    });
    const lastCall =
      mockedFinancialApi.listImportedTransactions.mock.calls.at(-1)?.[0] ?? {};
    expect(lastCall.type).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('paginates forward when there are more pages', async () => {
    mockedFinancialApi.listImportedTransactions.mockResolvedValueOnce(
      listResponse([makeImported()], { page: 1, total: 40, totalPages: 2 })
    );
    mockedFinancialApi.listImportedTransactions.mockResolvedValueOnce(
      listResponse([makeImported({ id: 'tx-2', merchant: 'Second' })], {
        page: 2,
        total: 40,
        totalPages: 2,
      })
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();
    expect(screen.getByText('Page 1 of 2')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Second')).toBeDefined();
    expect(screen.getByText('Page 2 of 2')).toBeDefined();
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 })
    );
  });

  it('recategorizes a selection through the bulk dialog', async () => {
    mockedFinancialApi.bulkRecategorize.mockResolvedValue({
      transactionCount: 1,
      categoryId: 'cat-groceries',
    });

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(screen.getByLabelText('Select Blue Tokai'));
    expect(screen.getByText('1 selected')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Recategorize' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Recategorize 1 transaction');

    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: 'cat-groceries' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockedFinancialApi.bulkRecategorize).toHaveBeenCalledWith({
        transactionIds: ['tx-1'],
        categoryId: 'cat-groceries',
        rememberForMerchant: false,
      });
    });
    expect(await screen.findByText('1 transaction recategorized')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(2);
  });

  it('blocks bulk recategorization when the selection mixes income and expense', async () => {
    mockedFinancialApi.listImportedTransactions.mockResolvedValue(
      listResponse([
        makeImported(),
        makeImported({
          id: 'tx-2',
          type: 'INCOME',
          merchant: 'Employer',
          category: { ...SALARY, isDefault: false },
        }),
      ])
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(screen.getByLabelText('Select Blue Tokai'));
    fireEvent.click(screen.getByLabelText('Select Employer'));
    fireEvent.click(screen.getByRole('button', { name: 'Recategorize' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'The selection mixes income and expense transactions. Recategorize them in separate batches.'
      )
    ).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockedFinancialApi.bulkRecategorize).not.toHaveBeenCalled();
  });

  it('unlinks an imported transaction only after confirmation', async () => {
    mockedFinancialApi.unlinkImportedTransaction.mockResolvedValue(
      makeImported({ financialAccountId: null, financialAccount: null })
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(
      screen.getByRole('button', { name: 'Unlink account for Blue Tokai' })
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Unlink this imported transaction?');
    expect(dialog).toHaveTextContent(
      'The transaction will remain in your transaction history, but it will no longer be associated with this financial account.'
    );
    expect(mockedFinancialApi.unlinkImportedTransaction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));

    await waitFor(() => {
      expect(mockedFinancialApi.unlinkImportedTransaction).toHaveBeenCalledWith('tx-1');
    });
    expect(await screen.findByText('Transaction unlinked')).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(2);
  });

  it('converts an imported transaction to manual only after confirmation', async () => {
    mockedFinancialApi.convertImportedTransactionToManual.mockResolvedValue(
      makeImported()
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(
      screen.getByRole('button', { name: 'Convert Blue Tokai to manual' })
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Convert this imported transaction to manual?');
    expect(dialog).toHaveTextContent('It will no longer appear in Imported Transactions.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert' }));

    await waitFor(() => {
      expect(mockedFinancialApi.convertImportedTransactionToManual).toHaveBeenCalledWith(
        'tx-1'
      );
    });
    expect(await screen.findByText('Transaction converted to manual')).toBeDefined();
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(2);
  });

  it('changes a category and remembers the merchant preference when checked', async () => {
    mockedFinancialApi.recategorizeImportedTransaction.mockResolvedValue(
      makeImported({
        category: { id: 'cat-groceries', name: 'Groceries', type: 'EXPENSE', icon: null, color: null, isDefault: false },
      })
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Change category for Blue Tokai' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Suggested category')).toBeDefined();
    expect(within(dialog).getByText('High confidence')).toBeDefined();
    expect(within(dialog).getByText('Based on your merchant rule')).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: 'cat-groceries' },
    });
    fireEvent.click(within(dialog).getByLabelText('Remember this category for this merchant'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedFinancialApi.recategorizeImportedTransaction).toHaveBeenCalledWith(
        'tx-1',
        'cat-groceries',
        true
      );
    });
    expect(await screen.findByText('Category updated')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(2);
  });

  it('disables the remember checkbox when the transaction has no merchant', async () => {
    mockedFinancialApi.listImportedTransactions.mockResolvedValue(
      listResponse([makeImported({ merchant: null, description: 'ATM withdrawal' })])
    );

    renderPage();
    expect(await screen.findByText('ATM withdrawal')).toBeDefined();

    fireEvent.click(
      screen.getByRole('button', { name: 'Change category for ATM withdrawal' })
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByLabelText('Remember this category for this merchant')
    ).toBeDisabled();
    expect(
      within(dialog).getByText(
        'This transaction has no merchant, so the preference cannot be remembered.'
      )
    ).toBeDefined();
  });

  it('falls back to no suggestion when the preview cannot be found', async () => {
    mockedFinancialApi.previewCategorization.mockRejectedValue(
      Object.assign(new Error('Resource not found'), {
        isAxiosError: true,
        response: { status: 404, data: {} },
      })
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Change category for Blue Tokai' }));

    expect(await screen.findByText('No suggestion available')).toBeDefined();
  });

  it('closes dialogs with the Escape key', async () => {
    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Change category for Blue Tokai' }));
    expect(await screen.findByRole('dialog')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('Select Blue Tokai'));
    fireEvent.click(screen.getByRole('button', { name: 'Recategorize' }));
    expect(await screen.findByRole('dialog')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the empty state when no transactions are imported yet', async () => {
    mockedFinancialApi.listImportedTransactions.mockResolvedValue(listResponse([]));

    renderPage();

    expect(await screen.findByText('No imported transactions.')).toBeDefined();
    expect(
      screen.getByText('Sync a connected account to bring in transactions.')
    ).toBeDefined();
    expect(
      screen.getAllByRole('link', { name: 'Financial Connections' })[0]
    ).toHaveAttribute('href', '/financial-connections');
  });

  it('shows the filtered empty state with a way back to unfiltered results', async () => {
    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    mockedFinancialApi.listImportedTransactions.mockResolvedValueOnce(listResponse([]));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'EXPENSE' } });

    expect(await screen.findByText('No transactions match your filters.')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

    expect(await screen.findByText('Blue Tokai')).toBeDefined();
  });

  it('retries the initial request after a failure', async () => {
    mockedFinancialApi.listImportedTransactions
      .mockRejectedValueOnce(new Error('Import service unavailable'))
      .mockResolvedValueOnce(listResponse([makeImported()]));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Import service unavailable'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Blue Tokai')).toBeDefined();
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(2);
  });

  it('validates that a category is chosen before saving', async () => {
    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Change category for Blue Tokai' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Please choose a category'
    );
    expect(mockedFinancialApi.recategorizeImportedTransaction).not.toHaveBeenCalled();
  });

  it('keeps the bulk dialog open and shows the failure when the server rejects', async () => {
    mockedFinancialApi.bulkRecategorize.mockRejectedValue(
      new Error('Only imported transactions can be changed here')
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(screen.getByLabelText('Select Blue Tokai'));
    fireEvent.click(screen.getByRole('button', { name: 'Recategorize' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: 'cat-food' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only imported transactions can be changed here'
    );
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getAllByText('1 selected').length).toBeGreaterThan(0);
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(1);
  });

  it('keeps the unlink dialog open when the mutation fails', async () => {
    mockedFinancialApi.unlinkImportedTransaction.mockRejectedValue(
      new Error('Transaction not found')
    );

    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    fireEvent.click(
      screen.getByRole('button', { name: 'Unlink account for Blue Tokai' })
    );

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Transaction not found'
    );
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(mockedFinancialApi.listImportedTransactions).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Transaction unlinked')).toBeNull();
  });

  it('never renders credential inputs or raw backend payload fields', async () => {
    renderPage();
    expect(await screen.findByText('Blue Tokai')).toBeDefined();

    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByLabelText(/UPI PIN/i)).toBeNull();
    expect(screen.queryByLabelText(/CVV/i)).toBeNull();
    expect(screen.queryByLabelText(/OTP/i)).toBeNull();
    expect(screen.queryByLabelText(/PAN/i)).toBeNull();
    expect(screen.queryByText(/normalizedMerchant/i)).toBeNull();
    expect(screen.queryByText(/externalTransactionId/i)).toBeNull();
    expect(screen.queryByLabelText(/account number/i)).toBeNull();
  });

  it('links back to the financial connections page', async () => {
    renderPage();
    await screen.findByText('Blue Tokai');

    expect(screen.getByRole('link', { name: /Financial Connections/ })).toHaveAttribute(
      'href',
      '/financial-connections'
    );
  });
});

describe('BulkRecategorizeDialog guards', () => {
  it('blocks submissions above the 100 transaction limit', () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      makeImported({ id: `tx-${index}`, merchant: `Merchant ${index}` })
    );

    render(
      <MemoryRouter>
        <BulkRecategorizeDialog
          transactions={many}
          categories={[FOOD]}
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByText('A maximum of 100 transactions can be recategorized at once.')
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('submits a selection within the limit', async () => {
    const onDone = vi.fn();
    mockedFinancialApi.bulkRecategorize.mockResolvedValue({
      transactionCount: 2,
      categoryId: 'cat-food',
    });

    render(
      <MemoryRouter>
        <BulkRecategorizeDialog
          transactions={[makeImported(), makeImported({ id: 'tx-2' })]}
          categories={[FOOD]}
          onClose={vi.fn()}
          onDone={onDone}
        />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-food' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockedFinancialApi.bulkRecategorize).toHaveBeenCalledWith({
        transactionIds: ['tx-1', 'tx-2'],
        categoryId: 'cat-food',
        rememberForMerchant: false,
      });
    });
    expect(onDone).toHaveBeenCalledWith(2);
  });
});

describe('CategorizationSuggestion', () => {
  const preview = (confidence: number, reason: CategorizationPreview['reason']) =>
    ({
      category: {
        id: 'cat-food',
        name: 'Food',
        type: 'EXPENSE',
        icon: null,
        color: null,
        isDefault: false,
      },
      confidence,
      reason,
      matchedRule: null,
    }) satisfies CategorizationPreview;

  it('shows the loading state', () => {
    render(
      <CategorizationSuggestion preview={null} isLoading={true} error={null} />
    );
    expect(screen.getByText('Loading suggestion...')).toBeDefined();
  });

  it('shows the empty state when no preview is available', () => {
    render(<CategorizationSuggestion preview={null} isLoading={false} error={null} />);
    expect(screen.getByText('No suggestion available')).toBeDefined();
  });

  it('maps confidence to plain language, never percentages', () => {
    const { rerender } = render(
      <CategorizationSuggestion
        preview={preview(0.95, 'USER_RULE')}
        isLoading={false}
        error={null}
      />
    );
    expect(screen.getByText('High confidence')).toBeDefined();
    expect(screen.queryByText(/%/)).toBeNull();

    rerender(
      <CategorizationSuggestion
        preview={preview(0.75, 'MERCHANT_RULE')}
        isLoading={false}
        error={null}
      />
    );
    expect(screen.getByText('Medium confidence')).toBeDefined();
    expect(screen.getByText('Matched merchant')).toBeDefined();

    rerender(
      <CategorizationSuggestion
        preview={preview(0.4, 'DEFAULT_CATEGORY')}
        isLoading={false}
        error={null}
      />
    );
    expect(screen.getByText('Suggested')).toBeDefined();
    expect(screen.getByText('Default category')).toBeDefined();
  });

  it('offers a use suggestion action when a handler is provided', () => {
    const onUseSuggestion = vi.fn();
    render(
      <CategorizationSuggestion
        preview={preview(0.99, 'USER_RULE')}
        isLoading={false}
        error={null}
        onUseSuggestion={onUseSuggestion}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use suggested category Food' }));
    expect(onUseSuggestion).toHaveBeenCalledTimes(1);
  });
});
