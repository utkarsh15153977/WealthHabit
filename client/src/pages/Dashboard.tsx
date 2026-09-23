import { Link } from 'react-router-dom';
import { LogOut, LayoutDashboard, CreditCard, Target, TrendingUp, Settings } from 'lucide-react';
import { useAuth } from '../context/useAuth';

export function Dashboard() {
  const { user, logout } = useAuth();

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: true },
    { name: 'Transactions', href: '#', icon: CreditCard, current: false },
    { name: 'Budgets', href: '#', icon: Target, current: false },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  return (
    <div className="page-container">
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="currentColor"/>
              <path d="M8 16L14 22L24 10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span className="text-xl font-bold text-text">WealthHabit</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  item.current
                    ? 'bg-primary-light text-primary'
                    : 'text-text-muted hover:bg-background hover:text-text'
                }`}
                aria-current={item.current ? 'page' : undefined}
              >
                <item.icon className="w-4 h-4 inline mr-2" aria-hidden="true" />
                {item.name}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-text-muted">
              {user ? `${user.firstName} ${user.lastName}` : ''}
            </span>
            <button
              type="button"
              className="btn-ghost p-2"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="page-content">
        <div className="mb-8">
          <h1 className="heading-1">Dashboard</h1>
          <p className="text-text-muted mt-1">
            Welcome back{user ? `, ${user.firstName}` : ''}! Here's an overview of your financial health.
          </p>
        </div>

        <div className="card">
          <div className="card-body text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
              <TrendingUp className="w-8 h-8 text-primary" aria-hidden="true" />
            </div>
            <h2 className="heading-2 mb-3">WealthHabit Dashboard</h2>
            <p className="text-text-muted mb-8 max-w-md mx-auto">
              This is a placeholder dashboard. Business features like transactions, budgets, habits,
              goals, and wealth analytics will be implemented in future milestones.
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-light text-primary text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              Coming Soon
            </div>
          </div>
        </div>

        <div className="mt-8 grid md:grid-cols-3 gap-6">
          <div className="card">
            <div className="card-body">
              <h3 className="heading-4 mb-4">Planned Features</h3>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-text-muted">
                  <CreditCard className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Transactions & Categories</span>
                </li>
                <li className="flex items-center gap-3 text-text-muted">
                  <Target className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Budgets & Spending Limits</span>
                </li>
                <li className="flex items-center gap-3 text-text-muted">
                  <TrendingUp className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Wealth Analytics & Net Worth</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="card">
            <div className="card-body">
              <h3 className="heading-4 mb-4">Habits & Goals</h3>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-text-muted">
                  <Target className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Financial Habits & Streaks</span>
                </li>
                <li className="flex items-center gap-3 text-text-muted">
                  <TrendingUp className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Savings Goals</span>
                </li>
                <li className="flex items-center gap-3 text-text-muted">
                  <CreditCard className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Bills & Subscriptions</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="card">
            <div className="card-body">
              <h3 className="heading-4 mb-4">Reports & More</h3>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-text-muted">
                  <LayoutDashboard className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Financial Reports</span>
                </li>
                <li className="flex items-center gap-3 text-text-muted">
                  <Settings className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Notifications & Settings</span>
                </li>
                <li className="flex items-center gap-3 text-text-muted">
                  <TrendingUp className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
                  <span>Admin Panel</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}