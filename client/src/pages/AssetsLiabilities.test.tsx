import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssetsLiabilities } from './AssetsLiabilities';
import { assetLiabilityApi } from '../services/assetLiabilityApi';
import { getMyProfile } from '../services/userApi';
import type {
  Asset,
  AssetsLiabilitiesSummary,
  Liability,
} from '../types/assetLiability';

vi.mock('../services/assetLiabilityApi', () => ({
  assetLiabilityApi: {
    getAssets: vi.fn(),
    getAsset: vi.fn(),
    createAsset: vi.fn(),
    updateAsset: vi.fn(),
    deleteAsset: vi.fn(),
    getLiabilities: vi.fn(),
    getLiability: vi.fn(),
    createLiability: vi.fn(),
    updateLiability: vi.fn(),
    deleteLiability: vi.fn(),
    getAssetsLiabilitiesSummary: vi.fn(),
  },
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

vi.mock('../services/notificationApi', () => ({
  notificationApi: {
    getNotifications: vi.fn(),
    getUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 0 }),
    generateNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
  },
}));

const mockedApi = vi.mocked(assetLiabilityApi);
const mockedProfile = vi.mocked(getMyProfile);

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'a1',
    name: 'Savings account',
    type: 'BANK_ACCOUNT',
    currentValue: 45000,
    notes: null,
    status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLiability(overrides: Partial<Liability> = {}): Liability {
  return {
    id: 'l1',
    name: 'Credit card',
    type: 'CREDIT_CARD',
    outstandingAmount: 35000,
    notes: null,
    status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSummary(
  overrides: Partial<AssetsLiabilitiesSummary> = {}
): AssetsLiabilitiesSummary {
  return {
    totalAssets: 0,
    totalLiabilities: 0,
    netWorth: 0,
    assetCount: 0,
    liabilityCount: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AssetsLiabilities />
    </MemoryRouter>
  );
}

async function openForm(kind: 'asset' | 'liability') {
  renderPage();
  fireEvent.click(
    await screen.findByTestId(
      kind === 'asset' ? 'create-asset-button' : 'create-liability-button'
    )
  );
  await screen.findByTestId('asset-liability-form');
}

function fillForm(values: { name?: string; value?: string; notes?: string }) {
  if (values.name !== undefined) {
    fireEvent.change(screen.getByTestId('record-name-input'), {
      target: { value: values.name },
    });
  }
  if (values.value !== undefined) {
    fireEvent.change(screen.getByTestId('record-value-input'), {
      target: { value: values.value },
    });
  }
  if (values.notes !== undefined) {
    fireEvent.change(screen.getByTestId('record-notes-input'), {
      target: { value: values.notes },
    });
  }
}

describe('Assets and Liabilities page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProfile.mockResolvedValue({
      profile: { financialProfile: { currency: 'USD' } },
    } as Awaited<ReturnType<typeof getMyProfile>>);
    mockedApi.getAssets.mockResolvedValue({
      assets: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    mockedApi.getLiabilities.mockResolvedValue({
      liabilities: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    mockedApi.getAssetsLiabilitiesSummary.mockResolvedValue(makeSummary());
  });

  describe('listing and summary', () => {
    it('loads assets, liabilities and the summary on mount', async () => {
      mockedApi.getAssets.mockResolvedValue({
        assets: [makeAsset()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedApi.getLiabilities.mockResolvedValue({
        liabilities: [makeLiability()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedApi.getAssetsLiabilitiesSummary.mockResolvedValue(
        makeSummary({
          totalAssets: 45000,
          totalLiabilities: 35000,
          assetCount: 1,
          liabilityCount: 1,
        })
      );

      renderPage();

      expect(mockedApi.getAssets).toHaveBeenCalledWith({ pageSize: 50 });
      expect(mockedApi.getLiabilities).toHaveBeenCalledWith({ pageSize: 50 });
      expect(mockedApi.getAssetsLiabilitiesSummary).toHaveBeenCalledTimes(1);

      const assetCard = await screen.findByTestId('asset-card-Savings account');
      expect(within(assetCard).getByTestId('asset-value-Savings account')).toHaveTextContent(
        '$45,000.00'
      );
      expect(within(assetCard).getByTestId('asset-status-Savings account')).toHaveTextContent(
        'Active'
      );

      const liabilityCard = screen.getByTestId('liability-card-Credit card');
      expect(
        within(liabilityCard).getByTestId('liability-value-Credit card')
      ).toHaveTextContent('$35,000.00');
      expect(
        within(liabilityCard).getByTestId('liability-status-Credit card')
      ).toHaveTextContent('Active');
    });

    it('shows the summary totals and counts without a net worth figure', async () => {
      mockedApi.getAssetsLiabilitiesSummary.mockResolvedValue(
        makeSummary({
          totalAssets: 50250,
          totalLiabilities: 28500,
          assetCount: 2,
          liabilityCount: 3,
        })
      );

      renderPage();

      expect(await screen.findByTestId('summary-total-assets')).toHaveTextContent(
        '$50,250.00'
      );
      expect(screen.getByTestId('summary-asset-count')).toHaveTextContent('2 assets');
      expect(
        screen.getByTestId('summary-total-liabilities')
      ).toHaveTextContent('$28,500.00');
      expect(screen.getByTestId('summary-liability-count')).toHaveTextContent(
        '3 liabilities'
      );
      const summary = screen.getByTestId('assets-liabilities-summary');
      expect(within(summary).queryByText(/net worth/i)).toBeNull();
    });

    it('marks a zero-balance liability as paid off', async () => {
      mockedApi.getLiabilities.mockResolvedValue({
        liabilities: [makeLiability({ name: 'Old loan', outstandingAmount: 0, status: 'PAID_OFF' })],
        page: 1,
        pageSize: 50,
        total: 1,
      });

      renderPage();

      expect(
        (await screen.findByTestId('liability-status-Old loan')).textContent
      ).toBe('Paid off');
    });

    it('shows the empty state with both create actions', async () => {
      renderPage();

      expect(await screen.findByTestId('assets-empty-create-asset')).toBeDefined();
      expect(screen.getByTestId('assets-empty-create-liability')).toBeDefined();
      expect(screen.queryByTestId('asset-card-Savings account')).toBeNull();
    });

    it('shows a retryable error when loading fails', async () => {
      mockedApi.getAssets.mockRejectedValue(new Error('Assets unavailable'));

      renderPage();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Assets unavailable');

      mockedApi.getAssets.mockResolvedValue({
        assets: [makeAsset()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

      expect(await screen.findByTestId('asset-card-Savings account')).toBeDefined();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('creating records', () => {
    it('creates an asset with the entered values', async () => {
      mockedApi.createAsset.mockResolvedValue(makeAsset({ name: 'Gold coins' }));
      await openForm('asset');

      fillForm({ name: 'Gold coins', value: '1200.50', notes: 'Safe deposit' });
      fireEvent.click(screen.getByTestId('record-submit'));

      await waitFor(() =>
        expect(mockedApi.createAsset).toHaveBeenCalledWith({
          name: 'Gold coins',
          type: 'BANK_ACCOUNT',
          currentValue: '1200.50',
          notes: 'Safe deposit',
        })
      );
      expect(mockedApi.createLiability).not.toHaveBeenCalled();
      expect(await screen.findByTestId('assets-liabilities-success')).toHaveTextContent(
        'Asset "Gold coins" created'
      );
      expect(screen.queryByTestId('asset-liability-form')).toBeNull();
    });

    it('creates a liability with the entered values', async () => {
      mockedApi.createLiability.mockResolvedValue(makeLiability({ name: 'Car loan' }));
      await openForm('liability');

      fillForm({ name: 'Car loan', value: '450000' });
      fireEvent.change(screen.getByTestId('record-type-select'), {
        target: { value: 'VEHICLE_LOAN' },
      });
      fireEvent.click(screen.getByTestId('record-submit'));

      await waitFor(() =>
        expect(mockedApi.createLiability).toHaveBeenCalledWith({
          name: 'Car loan',
          type: 'VEHICLE_LOAN',
          outstandingAmount: '450000',
          notes: undefined,
        })
      );
      expect(mockedApi.createAsset).not.toHaveBeenCalled();
      expect(await screen.findByTestId('assets-liabilities-success')).toHaveTextContent(
        'Liability "Car loan" created'
      );
    });

    it('accepts a zero amount', async () => {
      mockedApi.createAsset.mockResolvedValue(makeAsset({ name: 'Empty wallet' }));
      await openForm('asset');

      fillForm({ name: 'Empty wallet', value: '0' });
      fireEvent.click(screen.getByTestId('record-submit'));

      await waitFor(() =>
        expect(mockedApi.createAsset).toHaveBeenCalledWith(
          expect.objectContaining({ currentValue: '0' })
        )
      );
    });

    it('blocks submission when the name is empty', async () => {
      await openForm('asset');

      fillForm({ name: '', value: '100' });
      fireEvent.click(screen.getByTestId('record-submit'));

      expect(
        await screen.findByText('Name is required')
      ).toBeDefined();
      expect(mockedApi.createAsset).not.toHaveBeenCalled();
    });

    it('blocks submission when the amount is malformed', async () => {
      await openForm('asset');

      fillForm({ name: 'Bank', value: 'abc' });
      fireEvent.click(screen.getByTestId('record-submit'));

      expect(
        await screen.findByText('Amount must be a number with up to 2 decimal places')
      ).toBeDefined();
      expect(mockedApi.createAsset).not.toHaveBeenCalled();
    });

    it('blocks submission when the amount is negative', async () => {
      await openForm('asset');

      fillForm({ name: 'Bank', value: '-5' });
      fireEvent.click(screen.getByTestId('record-submit'));

      expect(
        await screen.findByText('Amount must be a number with up to 2 decimal places')
      ).toBeDefined();
      expect(mockedApi.createAsset).not.toHaveBeenCalled();
    });

    it('shows a server error inside the form', async () => {
      mockedApi.createAsset.mockRejectedValue(new Error('Name is already used'));
      await openForm('asset');

      fillForm({ name: 'Bank', value: '100' });
      fireEvent.click(screen.getByTestId('record-submit'));

      expect(await screen.findByTestId('asset-liability-form-error')).toHaveTextContent(
        'Name is already used'
      );
      expect(screen.getByTestId('asset-liability-form')).toBeDefined();
    });
  });

  describe('updating records', () => {
    it('edits an asset and submits only editable fields', async () => {
      mockedApi.getAssets.mockResolvedValue({
        assets: [makeAsset()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedApi.updateAsset.mockResolvedValue(
        makeAsset({ name: 'Savings account', currentValue: 50000 })
      );

      renderPage();
      fireEvent.click(await screen.findByTestId('asset-edit-Savings account'));
      await screen.findByTestId('asset-liability-form');

      expect(screen.getByTestId('record-name-input')).toHaveValue('Savings account');
      expect(screen.getByTestId('record-value-input')).toHaveValue('45000');

      fillForm({ value: '50000' });
      fireEvent.click(screen.getByTestId('record-submit'));

      await waitFor(() =>
        expect(mockedApi.updateAsset).toHaveBeenCalledWith('a1', {
          name: 'Savings account',
          type: 'BANK_ACCOUNT',
          currentValue: '50000',
          notes: null,
        })
      );
      expect(mockedApi.updateAsset.mock.calls[0][1]).not.toHaveProperty('userId');
      expect(await screen.findByTestId('assets-liabilities-success')).toHaveTextContent(
        'Asset "Savings account" updated'
      );
    });

    it('edits a liability balance', async () => {
      mockedApi.getLiabilities.mockResolvedValue({
        liabilities: [makeLiability()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedApi.updateLiability.mockResolvedValue(
        makeLiability({ outstandingAmount: 30000 })
      );

      renderPage();
      fireEvent.click(await screen.findByTestId('liability-edit-Credit card'));
      await screen.findByTestId('asset-liability-form');

      expect(screen.getByTestId('record-value-input')).toHaveValue('35000');

      fillForm({ value: '30000' });
      fireEvent.click(screen.getByTestId('record-submit'));

      await waitFor(() =>
        expect(mockedApi.updateLiability).toHaveBeenCalledWith('l1', {
          name: 'Credit card',
          type: 'CREDIT_CARD',
          outstandingAmount: '30000',
          notes: null,
        })
      );
      expect(await screen.findByTestId('assets-liabilities-success')).toHaveTextContent(
        'Liability "Credit card" updated'
      );
    });
  });

  describe('deleting records', () => {
    it('deletes an asset after confirmation', async () => {
      mockedApi.getAssets.mockResolvedValue({
        assets: [makeAsset()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedApi.deleteAsset.mockResolvedValue({ message: 'Asset deleted' });

      renderPage();
      fireEvent.click(await screen.findByTestId('asset-delete-Savings account'));
      const modal = await screen.findByTestId('delete-record-modal');
      expect(within(modal).getByRole('heading')).toHaveTextContent('Delete asset?');

      fireEvent.click(screen.getByTestId('delete-record-confirm'));

      await waitFor(() => expect(mockedApi.deleteAsset).toHaveBeenCalledWith('a1'));
      expect(await screen.findByTestId('assets-liabilities-success')).toHaveTextContent(
        'Asset "Savings account" deleted'
      );
      expect(mockedApi.deleteLiability).not.toHaveBeenCalled();
    });

    it('deletes a liability after confirmation', async () => {
      mockedApi.getLiabilities.mockResolvedValue({
        liabilities: [makeLiability()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedApi.deleteLiability.mockResolvedValue({ message: 'Liability deleted' });

      renderPage();
      fireEvent.click(await screen.findByTestId('liability-delete-Credit card'));
      const modal = await screen.findByTestId('delete-record-modal');
      expect(within(modal).getByRole('heading')).toHaveTextContent('Delete liability?');

      fireEvent.click(screen.getByTestId('delete-record-confirm'));

      await waitFor(() =>
        expect(mockedApi.deleteLiability).toHaveBeenCalledWith('l1')
      );
      expect(mockedApi.deleteAsset).not.toHaveBeenCalled();
    });

    it('cancels without calling the API', async () => {
      mockedApi.getAssets.mockResolvedValue({
        assets: [makeAsset()],
        page: 1,
        pageSize: 50,
        total: 1,
      });

      renderPage();
      fireEvent.click(await screen.findByTestId('asset-delete-Savings account'));
      await screen.findByTestId('delete-record-modal');

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('delete-record-modal')).toBeNull();
      expect(mockedApi.deleteAsset).not.toHaveBeenCalled();
    });
  });
});
