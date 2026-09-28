import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { AdminSystemHealth } from './AdminSystemHealth';
import { RequireAdmin } from '../components/RequireAdmin';
import { getSystemHealth } from '../services/adminSystemHealthApi';
import type { SystemHealthData } from '../types/adminSystemHealth';

const authState = vi.hoisted(() => ({
  user: {
    id: 'u1',
    firstName: 'Ada',
    lastName: 'Admin',
    email: 'admin@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
  } as { id: string; role: string } | null,
}));

vi.mock('../services/adminSystemHealthApi', () => ({
  getSystemHealth: vi.fn(),
  adminSystemHealthApi: {
    getSystemHealth: vi.fn(),
  },
}));

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    isAuthenticated: authState.user !== null,
    isLoading: false,
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

const mockedHealth = vi.mocked(getSystemHealth);

function makeHealth(
  overrides: Partial<SystemHealthData> = {}
): SystemHealthData {
  return {
    status: 'HEALTHY',
    generatedAt: '2026-09-28T10:00:00.000Z',
    application: {
      status: 'HEALTHY',
      service: 'WealthHabit API',
      environment: 'development',
      uptimeSeconds: 3725,
    },
    database: {
      status: 'HEALTHY',
      latencyMs: 3,
      message: null,
    },
    runtime: {
      status: 'HEALTHY',
      nodeVersion: '22.14',
      uptimeSeconds: 3725,
      memory: { rssMb: 120.5, heapUsedMb: 45.2, heapTotalMb: 60.8 },
    },
    ...overrides,
  };
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/system-health']}>
      <AppLayout>
        <AdminSystemHealth />
      </AppLayout>
    </MemoryRouter>
  );
}

