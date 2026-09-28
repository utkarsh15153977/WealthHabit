import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { NetWorth } from './NetWorth';
import { assetLiabilityApi } from '../services/assetLiabilityApi';
import { wealthSnapshotApi } from '../services/wealthSnapshotApi';
import { getMyProfile } from '../services/userApi';
import { formatDate } from '../utils/date';
import type { AssetsLiabilitiesSummary } from '../types/assetLiability';
import type { WealthSnapshot } from '../types/wealthSnapshot';

vi.mock('../services/assetLiabilityApi', () => ({
  assetLiabilityApi: {
    getNetWorth: vi.fn(),
    getAssetsLiabilitiesSummary: vi.fn(),
  },
}));

vi.mock('../services/wealthSnapshotApi', () => ({
  wealthSnapshotApi: {
    getWealthSnapshots: vi.fn(),
    createWealthSnapshot: vi.fn(),
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

const mockedGetNetWorth = vi.mocked(assetLiabilityApi.getNetWorth);
const mockedGetSnapshots = vi.mocked(wealthSnapshotApi.getWealthSnapshots);
const mockedCreateSnapshot = vi.mocked(wealthSnapshotApi.createWealthSnapshot);
const mockedProfile = vi.mocked(getMyProfile);

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

function makeSnapshot(overrides: Partial<WealthSnapshot> = {}): WealthSnapshot {
  return {
    id: 's1',
    snapshotDate: '2026-09-26T00:00:00.000Z',
    totalAssets: 0,
    totalLiabilities: 0,
    netWorth: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/net-worth']}>
      <AppLayout>
        <NetWorth />
      </AppLayout>
    </MemoryRouter>
  );
}

describe('NetWorth page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProfile.mockResolvedValue({
      profile: { financialProfile: { currency: 'USD' } },
    } as Awaited<ReturnType<typeof getMyProfile>>);
    mockedGetNetWorth.mockResolvedValue(makeSummary());
    mockedGetSnapshots.mockResolvedValue({
      snapshots: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    mockedCreateSnapshot.mockResolvedValue({
      snapshot: makeSnapshot(),
      created: true,
    });
  });

  it('shows the live net worth, totals and record counts', async () => {
    mockedGetNetWorth.mockResolvedValue(
      makeSummary({
        totalAssets: 45000,
        totalLiabilities: 18000,
        netWorth: 27000,
        assetCount: 2,
        liabilityCount: 1,
      })
    );

    renderPage();

    expect(await screen.findByTestId('net-worth-current')).toHaveTextContent(
      '$27,000'
    );
    expect(
      screen.getByTestId('net-worth-total-assets')
    ).toHaveTextContent('$45,000');
    expect(
      screen.getByTestId('net-worth-total-liabilities')
    ).toHaveTextContent('$18,000');
    expect(screen.getByTestId('net-worth-record-counts')).toHaveTextContent(
      '2 assets · 1 liabilities'
    );
    expect(mockedGetNetWorth).toHaveBeenCalledTimes(1);
  });

  it('shows a negative net worth without clamping it', async () => {
    mockedGetNetWorth.mockResolvedValue(
      makeSummary({
        totalAssets: 2000,
        totalLiabilities: 9500,
        netWorth: -7500,
        assetCount: 1,
        liabilityCount: 2,
      })
    );

    renderPage();

    const netWorth = await screen.findByTestId('net-worth-current');
    expect(netWorth).toHaveTextContent('-$7,500');
    expect(netWorth.className).toContain('text-error');
  });

  it('shows the empty history state before the first snapshot', async () => {
    renderPage();

    expect(await screen.findByText('No snapshots yet')).toBeDefined();
    expect(screen.queryByTestId('net-worth-history-table')).toBeNull();
    expect(screen.queryByTestId('net-worth-history-chart')).toBeNull();
  });

  it('lists snapshots newest first and renders the history chart', async () => {
    mockedGetSnapshots.mockResolvedValue({
      snapshots: [
        makeSnapshot({
          id: 's2',
          snapshotDate: '2026-09-27T00:00:00.000Z',
          totalAssets: 60000,
          totalLiabilities: 25000,
          netWorth: 35000,
        }),
        makeSnapshot({
          id: 's1',
          snapshotDate: '2026-09-26T00:00:00.000Z',
          totalAssets: 55000,
          totalLiabilities: 25000,
          netWorth: 30000,
        }),
      ],
      page: 1,
      pageSize: 50,
      total: 2,
    });

    renderPage();

    expect(await screen.findByTestId('net-worth-history-chart')).toBeDefined();
    expect(screen.getByTestId('net-worth-snapshot-count')).toHaveTextContent(
      '2 snapshots'
    );

    const rows = screen.getAllByTestId(/^net-worth-snapshot-row-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(formatDate('2026-09-27T00:00:00.000Z'));
    expect(rows[0]).toHaveTextContent('$35,000');
    expect(rows[1]).toHaveTextContent(formatDate('2026-09-26T00:00:00.000Z'));
    expect(rows[1]).toHaveTextContent('$30,000');
  });

  it('toggles the optional assets and liabilities chart lines', async () => {
    mockedGetSnapshots.mockResolvedValue({
      snapshots: [makeSnapshot({ netWorth: 1000 })],
      page: 1,
      pageSize: 50,
      total: 1,
    });

    renderPage();

    const assetsToggle = (await screen.findByTestId(
      'toggle-chart-assets'
    )) as HTMLInputElement;
    const liabilitiesToggle = screen.getByTestId(
      'toggle-chart-liabilities'
    ) as HTMLInputElement;

    expect(assetsToggle.checked).toBe(false);
    expect(liabilitiesToggle.checked).toBe(false);

    fireEvent.click(assetsToggle);

    await waitFor(() => expect(assetsToggle.checked).toBe(true));
    expect(liabilitiesToggle.checked).toBe(false);
  });

  it('captures a snapshot and reports success', async () => {
    mockedGetSnapshots.mockResolvedValue({
      snapshots: [makeSnapshot()],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockedCreateSnapshot.mockResolvedValue({
      snapshot: makeSnapshot(),
      created: true,
    });

    renderPage();

    fireEvent.click(await screen.findByTestId('capture-snapshot-button'));

    expect(await screen.findByTestId('net-worth-success')).toHaveTextContent(
      `Snapshot captured for ${formatDate('2026-09-26T00:00:00.000Z')}`
    );
    expect(mockedCreateSnapshot).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockedGetNetWorth).toHaveBeenCalledTimes(2));
  });

  it('reports an existing same-day snapshot as already captured', async () => {
    mockedCreateSnapshot.mockResolvedValue({
      snapshot: makeSnapshot(),
      created: false,
    });

    renderPage();

    fireEvent.click(await screen.findByTestId('capture-snapshot-button'));

    expect(await screen.findByTestId('net-worth-success')).toHaveTextContent(
      `A snapshot for ${formatDate('2026-09-26T00:00:00.000Z')} already exists`
    );
    expect(screen.queryByTestId('net-worth-error')).toBeNull();
  });

  it('shows an inline error when capturing fails', async () => {
    mockedCreateSnapshot.mockRejectedValue(new Error('Snapshot unavailable'));

    renderPage();

    fireEvent.click(await screen.findByTestId('capture-snapshot-button'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Snapshot unavailable'
    );
    expect(screen.queryByTestId('net-worth-success')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('capture-snapshot-button')).toBeEnabled()
    );
  });

  it('shows an inline error and retry when loading fails', async () => {
    mockedGetNetWorth.mockRejectedValue(new Error('Summary unavailable'));
    mockedGetSnapshots.mockRejectedValue(new Error('Summary unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Summary unavailable'
    );
    expect(screen.getByTestId('net-worth-current')).toHaveTextContent('—');
  });

  it('marks Net Worth as the current nav item', async () => {
    renderPage();

    const current = await screen.findByRole('link', { name: /net worth/i });
    expect(current).toHaveAttribute('href', '/net-worth');
    expect(current).toHaveAttribute('aria-current', 'page');
  });
});
