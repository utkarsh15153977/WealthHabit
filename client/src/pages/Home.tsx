import { Link } from 'react-router-dom';
import { ArrowRight, Shield, TrendingUp, Target } from 'lucide-react';

export function Home() {
  return (
    <div className="page-container">
      <header className="border-b border-border bg-surface">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="currentColor"/>
              <path d="M8 16L14 22L24 10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span className="text-xl font-bold text-text">WealthHabit</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="btn-ghost">Sign In</Link>
            <Link to="/register" className="btn-primary">Get Started</Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="page-content py-20 text-center">
          <h1 className="heading-1 mb-6 max-w-3xl mx-auto">
            Build Better Financial Habits.<br />
            <span className="text-primary">Grow Your Wealth.</span>
          </h1>
          <p className="text-lg text-text-muted mb-10 max-w-2xl mx-auto">
            WealthHabit helps you track income and expenses, build saving habits, set financial goals,
            and watch your wealth grow — all in one place.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link to="/register" className="btn-primary btn-lg">
              Start Free
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <Link to="/login" className="btn-secondary btn-lg">Sign In</Link>
          </div>
        </section>

        <section className="page-content py-16 bg-surface border-y border-border">
          <h2 className="heading-2 text-center mb-12">Everything You Need</h2>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <div className="card p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-primary-light flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="heading-4 mb-2">Track Transactions</h3>
              <p className="text-text-muted">Log income and expenses with categories, tags, and notes.</p>
            </div>
            <div className="card p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-primary-light flex items-center justify-center">
                <Target className="w-6 h-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="heading-4 mb-2">Build Habits</h3>
              <p className="text-text-muted">Create financial habits and track streaks to stay motivated.</p>
            </div>
            <div className="card p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-primary-light flex items-center justify-center">
                <Shield className="w-6 h-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="heading-4 mb-2">Secure & Private</h3>
              <p className="text-text-muted">Your data is encrypted and never shared with third parties.</p>
            </div>
          </div>
        </section>

        <section className="page-content py-20 text-center">
          <h2 className="heading-2 mb-4">Ready to Start?</h2>
          <p className="text-text-muted mb-8">Join thousands of users building better financial futures.</p>
          <Link to="/register" className="btn-primary btn-lg">
            Create Free Account
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </section>
      </main>

      <footer className="border-t border-border bg-surface py-8">
        <div className="page-content text-center text-text-muted text-sm">
          © 2024 WealthHabit. Built for your financial growth.
        </div>
      </footer>
    </div>
  );
}