describe('AdminSystemHealth page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'u1', role: 'ADMIN' };
    mockedHealth.mockResolvedValue(makeHealth());
  });

  it('shows the loading state while fetching', async () => {
    mockedHealth.mockReturnValue(pending());
    renderPage();

    expect(
      await screen.findByTestId('admin-system-health-loading')
    ).toHaveTextContent('Loading system health...');
    expect(screen.queryByTestId('admin-system-health-overall')).toBeNull();
    expect(
      screen.queryByTestId('admin-system-health-application')
    ).toBeNull();
  });

  it('renders the healthy state with all components', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'System Health' })
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: /System Health/ })
    ).toHaveAttribute('href', '/admin/system-health');
    expect(
      screen.getByRole('link', { name: /System Health/ })
    ).toHaveAttribute('aria-current', 'page');

    const overall = await screen.findByTestId('admin-system-health-overall');
    expect(overall).toHaveTextContent('HEALTHY');

    expect(
      screen.getByTestId('admin-system-health-application-status')
    ).toHaveTextContent('HEALTHY');
    expect(
      screen.getByTestId('admin-system-health-application-service')
    ).toHaveTextContent('WealthHabit API');
    expect(
      screen.getByTestId('admin-system-health-application-environment')
    ).toHaveTextContent('development');
    expect(
      screen.getByTestId('admin-system-health-database-status')
    ).toHaveTextContent('HEALTHY');
    expect(
      screen.getByTestId('admin-system-health-runtime-status')
    ).toHaveTextContent('HEALTHY');
    expect(
      screen.getByTestId('admin-system-health-timestamp')
    ).toHaveTextContent('Last checked:');
  });

  it('renders a degraded state', async () => {
    mockedHealth.mockResolvedValue(
      makeHealth({
        status: 'DEGRADED',
        runtime: {
          status: 'DEGRADED',
          nodeVersion: '22.14',
          uptimeSeconds: 3725,
          memory: { rssMb: 400, heapUsedMb: 190, heapTotalMb: 195 },
        },
      })
    );
    renderPage();

    expect(await screen.findByTestId('admin-system-health-overall')).toHaveTextContent(
      'DEGRADED'
    );
    expect(
      screen.getByTestId('admin-system-health-runtime-status')
    ).toHaveTextContent('DEGRADED');
    expect(
      screen.getByTestId('admin-system-health-database-status')
    ).toHaveTextContent('HEALTHY');
  });

  it('renders an unhealthy state when the database is down', async () => {
    mockedHealth.mockResolvedValue(
      makeHealth({
        status: 'UNHEALTHY',
        database: {
          status: 'UNHEALTHY',
          latencyMs: null,
          message: 'Database health check failed',
        },
      })
    );
    renderPage();

    expect(await screen.findByTestId('admin-system-health-overall')).toHaveTextContent(
      'UNHEALTHY'
    );
    expect(
      screen.getByTestId('admin-system-health-database-status')
    ).toHaveTextContent('UNHEALTHY');
    expect(
      screen.getByTestId('admin-system-health-database-latency')
    ).toHaveTextContent('—');
    expect(
      screen.getByTestId('admin-system-health-database-message')
    ).toHaveTextContent('Database health check failed');
    expect(
      screen.getByTestId('admin-system-health-application-status')
    ).toHaveTextContent('HEALTHY');
  });

  it('shows the database health-query latency', async () => {
    renderPage();
    await screen.findByTestId('admin-system-health-database');

    expect(
      screen.getByTestId('admin-system-health-database-latency')
    ).toHaveTextContent('3 ms');
  });

  it('shows runtime information', async () => {
    renderPage();
    await screen.findByTestId('admin-system-health-runtime');

    expect(screen.getByTestId('admin-system-health-runtime-node')).toHaveTextContent(
      '22.14'
    );
    expect(
      screen.getByTestId('admin-system-health-runtime-uptime')
    ).toHaveTextContent('1h 2m');
    const memory = screen.getByTestId('admin-system-health-runtime-memory');
    expect(memory).toHaveTextContent('120.5 MB RSS');
    expect(memory).toHaveTextContent('45.2/60.8 MB heap');
    expect(
      screen.getByTestId('admin-system-health-application-uptime')
    ).toHaveTextContent('1h 2m');
  });

  it('refreshes the report on demand', async () => {
    renderPage();
    await screen.findByTestId('admin-system-health-overall');
    expect(mockedHealth).toHaveBeenCalledTimes(1);

    mockedHealth.mockResolvedValue(
      makeHealth({ generatedAt: '2026-09-28T11:30:00.000Z' })
    );
    fireEvent.click(screen.getByTestId('admin-system-health-refresh'));

    await waitFor(() => {
      expect(mockedHealth).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('admin-system-health-overall')).toBeDefined();
    });
    expect(screen.queryByTestId('admin-system-health-error')).toBeNull();
  });

  it('shows an API error', async () => {
    mockedHealth.mockRejectedValue(new Error('Network down'));
    renderPage();

    const error = await screen.findByTestId('admin-system-health-error');
    expect(error).toHaveTextContent('Network down');
    expect(screen.queryByTestId('admin-system-health-overall')).toBeNull();
  });

  it('retries after a failed load', async () => {
    mockedHealth.mockRejectedValueOnce(new Error('Network down'));
    renderPage();

    const error = await screen.findByTestId('admin-system-health-error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('admin-system-health-overall')).toBeDefined();
    expect(screen.queryByTestId('admin-system-health-error')).toBeNull();
    expect(error).toBeDefined();
    expect(mockedHealth).toHaveBeenCalledTimes(2);
  });

  it('never renders sensitive or out-of-schema values', async () => {
    mockedHealth.mockResolvedValue({
      ...makeHealth(),
      databaseUrl: 'postgresql://user:secret@internal:5432/wealthhabit',
      jwtSecret: 'super-secret-jwt-value',
      env: { JWT_ACCESS_SECRET: 'super-secret-jwt-value' },
    } as unknown as SystemHealthData);
    renderPage();

    await screen.findByTestId('admin-system-health-overall');
    const text = screen.getByRole('main').textContent ?? '';
    expect(text).not.toContain('postgresql://');
    expect(text).not.toContain('super-secret-jwt-value');
    expect(text).not.toContain('DATABASE_URL');
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('JWT_ACCESS_SECRET');
  });
});

describe('RequireAdmin access for /admin/system-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedHealth.mockResolvedValue(makeHealth());
    authState.user = { id: 'u1', role: 'ADMIN' };
  });

  it('redirects an authenticated USER to the dashboard', async () => {
    authState.user = { id: 'u1', role: 'USER' };

    render(
      <MemoryRouter initialEntries={['/admin/system-health']}>
        <Routes>
          <Route
            path="/admin/system-health"
            element={
              <RequireAdmin>
                <AdminSystemHealth />
              </RequireAdmin>
            }
          />
          <Route path="/dashboard" element={<div>dashboard-home</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('dashboard-home')).toBeDefined();
    });
    expect(screen.queryByTestId('admin-system-health-overall')).toBeNull();
  });

  it('redirects anonymous visitors to login', async () => {
    authState.user = null;

    render(
      <MemoryRouter initialEntries={['/admin/system-health']}>
        <Routes>
          <Route
            path="/admin/system-health"
            element={
              <RequireAdmin>
                <AdminSystemHealth />
              </RequireAdmin>
            }
          />
          <Route path="/login" element={<div>login-page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('login-page')).toBeDefined();
    });
  });

  it('renders the page for an ADMIN', async () => {
    authState.user = { id: 'u1', role: 'ADMIN' };

    render(
      <MemoryRouter initialEntries={['/admin/system-health']}>
        <Routes>
          <Route
            path="/admin/system-health"
            element={
              <RequireAdmin>
                <AdminSystemHealth />
              </RequireAdmin>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('heading', { name: 'System Health' })
    ).toBeDefined();
    expect(await screen.findByTestId('admin-system-health-overall')).toBeDefined();
  });
});
