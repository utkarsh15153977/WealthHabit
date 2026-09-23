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
];

export const publicRoutes = ['/', '/login', '/register'];
export const protectedRoutes = ['/dashboard', '/profile'];
