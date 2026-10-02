import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { RequireAdmin } from '../components/RequireAdmin';
import { AdminUsers } from './AdminUsers';
import {
  getAdminUser,
  listAdminUsers,
  updateAdminUserRole,
  updateAdminUserStatus,
} from '../services/adminUsersApi';
import type {
  AdminUser,
  AdminUserDetailResponse,
  AdminUserListResponse,
} from '../types/adminUsers';

vi.mock('../services/adminUsersApi', () => ({
  listAdminUsers: vi.fn(),
  getAdminUser: vi.fn(),
  updateAdminUserStatus: vi.fn(),
  updateAdminUserRole: vi.fn(),
}));

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

const mockedList = vi.mocked(listAdminUsers);
const mockedDetail = vi.mocked(getAdminUser);
const mockedStatusChange = vi.mocked(updateAdminUserStatus);
const mockedRoleChange = vi.mocked(updateAdminUserRole);

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u1',
    email: 'admin@example.com',
    firstName: 'Ada',
    lastName: 'Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeList(
  users: AdminUser[],
  overrides: Partial<AdminUserListResponse> = {}
): AdminUserListResponse {
  return {
    users,
    page: 1,
    pageSize: 20,
    total: users.length,
    totalPages: 1,
    ...overrides,
  };
}

function makeDetail(
  user: AdminUser,
  counts: AdminUserDetailResponse['counts'] = {
    transactions: 12,
    goals: 3,
    assets: 2,
    liabilities: 1,
    habits: 4,
    challenges: 0,
  }
): AdminUserDetailResponse {
  return { user, counts };
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <AppLayout>
        <AdminUsers />
      </AppLayout>
    </MemoryRouter>
  );
}

const alice = makeUser({
  id: 'u2',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Anderson',
  role: 'USER',
  status: 'ACTIVE',
});

function desktopTable() {
  return within(screen.getByTestId('admin-users-table'));
}

function desktopRowEl(index: number): HTMLElement {
  return desktopTable().getAllByTestId('admin-user-row')[index];
}

function desktopRow(index: number) {
  return within(desktopRowEl(index));
}

