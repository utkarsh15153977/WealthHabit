import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { AdminAuditLogs } from './AdminAuditLogs';
import { RequireAdmin } from '../components/RequireAdmin';
import { listAuditLogs } from '../services/adminAuditLogsApi';
import type {
  AdminAuditLogEntry,
  AdminAuditLogListResponse,
} from '../types/adminAuditLogs';

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

vi.mock('../services/adminAuditLogsApi', () => ({
  listAuditLogs: vi.fn(),
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

const mockedList = vi.mocked(listAuditLogs);

function makeLog(overrides: Partial<AdminAuditLogEntry> = {}): AdminAuditLogEntry {
  return {
    id: 'log1',
    action: 'ADMIN_USER_STATUS_CHANGED',
    entityType: 'User',
    entityId: 'calice0000000000000000',
    actor: {
      id: 'u1',
      email: 'admin@example.com',
      firstName: 'Ada',
      lastName: 'Admin',
    },
    target: {
      id: 'calice0000000000000000',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Anderson',
    },
    metadata: {
      targetUserId: 'calice0000000000000000',
      from: 'ACTIVE',
      to: 'SUSPENDED',
      revokedSessions: 2,
    },
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeList(
  logs: AdminAuditLogEntry[],
  overrides: Partial<AdminAuditLogListResponse> = {}
): AdminAuditLogListResponse {
  return {
    auditLogs: logs,
    page: 1,
    pageSize: 20,
    total: logs.length,
    totalPages: 1,
    ...overrides,
  };
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/audit-logs']}>
      <AppLayout>
        <AdminAuditLogs />
      </AppLayout>
    </MemoryRouter>
  );
}

function desktopTable() {
  return within(screen.getByTestId('admin-logs-table'));
}

const roleChangeLog = makeLog({
  id: 'log2',
  action: 'ADMIN_USER_ROLE_CHANGED',
  entityId: 'cbob000000000000000000',
  target: {
    id: 'cbob000000000000000000',
    email: 'bob@example.com',
    firstName: 'Bob',
    lastName: 'Baker',
  },
  metadata: { targetUserId: 'cbob000000000000000000', from: 'USER', to: 'ADMIN' },
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('AdminAuditLogs page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: 'u1',
      role: 'ADMIN',
    };
    mockedList.mockResolvedValue(makeList([makeLog(), roleChangeLog]));
  });

  it('shows the loading state while fetching', async () => {
    mockedList.mockReturnValue(pending());
    renderPage();
    expect(await screen.findByTestId('admin-logs-loading')).toHaveTextContent(
      'Loading audit logs...'
    );
    expect(screen.queryByTestId('admin-logs-table')).toBeNull();
  });

  it('renders the heading, navigation and audit rows', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Audit Logs' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Audit Logs' })).toHaveAttribute(
      'href',
      '/admin/audit-logs'
    );
    expect(screen.getByRole('link', { name: 'Audit Logs' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    const table = await screen.findByTestId('admin-logs-table');
    const rows = desktopTable().getAllByTestId('admin-log-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ADMIN_USER_STATUS_CHANGED');
    expect(rows[0]).toHaveTextContent('Ada Admin');
    expect(rows[0]).toHaveTextContent('admin@example.com');
    expect(rows[0]).toHaveTextContent('Alice Anderson');
    expect(rows[0]).toHaveTextContent('alice@example.com');
    expect(table).toBeDefined();
  });

  it('applies the action filter on Apply', async () => {
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.change(screen.getByTestId('admin-logs-action-filter'), {
      target: { value: 'ADMIN_USER_ROLE_CHANGED' },
    });
    fireEvent.click(screen.getByTestId('admin-logs-apply'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: 'ADMIN_USER_ROLE_CHANGED',
          page: 1,
        })
      )
    );
  });

  it('debounces search input into the list query', async () => {
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.change(screen.getByTestId('admin-logs-search'), {
      target: { value: 'alice@example.com' },
    });

    await waitFor(
      () =>
        expect(mockedList).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'alice@example.com', page: 1 })
        ),
      { timeout: 2000 }
    );
  });

  it('applies date range filters on Apply', async () => {
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.change(screen.getByTestId('admin-logs-date-from'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByTestId('admin-logs-date-to'), {
      target: { value: '2026-01-31' },
    });
    fireEvent.click(screen.getByTestId('admin-logs-apply'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
      )
    );
  });

  it('applies actor and target id filters on Apply', async () => {
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.change(screen.getByTestId('admin-logs-actor-filter'), {
      target: { value: 'cactor00000000000000000' },
    });
    fireEvent.change(screen.getByTestId('admin-logs-entity-filter'), {
      target: { value: 'ctarget0000000000000000' },
    });
    fireEvent.click(screen.getByTestId('admin-logs-apply'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actorUserId: 'cactor00000000000000000',
          entityId: 'ctarget0000000000000000',
        })
      )
    );
  });

  it('supports pagination', async () => {
    mockedList.mockResolvedValue(
      makeList([makeLog(), roleChangeLog], { page: 1, total: 60, totalPages: 3 })
    );
    renderPage();

    expect(await screen.findByTestId('admin-logs-showing')).toHaveTextContent(
      'Showing 1–20 of 60'
    );
    expect(screen.getByTestId('admin-logs-page-indicator')).toHaveTextContent(
      'Page 1 of 3'
    );
    expect(screen.getByTestId('admin-logs-prev')).toBeDisabled();
    expect(screen.getByTestId('admin-logs-next')).toBeEnabled();

    mockedList.mockResolvedValue(
      makeList([roleChangeLog], { page: 2, total: 60, totalPages: 3 })
    );
    fireEvent.click(screen.getByTestId('admin-logs-next'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 })
      )
    );
    expect(await screen.findByTestId('admin-logs-page-indicator')).toHaveTextContent(
      'Page 2 of 3'
    );
    expect(screen.getByTestId('admin-logs-prev')).toBeEnabled();
  });

  it('shows an empty state when there are no audit events', async () => {
    mockedList.mockResolvedValue(makeList([]));
    renderPage();

    const empty = await screen.findByTestId('admin-logs-empty');
    expect(empty).toHaveTextContent('No audit events recorded');
    expect(screen.queryByTestId('admin-logs-table')).toBeNull();
  });

  it('shows a no-results state with a clear action when filters match nothing', async () => {
    mockedList.mockResolvedValue(makeList([]));
    renderPage();
    await screen.findByTestId('admin-logs-empty');

    fireEvent.change(screen.getByTestId('admin-logs-action-filter'), {
      target: { value: 'ADMIN_USER_ROLE_CHANGED' },
    });
    fireEvent.click(screen.getByTestId('admin-logs-apply'));

    const noResults = await screen.findByTestId('admin-logs-no-results');
    expect(noResults).toHaveTextContent('No matching audit events');
    expect(screen.queryByTestId('admin-logs-table')).toBeNull();

    mockedList.mockResolvedValue(makeList([makeLog(), roleChangeLog]));
    fireEvent.click(within(noResults).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      const lastCall = mockedList.mock.calls.at(-1)?.[0];
      expect(lastCall?.action).toBeUndefined();
      expect(lastCall?.search).toBeUndefined();
    });
  });

  it('shows an error state and allows retry', async () => {
    mockedList
      .mockRejectedValueOnce(new Error('Failed to load audit logs'))
      .mockResolvedValue(makeList([makeLog()]));
    renderPage();

    const alert = await screen.findByTestId('admin-logs-error');
    expect(alert).toHaveTextContent('Failed to load audit logs');

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('admin-logs-table')).toBeDefined();
    expect(screen.queryByTestId('admin-logs-error')).toBeNull();
  });

  it('clears every filter and reloads without parameters', async () => {
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.change(screen.getByTestId('admin-logs-search'), {
      target: { value: 'alice' },
    });
    await waitFor(
      () =>
        expect(mockedList).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'alice' })
        ),
      { timeout: 2000 }
    );

    fireEvent.change(screen.getByTestId('admin-logs-action-filter'), {
      target: { value: 'ADMIN_USER_STATUS_CHANGED' },
    });
    fireEvent.click(screen.getByTestId('admin-logs-apply'));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'ADMIN_USER_STATUS_CHANGED' })
      )
    );

    fireEvent.click(screen.getByTestId('admin-logs-clear-filters'));
    await waitFor(() => {
      const lastCall = mockedList.mock.calls.at(-1)?.[0];
      expect(lastCall?.action).toBeUndefined();
      expect(lastCall?.search).toBeUndefined();
      expect(lastCall?.dateFrom).toBeUndefined();
    });
    expect(screen.getByTestId('admin-logs-search')).toHaveValue('');
    expect(screen.getByTestId('admin-logs-action-filter')).toHaveValue('');
  });

  it('refetches when Refresh is clicked', async () => {
    renderPage();
    await screen.findByTestId('admin-logs-table');
    expect(mockedList).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('admin-logs-refresh'));
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
  });

  it('opens a detail dialog with safe metadata', async () => {
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.click(desktopTable().getAllByTestId('admin-logs-view')[0]);

    const dialog = await screen.findByTestId('admin-logs-detail');
    expect(within(dialog).getByTestId('admin-logs-detail-action')).toHaveTextContent(
      'ADMIN_USER_STATUS_CHANGED'
    );
    expect(within(dialog).getByTestId('admin-logs-detail-time')).toHaveTextContent(
      '2026-01-02T00:00:00.000Z'
    );
    expect(within(dialog).getByTestId('admin-logs-detail-actor')).toHaveTextContent(
      'admin@example.com'
    );
    expect(within(dialog).getByTestId('admin-logs-detail-target')).toHaveTextContent(
      'alice@example.com'
    );
    const metadata = within(dialog).getByTestId('admin-logs-detail-metadata');
    expect(metadata).toHaveTextContent('"from": "ACTIVE"');
    expect(metadata).toHaveTextContent('"to": "SUSPENDED"');
    expect(metadata).toHaveTextContent('"revokedSessions": 2');

    fireEvent.click(within(dialog).getByTestId('admin-logs-detail-close'));
    expect(screen.queryByTestId('admin-logs-detail')).toBeNull();
  });

  it('reports missing metadata instead of dumping raw objects', async () => {
    mockedList.mockResolvedValue(makeList([makeLog({ metadata: null })]));
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.click(desktopTable().getAllByTestId('admin-logs-view')[0]);
    const dialog = await screen.findByTestId('admin-logs-detail');
    expect(within(dialog).getByTestId('admin-logs-detail-metadata')).toHaveTextContent(
      'No metadata recorded'
    );
  });

  it('never displays sensitive fields', async () => {
    const rogue = {
      ...makeLog(),
      passwordHash: 'SHOULD_NOT_RENDER',
      refreshTokenHash: 'ALSO_SHOULD_NOT_RENDER',
    } as AdminAuditLogEntry;
    mockedList.mockResolvedValue(makeList([rogue]));
    renderPage();
    await screen.findByTestId('admin-logs-table');

    fireEvent.click(desktopTable().getAllByTestId('admin-logs-view')[0]);
    await screen.findByTestId('admin-logs-detail');

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('SHOULD_NOT_RENDER');
    expect(text).not.toContain('ALSO_SHOULD_NOT_RENDER');
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('refreshToken');
    expect(text).not.toContain('accessToken');
    expect(text).not.toContain('wh_refresh_token');
  });
});

describe('RequireAdmin access for /admin/audit-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderRoute(user: { id: string; role: string } | null) {
    authState.user = user;
    render(
      <MemoryRouter initialEntries={['/admin/audit-logs']}>
        <Routes>
          <Route
            path="/admin/audit-logs"
            element={
              <RequireAdmin>
                <div data-testid="audit-page">audit</div>
              </RequireAdmin>
            }
          />
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route
            path="/dashboard"
            element={<div data-testid="dashboard-page">dashboard</div>}
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it('redirects anonymous visitors to login', async () => {
    renderRoute(null);
    expect(await screen.findByTestId('login-page')).toBeDefined();
  });

  it('redirects a normal USER away', async () => {
    renderRoute({ id: 'u2', role: 'USER' });
    expect(await screen.findByTestId('dashboard-page')).toBeDefined();
    expect(screen.queryByTestId('audit-page')).toBeNull();
  });

  it('allows an ADMIN through', async () => {
    renderRoute({ id: 'u1', role: 'ADMIN' });
    expect(await screen.findByTestId('audit-page')).toBeDefined();
  });
});
