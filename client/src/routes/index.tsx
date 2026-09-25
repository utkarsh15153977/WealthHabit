import { createElement, lazy } from 'react';
import { RouteObject } from 'react-router-dom';
import { GuestRoute } from '../components/GuestRoute';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { WithSuspense } from '../components/WithSuspense';

const Home = lazy(() => import('../pages/Home').then((m) => ({ default: m.Home })));
const Login = lazy(() => import('../pages/Login').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('../pages/Register').then((m) => ({ default: m.Register })));
const Dashboard = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Profile = lazy(() => import('../pages/Profile').then((m) => ({ default: m.Profile })));
const Transactions = lazy(() =>
  import('../pages/Transactions').then((m) => ({ default: m.Transactions }))
);
const Budgets = lazy(() => import('../pages/Budgets').then((m) => ({ default: m.Budgets })));
const RecurringTransactions = lazy(() =>
  import('../pages/RecurringTransactions').then((m) => ({ default: m.RecurringTransactions }))
);
const Bills = lazy(() => import('../pages/Bills').then((m) => ({ default: m.Bills })));
const Subscriptions = lazy(() =>
  import('../pages/Subscriptions').then((m) => ({ default: m.Subscriptions }))
);
const Notifications = lazy(() =>
  import('../pages/Notifications').then((m) => ({ default: m.Notifications }))
);

export const routes: RouteObject[] = [
  {
    path: '/',
    element: createElement(WithSuspense(Home)),
  },
  {
    path: '/login',
    element: (
      <GuestRoute>
        {createElement(WithSuspense(Login))}
      </GuestRoute>
    ),
  },
  {
    path: '/register',
    element: (
      <GuestRoute>
        {createElement(WithSuspense(Register))}
      </GuestRoute>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(Dashboard))}
      </ProtectedRoute>
    ),
  },
  {
    path: '/profile',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(Profile))}
      </ProtectedRoute>
    ),
  },
  {
    path: '/transactions',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(Transactions))}
      </ProtectedRoute>
    ),
  },
  {
    path: '/budgets',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(Budgets))}
      </ProtectedRoute>
    ),
  },
  {
    path: '/recurring-transactions',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(RecurringTransactions))}
      </ProtectedRoute>
    ),
  },
  {
    path: '/bills',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(Bills))}
      </ProtectedRoute>
    ),
  },
  {
    path: '/subscriptions',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(Subscriptions))}
      </ProtectedRoute>
    ),
  },
  {
    path: '/notifications',
    element: (
      <ProtectedRoute>
        {createElement(WithSuspense(Notifications))}
      </ProtectedRoute>
    ),
  },
];

export const publicRoutes = ['/', '/login', '/register'];
export const protectedRoutes = [
  '/dashboard',
  '/profile',
  '/transactions',
  '/budgets',
  '/recurring-transactions',
  '/bills',
  '/subscriptions',
  '/notifications',
];
