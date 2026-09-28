import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminDashboard } from './AdminDashboard';
import { getAdminDashboard } from '../services/adminDashboardApi';
import { getMyProfile } from '../services/userApi';
import type { AdminDashboardData } from '../types/adminDashboard';

vi.mock('../services/adminDashboardApi', () => ({
  getAdminDashboard: vi.fn(),
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', firstName: 'Admin', lastName: 'User', email: 'admin@example.com', role: 'ADMIN', status: 'ACTIVE' },
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

const mockedDashboard = vi.mocked(getAdminDashboard);
const mockedProfile = vi.mocked(getMyProfile);

function makeDashboardData(overrides: Partial<AdminDashboardData> = {}): AdminDashboardData {
  return {
    users: {
      total: 100,
      active: 85,
      suspended: 10,
      deactivated: 5,
      admins: 3,
      recentlyRegistered: 12,
    },
    financialRecords: {
      transactions: 5000,
      savingsGoals: 200,
      assets: 150,
      liabilities: 80,
      wealthSnapshots: 365,
    },
    application: {
      habits: 500,
      challenges: 25,
      notifications: 1000,
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>
  );
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

describe('AdminDashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProfile.mockResolvedValue({
      profile: { financialProfile: { currency: 'USD' } },
    } as Awaited<ReturnType<typeof getMyProfile>>);
    mockedDashboard.mockResolvedValue(makeDashboardData());
  });

  it('renders the dashboard heading and navigation', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeDefined();
    expect(screen.getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: /Admin/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the timestamp', async () => {
    renderPage();

    await screen.findByTestId('admin-dashboard-timestamp');
    expect(screen.getByTestId('admin-dashboard-timestamp')).toHaveTextContent(/Last refreshed:/);
  });

  it('renders user overview metrics', async () => {
    renderPage();

    const usersSection = await screen.findByTestId('admin-users');
    expect(usersSection).toBeDefined();
    expect(within(usersSection).getByTestId('admin-users-total')).toHaveTextContent('100');
    expect(within(usersSection).getByTestId('admin-users-active')).toHaveTextContent('85');
    expect(within(usersSection).getByTestId('admin-users-suspended')).toHaveTextContent('10');
    expect(within(usersSection).getByTestId('admin-users-deactivated')).toHaveTextContent('5');
    expect(within(usersSection).getByTestId('admin-users-admins')).toHaveTextContent('3');
    expect(within(usersSection).getByTestId('admin-users-recent')).toHaveTextContent('12');
  });

  it('renders financial records metrics', async () => {
    renderPage();

    const financialSection = await screen.findByTestId('admin-financial');
    expect(financialSection).toBeDefined();
    expect(within(financialSection).getByTestId('admin-financial-transactions')).toHaveTextContent('5,000');
    expect(within(financialSection).getByTestId('admin-financial-goals')).toHaveTextContent('200');
    expect(within(financialSection).getByTestId('admin-financial-assets')).toHaveTextContent('150');
    expect(within(financialSection).getByTestId('admin-financial-liabilities')).toHaveTextContent('80');
    expect(within(financialSection).getByTestId('admin-financial-snapshots')).toHaveTextContent('365');
  });

  it('renders application metrics', async () => {
    renderPage();

    const appSection = await screen.findByTestId('admin-application');
    expect(appSection).toBeDefined();
    expect(within(appSection).getByTestId('admin-application-habits')).toHaveTextContent('500');
    expect(within(appSection).getByTestId('admin-application-challenges')).toHaveTextContent('25');
    expect(within(appSection).getByTestId('admin-application-notifications')).toHaveTextContent('1,000');
  });

  it('shows zero values correctly', async () => {
    mockedDashboard.mockResolvedValue(
      makeDashboardData({
        users: { total: 0, active: 0, suspended: 0, deactivated: 0, admins: 0, recentlyRegistered: 0 },
        financialRecords: { transactions: 0, savingsGoals: 0, assets: 0, liabilities: 0, wealthSnapshots: 0 },
        application: { habits: 0, challenges: 0, notifications: 0 },
      })
    );

    renderPage();

    await screen.findByTestId('admin-users');
    expect(within(screen.getByTestId('admin-users')).getByTestId('admin-users-total')).toHaveTextContent('0');
    expect(screen.getByTestId('admin-financial-transactions')).toHaveTextContent('0');
    expect(screen.getByTestId('admin-application-habits')).toHaveTextContent('0');
  });

  it('shows loading state while fetching', async () => {
    mockedDashboard.mockReturnValue(pending());

    renderPage();

    expect(await screen.findByTestId('admin-dashboard-loading')).toHaveTextContent('Loading dashboard...');
  });

  it('shows error state and allows retry', async () => {
    mockedDashboard
      .mockRejectedValueOnce(new Error('Failed to load'))
      .mockResolvedValue(makeDashboardData());

    renderPage();

    await waitFor(() => expect(screen.getByTestId('admin-dashboard-error')).toBeInTheDocument());
    const alert = screen.getByTestId('admin-dashboard-error');
    expect(alert).toHaveTextContent('Failed to load');
    // When there's an error, the data sections are not rendered
    await waitFor(() => expect(screen.queryByTestId('admin-users')).toBeNull());

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByTestId('admin-dashboard-error')).not.toBeInTheDocument());
    expect(await screen.findByTestId('admin-users')).toBeDefined();
    expect(mockedDashboard).toHaveBeenCalledTimes(2);
  });

  it('disables refresh button while loading', async () => {
    let resolveDownload: (value: AdminDashboardData) => void = () => undefined;
    mockedDashboard.mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = resolve;
      })
    );

    renderPage();

    const refreshBtn = screen.getByTestId('admin-dashboard-refresh');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(refreshBtn).toBeDisabled();
    });
    expect(refreshBtn).toHaveTextContent('Refreshing...');

    resolveDownload(makeDashboardData());

    await waitFor(() => expect(refreshBtn).toBeEnabled());
  });

  it('never exposes individual financial amounts in the response', async () => {
    renderPage();

    await screen.findByTestId('admin-users');
    const pageText = document.body.textContent ?? '';
    expect(pageText).not.toMatch(/\$[\d,]+\.\d{2}/); // no dollar amounts
    expect(pageText).not.toMatch(/\d+\.\d{2}/); // no decimal amounts
  });
});