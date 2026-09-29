import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { routes, publicRoutes, protectedRoutes } from './index';
import { RequireAdmin } from '../components/RequireAdmin';
import { AppLayout } from '../components/layout/AppLayout';

const ADMIN_PATHS = [
  '/admin',
  '/admin/users',
  '/admin/audit-logs',
  '/admin/challenges',
  '/admin/system-health',
];

function adminRouteElement(path: string): ReactElement | undefined {
  return routes.find((route) => route.path === path)?.element as
    | ReactElement
    | undefined;
}

describe('application routes', () => {
  it('keeps the existing route paths unchanged', () => {
    const paths = routes.map((route) => route.path);

    expect(paths).toEqual([
      '/',
      '/login',
      '/register',
      '/dashboard',
      '/profile',
      '/transactions',
      '/budgets',
      '/recurring-transactions',
      '/bills',
      '/subscriptions',
      '/notifications',
      '/habits',
      '/challenges',
      '/goals',
      '/assets-liabilities',
      '/net-worth',
      '/wealth-analytics',
      '/reports',
      '/admin',
      '/admin/users',
      '/admin/audit-logs',
      '/admin/challenges',
      '/admin/system-health',
    ]);
  });

  it('keeps the public and protected route lists', () => {
    expect(publicRoutes).toEqual(['/', '/login', '/register']);
    expect(protectedRoutes).toEqual([
      '/dashboard',
      '/profile',
      '/transactions',
      '/budgets',
      '/recurring-transactions',
      '/bills',
      '/subscriptions',
      '/notifications',
      '/habits',
      '/challenges',
      '/goals',
      '/assets-liabilities',
      '/net-worth',
      '/wealth-analytics',
      '/reports',
      '/admin',
      '/admin/users',
      '/admin/audit-logs',
      '/admin/challenges',
      '/admin/system-health',
    ]);
  });
});

describe('admin route protection', () => {
  it('registers exactly the five admin destinations', () => {
    const adminPaths = routes
      .map((route) => route.path)
      .filter((path): path is string => typeof path === 'string' && path.startsWith('/admin'))
      .sort();

    expect(adminPaths).toEqual([...ADMIN_PATHS].sort());
  });

  it('guards every admin route with RequireAdmin', () => {
    for (const path of ADMIN_PATHS) {
      const element = adminRouteElement(path);
      expect(element, `${path} route is missing`).toBeDefined();
      expect(element?.type, `${path} is not wrapped in RequireAdmin`).toBe(
        RequireAdmin
      );
    }
  });

  it('renders every admin route inside the shared AppLayout', () => {
    for (const path of ADMIN_PATHS) {
      const child = adminRouteElement(path)?.props?.children as
        | ReactElement
        | undefined;
      expect(child?.type, `${path} does not use AppLayout`).toBe(AppLayout);
    }
  });
});
