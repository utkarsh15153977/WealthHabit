import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppLayout, SIDEBAR_STORAGE_KEY } from './AppLayout';

const authState = vi.hoisted(() => ({
  user: {
    id: 'u1',
    firstName: 'Ada',
    lastName: 'Admin',
    email: 'admin@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
  } as { id: string; firstName: string; lastName: string; email: string; role: string; status: string } | null,
}));

vi.mock('../../context/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    isAuthenticated: authState.user !== null,
    isLoading: false,
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

vi.mock('../../services/notificationApi', () => ({
  notificationApi: {
    getNotifications: vi.fn(),
    getUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 0 }),
    generateNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
  },
}));

const ADMIN_USER = {
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Admin',
  email: 'admin@example.com',
  role: 'ADMIN',
  status: 'ACTIVE',
};

const REGULAR_USER = {
  id: 'u2',
  firstName: 'Bob',
  lastName: 'User',
  email: 'bob@example.com',
  role: 'USER',
  status: 'ACTIVE',
};

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

function renderLayout(options: { path?: string; content?: ReactNode } = {}) {
  const { path = '/dashboard', content } = options;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        {content ?? <h1>Page content</h1>}
      </AppLayout>
    </MemoryRouter>
  );
}

function menuButton() {
  return screen.getByTestId('sidebar-toggle');
}

beforeEach(() => {
  authState.user = ADMIN_USER;
  window.localStorage.clear();
  setViewportWidth(1024);
});

afterEach(() => {
  setViewportWidth(1024);
});

describe('AppLayout navigation', () => {
  it('renders the dashboard link in the main navigation', () => {
    renderLayout();

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const dashboard = within(nav).getByRole('link', { name: 'Dashboard' });
    expect(dashboard).toHaveAttribute('href', '/dashboard');
  });

  it('renders every primary navigation destination', () => {
    renderLayout();

    const expected: [string, string][] = [
      ['Dashboard', '/dashboard'],
      ['Transactions', '/transactions'],
      ['Budgets', '/budgets'],
      ['Recurring', '/recurring-transactions'],
      ['Bills', '/bills'],
      ['Subscriptions', '/subscriptions'],
      ['Habits', '/habits'],
      ['Challenges', '/challenges'],
      ['Goals', '/goals'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('renders the wealth navigation group', () => {
    renderLayout();

    expect(screen.getByText('Wealth')).toBeDefined();
    const expected: [string, string][] = [
      ['Assets & Liabilities', '/assets-liabilities'],
      ['Net Worth', '/net-worth'],
      ['Wealth Analytics', '/wealth-analytics'],
      ['Reports', '/reports'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('shows the admin navigation group for admin users', () => {
    renderLayout();

    const expected: [string, string][] = [
      ['Admin', '/admin'],
      ['Admin Users', '/admin/users'],
      ['Admin Challenges', '/admin/challenges'],
      ['Audit Logs', '/admin/audit-logs'],
      ['System Health', '/admin/system-health'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('hides the admin navigation group for regular users', () => {
    authState.user = REGULAR_USER;
    renderLayout();

    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Admin Users' })).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('marks the active route with aria-current', () => {
    renderLayout({ path: '/budgets' });

    expect(screen.getByRole('link', { name: 'Budgets' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Reports' })).not.toHaveAttribute('aria-current');
  });

  it('keeps every existing route destination reachable from the sidebar', () => {
    renderLayout();

    const expected: [string, string][] = [
      ['Dashboard', '/dashboard'],
      ['Transactions', '/transactions'],
      ['Budgets', '/budgets'],
      ['Recurring', '/recurring-transactions'],
      ['Bills', '/bills'],
      ['Subscriptions', '/subscriptions'],
      ['Habits', '/habits'],
      ['Challenges', '/challenges'],
      ['Goals', '/goals'],
      ['Assets & Liabilities', '/assets-liabilities'],
      ['Net Worth', '/net-worth'],
      ['Wealth Analytics', '/wealth-analytics'],
      ['Reports', '/reports'],
      ['Admin', '/admin'],
      ['Settings', '/profile'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('renders exactly one navigation landmark', () => {
    renderLayout();

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });
});

describe('AppLayout sidebar behavior', () => {
  it('opens and closes the sidebar from the menu button', () => {
    renderLayout();

    fireEvent.click(menuButton());
    expect(screen.getByTestId('app-sidebar').className).toContain('translate-x-0');
    expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument();

    fireEvent.click(menuButton());
    expect(screen.getByTestId('app-sidebar').className).toContain('-translate-x-full');
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
  });

  it('updates aria-expanded and aria-controls on the menu button', () => {
    renderLayout();

    const button = menuButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(button).toHaveAccessibleName('Open navigation menu');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('Close navigation menu');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAccessibleName('Open navigation menu');
  });

  it('closes the mobile drawer when the backdrop is clicked', () => {
    setViewportWidth(390);
    renderLayout();

    fireEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByTestId('sidebar-backdrop'));
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
  });

  it('closes the mobile drawer on Escape', () => {
    setViewportWidth(390);
    renderLayout();

    fireEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
  });

  it('closes the mobile drawer when a navigation item is clicked', () => {
    setViewportWidth(390);
    renderLayout();

    fireEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('link', { name: 'Transactions' }));
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
  });

  it('keeps the sidebar compact by default on desktop and shows collapsed tooltips', () => {
    renderLayout();

    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar.className).toContain('-translate-x-full');
    expect(sidebar.className).toContain('lg:translate-x-0');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('title', 'Dashboard');

    fireEvent.click(menuButton());
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('title');
  });
});

describe('AppLayout sidebar persistence', () => {
  it('persists the sidebar preference across renders', () => {
    renderLayout();

    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false');
    fireEvent.click(menuButton());
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
    fireEvent.click(menuButton());
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false');
  });

  it('restores a stored expanded sidebar on desktop', () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    renderLayout();

    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('ignores invalid stored sidebar values', () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'not-a-boolean');
    renderLayout();

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts closed on mobile even when a stored preference exists', () => {
    setViewportWidth(390);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    renderLayout();

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
  });
});

describe('AppLayout header and accessibility', () => {
  it('keeps the WealthHabit brand and account controls in the header', () => {
    renderLayout();

    expect(screen.getByRole('link', { name: 'WealthHabit' })).toBeInTheDocument();
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('uses semantic elements for the sidebar navigation', () => {
    renderLayout();

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('applies a short transition to the sidebar', () => {
    renderLayout();

    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar.className).toContain('transition-');
    expect(sidebar.className).toContain('duration-200');
  });

  it('respects prefers-reduced-motion in the global stylesheet', () => {
    const candidates = [
      path.resolve(process.cwd(), 'src', 'index.css'),
      path.resolve(process.cwd(), 'client', 'src', 'index.css'),
    ];
    const stylesheet = candidates.find((candidate) => existsSync(candidate)) ?? candidates[1];
    const css = readFileSync(stylesheet, 'utf8');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('transition-duration: 0.01ms !important');
  });
});
