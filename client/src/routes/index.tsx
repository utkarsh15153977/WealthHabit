import { createElement, lazy, Suspense } from 'react';
import { RouteObject } from 'react-router-dom';

const Home = lazy(() => import('../pages/Home').then((m) => ({ default: m.Home })));
const Login = lazy(() => import('../pages/Login').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('../pages/Register').then((m) => ({ default: m.Register })));
const Dashboard = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.Dashboard })));

const Loading = () => (
  <div className="page-container flex items-center justify-center min-h-[60vh]">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
  </div>
);

const WithSuspense = (Component: React.ComponentType) => () => (
  <Suspense fallback={createElement(Loading)}>
    <Component />
  </Suspense>
);

export const routes: RouteObject[] = [
  {
    path: '/',
    element: createElement(WithSuspense(Home)),
  },
  {
    path: '/login',
    element: createElement(WithSuspense(Login)),
  },
  {
    path: '/register',
    element: createElement(WithSuspense(Register)),
  },
  {
    path: '/dashboard',
    element: createElement(WithSuspense(Dashboard)),
  },
];

export const publicRoutes = ['/', '/login', '/register'];
export const protectedRoutes = ['/dashboard'];