describe('AdminUsers page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue(makeList([makeUser(), alice]));
    mockedDetail.mockResolvedValue(makeDetail(alice));
    mockedStatusChange.mockResolvedValue(
      makeDetail(makeUser({ ...alice, status: 'SUSPENDED' }))
    );
    mockedRoleChange.mockResolvedValue(
      makeDetail(makeUser({ ...alice, role: 'ADMIN' }))
    );
  });

  it('shows the loading state while fetching', async () => {
    mockedList.mockReturnValue(pending());
    renderPage();
    expect(await screen.findByTestId('admin-users-loading')).toHaveTextContent(
      'Loading users...'
    );
    expect(screen.queryByTestId('admin-users-table')).toBeNull();
  });

  it('renders the heading, navigation and user list', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'User Management' })
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Admin Users' })
    ).toHaveAttribute('href', '/admin/users');
    expect(screen.getByRole('link', { name: 'Admin Users' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    const table = await screen.findByTestId('admin-users-table');
    const rows = within(table).getAllByTestId('admin-user-row');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('Alice Anderson');
    expect(rows[1]).toHaveTextContent('alice@example.com');
    expect(rows[1]).toHaveTextContent('USER');
    expect(rows[1]).toHaveTextContent('ACTIVE');
  });

  it('supports pagination', async () => {
    mockedList.mockResolvedValue(
      makeList([makeUser(), alice], { page: 1, total: 60, totalPages: 3 })
    );
    renderPage();

    expect(await screen.findByTestId('admin-users-showing')).toHaveTextContent(
      'Showing 1–20 of 60'
    );
    expect(screen.getByTestId('admin-users-page-indicator')).toHaveTextContent(
      'Page 1 of 3'
    );
    expect(screen.getByTestId('admin-users-prev')).toBeDisabled();
    expect(screen.getByTestId('admin-users-next')).toBeEnabled();

    mockedList.mockResolvedValue(
      makeList([makeUser()], {
        page: 2,
        total: 60,
        totalPages: 3,
      })
    );
    fireEvent.click(screen.getByTestId('admin-users-next'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 })
      )
    );
    expect(await screen.findByTestId('admin-users-page-indicator')).toHaveTextContent(
      'Page 2 of 3'
    );
    expect(screen.getByTestId('admin-users-prev')).toBeEnabled();
  });

  it('debounces search input into the list query', async () => {
    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.change(screen.getByTestId('admin-users-search'), {
      target: { value: 'alice' },
    });

    await waitFor(
      () =>
        expect(mockedList).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'alice', page: 1 })
        ),
      { timeout: 2000 }
    );
  });

  it('applies role and status filters', async () => {
    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.change(screen.getByTestId('admin-users-role-filter'), {
      target: { value: 'ADMIN' },
    });
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'ADMIN', page: 1 })
      )
    );

    fireEvent.change(screen.getByTestId('admin-users-status-filter'), {
      target: { value: 'SUSPENDED' },
    });
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'SUSPENDED', page: 1 })
      )
    );

    fireEvent.click(screen.getByTestId('admin-users-clear-filters'));
    await waitFor(() => {
      const lastCall = mockedList.mock.calls.at(-1)?.[0];
      expect(lastCall?.role).toBeUndefined();
      expect(lastCall?.status).toBeUndefined();
      expect(lastCall?.search).toBeUndefined();
    });
    expect(screen.getByTestId('admin-users-role-filter')).toHaveValue('');
    expect(screen.getByTestId('admin-users-status-filter')).toHaveValue('');
  });

  it('shows an empty state when no users match', async () => {
    mockedList.mockResolvedValue(makeList([]));
    renderPage();

    const empty = await screen.findByTestId('admin-users-empty');
    expect(empty).toHaveTextContent('No users found');
    expect(screen.queryByTestId('admin-users-table')).toBeNull();
  });

  it('shows an error state and allows retry', async () => {
    mockedList
      .mockRejectedValueOnce(new Error('Failed to load users'))
      .mockResolvedValue(makeList([makeUser(), alice]));
    renderPage();

    const alert = await screen.findByTestId('admin-users-error');
    expect(alert).toHaveTextContent('Failed to load users');

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('admin-users-table')).toBeDefined();
    expect(screen.queryByTestId('admin-users-error')).toBeNull();
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it('opens the detail view with operational counts only', async () => {
    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.click(desktopRow(1).getByTestId('admin-user-view'));

    expect(await screen.findByTestId('admin-user-detail')).toBeDefined();
    expect(mockedDetail).toHaveBeenCalledWith('u2');
    expect(await screen.findByTestId('admin-user-detail-name')).toHaveTextContent(
      'Alice Anderson'
    );
    expect(screen.getByTestId('admin-user-detail-email')).toHaveTextContent(
      'alice@example.com'
    );
    expect(screen.getByTestId('admin-user-detail-id')).toHaveTextContent('u2');
    expect(screen.getByTestId('admin-user-count-transactions')).toHaveTextContent('12');
    expect(screen.getByTestId('admin-user-count-goals')).toHaveTextContent('3');
    expect(screen.getByTestId('admin-user-count-challenges')).toHaveTextContent('0');
    expect(
      screen.getByText('Operational record counts')
    ).toBeDefined();
    expect(screen.getByText(/no financial values are shown/i)).toBeDefined();

    fireEvent.click(screen.getByTestId('admin-user-detail-close'));
    await waitFor(() =>
      expect(screen.queryByTestId('admin-user-detail')).toBeNull()
    );
  });

  it('requires confirmation before suspending and shows mutation loading state', async () => {
    let resolveMutation: (value: AdminUserDetailResponse) => void = () => undefined;
    mockedStatusChange.mockReturnValue(
      new Promise((resolve) => {
        resolveMutation = resolve;
      })
    );

    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.click(desktopRow(1).getByTestId('admin-user-suspend'));

    const dialog = await screen.findByTestId('admin-user-confirm');
    expect(dialog).toHaveAttribute('role', 'alertdialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Suspend user?');
    expect(dialog).toHaveTextContent('alice@example.com');
    expect(mockedStatusChange).not.toHaveBeenCalled();

    const accept = within(dialog).getByTestId('admin-user-confirm-accept');
    fireEvent.click(accept);

    await waitFor(() => expect(accept).toBeDisabled());
    expect(accept).toHaveTextContent('Suspending...');
    expect(mockedStatusChange).toHaveBeenCalledWith('u2', 'SUSPENDED');

    resolveMutation(makeDetail(makeUser({ ...alice, status: 'SUSPENDED' })));

    expect(await screen.findByTestId('admin-users-success')).toHaveTextContent(
      'User suspended. All sessions were ended.'
    );
    await waitFor(() =>
      expect(screen.queryByTestId('admin-user-confirm')).toBeNull()
    );
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it('cancels confirmation without mutating', async () => {
    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.click(desktopRow(1).getByTestId('admin-user-deactivate'));
    const dialog = await screen.findByTestId('admin-user-confirm');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Deactivate user?');
    expect(dialog).toHaveTextContent('more consequential than suspension');

    fireEvent.click(within(dialog).getByTestId('admin-user-confirm-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('admin-user-confirm')).toBeNull()
    );
    expect(mockedStatusChange).not.toHaveBeenCalled();
  });

  it('shows a mutation error inside the confirmation dialog', async () => {
    mockedStatusChange.mockRejectedValue(new Error('Not allowed'));
    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.click(desktopRow(1).getByTestId('admin-user-suspend'));
    const dialog = await screen.findByTestId('admin-user-confirm');
    fireEvent.click(within(dialog).getByTestId('admin-user-confirm-accept'));

    const error = await screen.findByTestId('admin-user-confirm-error');
    expect(error).toHaveTextContent('Not allowed');
    expect(screen.getByTestId('admin-user-confirm')).toBeDefined();
    expect(mockedStatusChange).toHaveBeenCalledWith('u2', 'SUSPENDED');
  });

  it('reactivates a suspended user through a confirmation dialog', async () => {
    const suspendedAlice = makeUser({ ...alice, status: 'SUSPENDED' });
    mockedList.mockResolvedValue(makeList([makeUser(), suspendedAlice]));
    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.click(desktopRow(1).getByTestId('admin-user-activate'));
    const dialog = await screen.findByTestId('admin-user-confirm');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Reactivate user?');

    fireEvent.click(within(dialog).getByTestId('admin-user-confirm-accept'));

    await waitFor(() => expect(mockedStatusChange).toHaveBeenCalledWith('u2', 'ACTIVE'));
    expect(await screen.findByTestId('admin-users-success')).toHaveTextContent(
      'User reactivated.'
    );
  });

  it('supports role changes through a dedicated confirmation', async () => {
    renderPage();
    await screen.findByTestId('admin-users-table');

    fireEvent.click(desktopRow(1).getByTestId('admin-user-role'));
    const dialog = await screen.findByTestId('admin-user-confirm');
    expect(within(dialog).getByRole('heading')).toHaveTextContent(
      'Grant administrator access?'
    );

    fireEvent.click(within(dialog).getByTestId('admin-user-confirm-accept'));

    await waitFor(() => expect(mockedRoleChange).toHaveBeenCalledWith('u2', 'ADMIN'));
    expect(await screen.findByTestId('admin-users-success')).toHaveTextContent(
      'Administrator access granted.'
    );
  });

  it('protects the signed-in administrator from self service actions', async () => {
    renderPage();
    await screen.findByTestId('admin-users-table');

    const selfRow = desktopRow(0);
    expect(desktopRowEl(0)).toHaveTextContent('Ada Admin');

    const suspendSelf = selfRow.getByTestId('admin-user-suspend');
    expect(suspendSelf).toBeDisabled();
    expect(suspendSelf).toHaveAttribute(
      'title',
      'You cannot suspend or deactivate your own account'
    );

    const deactivateSelf = selfRow.getByTestId('admin-user-deactivate');
    expect(deactivateSelf).toBeDisabled();
    expect(deactivateSelf).toHaveAttribute(
      'title',
      'You cannot suspend or deactivate your own account'
    );

    const roleSelf = selfRow.getByTestId('admin-user-role');
    expect(roleSelf).toBeDisabled();
    expect(roleSelf).toHaveAttribute('title', 'You cannot change your own role');
    expect(roleSelf).toHaveTextContent('Remove admin');

    fireEvent.click(suspendSelf);
    expect(screen.queryByTestId('admin-user-confirm')).toBeNull();
    expect(mockedStatusChange).not.toHaveBeenCalled();

    const otherRow = desktopRow(1);
    expect(otherRow.getByTestId('admin-user-suspend')).toBeEnabled();
    expect(otherRow.getByTestId('admin-user-role')).toBeEnabled();
  });

  it('never renders credentials or financial amounts', async () => {
    renderPage();
    await screen.findByTestId('admin-users-table');

    const pageText = document.body.textContent ?? '';
    expect(pageText).not.toMatch(/password/i);
    expect(pageText).not.toMatch(/refreshToken/i);
    expect(pageText).not.toMatch(/\$\d/);
    expect(pageText).not.toMatch(/\d+\.\d{2}/);
  });
});

describe('RequireAdmin access for /admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderRoute(user: { id: string; role: string } | null) {
    authState.user = user;
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <div data-testid="admin-users-page">admin users</div>
              </RequireAdmin>
            }
          />
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
          <Route
            path="/dashboard"
            element={<div data-testid="user-dashboard-page">user dashboard</div>}
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it('redirects anonymous visitors to login', async () => {
    renderRoute(null);
    expect(await screen.findByTestId('login-page')).toBeDefined();
    expect(screen.queryByTestId('admin-users-page')).toBeNull();
  });

  it('redirects a normal USER away', async () => {
    renderRoute({ id: 'u2', role: 'USER' });
    expect(await screen.findByTestId('user-dashboard-page')).toBeDefined();
    expect(screen.queryByTestId('admin-users-page')).toBeNull();
  });

  it('allows an ADMIN through', async () => {
    renderRoute({ id: 'u1', role: 'ADMIN' });
    expect(await screen.findByTestId('admin-users-page')).toBeDefined();
  });
});
