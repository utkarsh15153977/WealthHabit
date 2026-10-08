import { createElement, lazy } from 'react';
import { RouteObject } from 'react-router-dom';
import { GuestRoute } from '../components/GuestRoute';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { RequireAdmin } from '../components/RequireAdmin';
import { WithSuspense } from '../components/WithSuspense';
import { AppLayout } from '../components/layout/AppLayout';

const Home = lazy(() => import('../pages/Home').then((m) => ({ default: m.Home })));
const Login = lazy(() => import('../pages/Login').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('../pages/Register').then((m) => ({ default: m.Register })));
const VerifyEmail = lazy(() =>
  import('../pages/VerifyEmail').then((m) => ({ default: m.VerifyEmail }))
);
const ForgotPassword = lazy(() =>
  import('../pages/ForgotPassword').then((m) => ({ default: m.ForgotPassword }))
);
const ResetPassword = lazy(() =>
  import('../pages/ResetPassword').then((m) => ({ default: m.ResetPassword }))
);
const Dashboard = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Profile = lazy(() => import('../pages/Profile').then((m) => ({ default: m.Profile })));
const Transactions = lazy(() =>
  import('../pages/Transactions').then((m) => ({ default: m.Transactions }))
);
const FinancialConnections = lazy(() =>
  import('../pages/FinancialConnections').then((m) => ({ default: m.FinancialConnections }))
);
const ImportedTransactions = lazy(() =>
  import('../pages/ImportedTransactions').then((m) => ({ default: m.ImportedTransactions }))
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
const Habits = lazy(() => import('../pages/Habits').then((m) => ({ default: m.Habits })));
const Challenges = lazy(() =>
  import('../pages/Challenges').then((m) => ({ default: m.Challenges }))
);
const Goals = lazy(() => import('../pages/Goals').then((m) => ({ default: m.Goals })));
const AssetsLiabilities = lazy(() =>
  import('../pages/AssetsLiabilities').then((m) => ({ default: m.AssetsLiabilities }))
);
const NetWorth = lazy(() =>
  import('../pages/NetWorth').then((m) => ({ default: m.NetWorth }))
);
const WealthAnalytics = lazy(() =>
  import('../pages/WealthAnalytics').then((m) => ({ default: m.WealthAnalytics }))
);
const Reports = lazy(() =>
  import('../pages/Reports').then((m) => ({ default: m.Reports }))
);
const AdminDashboard = lazy(() =>
  import('../pages/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const AdminUsers = lazy(() =>
  import('../pages/AdminUsers').then((m) => ({ default: m.AdminUsers }))
);
const AdminAuditLogs = lazy(() =>
  import('../pages/AdminAuditLogs').then((m) => ({ default: m.AdminAuditLogs }))
);

const AdminChallenges = lazy(() =>
  import('../pages/AdminChallenges').then((m) => ({ default: m.AdminChallenges }))
);

const AdminSystemHealth = lazy(() =>
  import('../pages/AdminSystemHealth').then((m) => ({ default: m.AdminSystemHealth }))
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
    path: '/verify-email',
    // Deliberately NOT wrapped in GuestRoute. Registration signs the new user in
    // and then sends them here, so GuestRoute would immediately bounce them back
    // to /dashboard and the confirmation step would never be seen. The page is
    // reachable with or without a session, because the token in the link is the
    // credential rather than the cookie.
    element: createElement(WithSuspense(VerifyEmail)),
  },
  {
    path: '/forgot-password',
    // Not GuestRoute-wrapped: a signed-in user who has forgotten their password
    // must be able to reach it too. It is a credential-recovery page, not a
    // guest-only page.
    element: createElement(WithSuspense(ForgotPassword)),
  },
  {
    path: '/reset-password',
    // Same reasoning as `/forgot-password`, and the link must also work in a tab
    // where a session exists but the server has revoked it: GuestRoute would
    // redirect that tab away from the form it needs to see.
    element: createElement(WithSuspense(ResetPassword)),
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Dashboard))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/profile',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Profile))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/transactions',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Transactions))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/financial-connections',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(FinancialConnections))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/transactions/imported',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(ImportedTransactions))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/budgets',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Budgets))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/recurring-transactions',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(RecurringTransactions))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/bills',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Bills))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/subscriptions',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Subscriptions))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/notifications',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Notifications))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/habits',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Habits))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/challenges',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Challenges))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/goals',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Goals))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/assets-liabilities',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(AssetsLiabilities))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/net-worth',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(NetWorth))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/wealth-analytics',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(WealthAnalytics))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/reports',
    element: (
      <ProtectedRoute>
        <AppLayout>{createElement(WithSuspense(Reports))}</AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin',
    element: (
      <RequireAdmin>
        <AppLayout>{createElement(WithSuspense(AdminDashboard))}</AppLayout>
      </RequireAdmin>
    ),
  },
  {
    path: '/admin/users',
    element: (
      <RequireAdmin>
        <AppLayout>{createElement(WithSuspense(AdminUsers))}</AppLayout>
      </RequireAdmin>
    ),
  },
  {
    path: '/admin/audit-logs',
    element: (
      <RequireAdmin>
        <AppLayout>{createElement(WithSuspense(AdminAuditLogs))}</AppLayout>
      </RequireAdmin>
    ),
  },
  {
    path: '/admin/challenges',
    element: (
      <RequireAdmin>
        <AppLayout>{createElement(WithSuspense(AdminChallenges))}</AppLayout>
      </RequireAdmin>
    ),
  },
  {
    path: '/admin/system-health',
    element: (
      <RequireAdmin>
        <AppLayout>{createElement(WithSuspense(AdminSystemHealth))}</AppLayout>
      </RequireAdmin>
    ),
  },
];

// Reachable without a session, but not exclusively: `/verify-email` is listed
// here because an anonymous visitor following the emailed link must get through,
// not because it is guest-only.
export const publicRoutes = [
  '/',
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
];
export const protectedRoutes = [
  '/dashboard',
  '/profile',
  '/transactions',
  '/financial-connections',
  '/transactions/imported',
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
];
