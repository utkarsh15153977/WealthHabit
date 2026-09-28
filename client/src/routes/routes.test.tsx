import { describe, it, expect } from 'vitest';
import { routes, publicRoutes, protectedRoutes } from './index';

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
