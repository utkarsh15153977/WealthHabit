import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  PiggyBank,
  Receipt,
  RefreshCw,
  Repeat,
  Scale,
  Settings,
  Shield,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const primaryNavGroup: NavGroup = {
  id: 'primary',
  label: 'Primary',
  items: [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Transactions', href: '/transactions', icon: CreditCard },
    { label: 'Connections', href: '/financial-connections', icon: Building2 },
    { label: 'Budgets', href: '/budgets', icon: Target },
    { label: 'Recurring', href: '/recurring-transactions', icon: Repeat },
    { label: 'Bills', href: '/bills', icon: Receipt },
    { label: 'Subscriptions', href: '/subscriptions', icon: RefreshCw },
    { label: 'Habits', href: '/habits', icon: ListChecks },
    { label: 'Challenges', href: '/challenges', icon: Trophy },
    { label: 'Goals', href: '/goals', icon: PiggyBank },
  ],
};

export const wealthNavGroup: NavGroup = {
  id: 'wealth',
  label: 'Wealth',
  items: [
    { label: 'Assets & Liabilities', href: '/assets-liabilities', icon: Landmark },
    { label: 'Net Worth', href: '/net-worth', icon: Scale },
    { label: 'Wealth Analytics', href: '/wealth-analytics', icon: TrendingUp },
    { label: 'Reports', href: '/reports', icon: FileText },
  ],
};

export const adminNavGroup: NavGroup = {
  id: 'admin',
  label: 'Admin',
  items: [
    { label: 'Admin', href: '/admin', icon: Shield },
    { label: 'Admin Users', href: '/admin/users', icon: Users },
    { label: 'Admin Challenges', href: '/admin/challenges', icon: Trophy },
    { label: 'Audit Logs', href: '/admin/audit-logs', icon: FileText },
    { label: 'System Health', href: '/admin/system-health', icon: Activity },
  ],
};

export const accountNavGroup: NavGroup = {
  id: 'account',
  label: 'Account',
  items: [{ label: 'Settings', href: '/profile', icon: Settings }],
};

export function getNavGroups(isAdmin: boolean): NavGroup[] {
  return isAdmin
    ? [primaryNavGroup, wealthNavGroup, adminNavGroup, accountNavGroup]
    : [primaryNavGroup, wealthNavGroup, accountNavGroup];
}
