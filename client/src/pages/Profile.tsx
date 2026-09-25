import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CreditCard,
  LayoutDashboard,
  Settings,
    Target,
    Receipt,
    RefreshCw,
    Repeat,
    TrendingUp,
  User,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/useAuth';
import { getMyProfile, updateMyProfile } from '../services/userApi';
import { getApiErrorMessage } from '../services/error';
import { Loading } from '../components/Loading';
import type { UserProfile } from '../types/user';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(50, 'First name must be at most 50 characters'),
  lastName: z.string().trim().min(1, 'Last name is required').max(50, 'Last name must be at most 50 characters'),
  currency: z.string().trim().min(1, 'Currency is required').max(10, 'Currency must be at most 10 characters'),
  monthlyIncomeTarget: z
    .union([z.literal(''), z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount (max 2 decimal places)')])
    .optional(),
  monthlySavingsTarget: z
    .union([z.literal(''), z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount (max 2 decimal places)')])
    .optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

function parseTarget(value: string | undefined): number | null {
  if (value === undefined || value === null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFormValues(profile: UserProfile): ProfileForm {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    currency: profile.financialProfile.currency,
    monthlyIncomeTarget:
      profile.financialProfile.monthlyIncomeTarget === null
        ? ''
        : String(profile.financialProfile.monthlyIncomeTarget),
    monthlySavingsTarget:
      profile.financialProfile.monthlySavingsTarget === null
        ? ''
        : String(profile.financialProfile.monthlySavingsTarget),
  };
}

export function Profile() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoadingProfile(true);
      setLoadError(null);
      try {
        const result = await getMyProfile();
        if (cancelled) return;
        setProfile(result.profile);
        reset(toFormValues(result.profile));
      } catch (error) {
        if (cancelled) return;
        setLoadError(getApiErrorMessage(error));
      } finally {
        if (!cancelled) {
          setIsLoadingProfile(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reset]);

  const onSubmit = async (data: ProfileForm) => {
    setServerError(null);
    setSuccessMessage(null);

    try {
      const result = await updateMyProfile({
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        currency: data.currency.trim(),
        monthlyIncomeTarget: parseTarget(data.monthlyIncomeTarget),
        monthlySavingsTarget: parseTarget(data.monthlySavingsTarget),
      });

      setProfile(result.profile);
      reset(toFormValues(result.profile));
      setSuccessMessage('Profile updated successfully');

      if (user) {
        updateUser({
          ...user,
          firstName: result.profile.firstName,
          lastName: result.profile.lastName,
        });
      }
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Analytics', href: '/dashboard', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: true },
  ];

  if (isLoadingProfile) {
    return <Loading />;
  }

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
          </div>
        </div>
      </header>

      <main className="page-content max-w-2xl">
        <div className="mb-8">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text mb-4"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Dashboard
          </Link>
          <h1 className="heading-1 flex items-center gap-3">
            <Settings className="w-7 h-7 text-primary" aria-hidden="true" />
            Profile & Settings
          </h1>
          <p className="text-text-muted mt-1">
            Manage your personal information and financial preferences.
          </p>
        </div>

        <div className="card">
          <div className="card-body">
            {loadError && (
              <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6" role="alert">
                {loadError}
              </div>
            )}

            {!isLoadingProfile && profile && (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                {serverError && (
                  <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error" role="alert">
                    {serverError}
                  </div>
                )}
                {successMessage && (
                  <div className="rounded-lg border border-primary bg-primary-light px-4 py-3 text-sm text-primary" role="status">
                    {successMessage}
                  </div>
                )}

                <div className="flex items-center gap-3 p-4 rounded-lg bg-background border border-border">
                  <div className="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6 text-primary" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-text truncate">{profile.firstName} {profile.lastName}</p>
                    <p className="text-sm text-text-muted truncate">{profile.email}</p>
                  </div>
                  <span className="badge badge-primary ml-auto">{profile.role}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="label">First Name</label>
                    <input
                      id="firstName"
                      type="text"
                      autoComplete="given-name"
                      className={`input ${errors.firstName ? 'input-error' : ''}`}
                      {...register('firstName')}
                      aria-invalid={errors.firstName ? 'true' : 'false'}
                      aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                    />
                    {errors.firstName && (
                      <p id="firstName-error" className="mt-1.5 text-sm text-error" role="alert">
                        {errors.firstName.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="lastName" className="label">Last Name</label>
                    <input
                      id="lastName"
                      type="text"
                      autoComplete="family-name"
                      className={`input ${errors.lastName ? 'input-error' : ''}`}
                      {...register('lastName')}
                      aria-invalid={errors.lastName ? 'true' : 'false'}
                      aria-describedby={errors.lastName ? 'lastName-error' : undefined}
                    />
                    {errors.lastName && (
                      <p id="lastName-error" className="mt-1.5 text-sm text-error" role="alert">
                        {errors.lastName.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="border-t border-border pt-5">
                  <h2 className="heading-4 mb-1">Financial Preferences</h2>
                  <p className="text-sm text-text-muted mb-4">
                    Used later for budgets and savings goals.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="currency" className="label">Currency</label>
                      <input
                        id="currency"
                        type="text"
                        placeholder="USD"
                        className={`input ${errors.currency ? 'input-error' : ''}`}
                        {...register('currency')}
                        aria-invalid={errors.currency ? 'true' : 'false'}
                        aria-describedby={errors.currency ? 'currency-error' : undefined}
                      />
                      {errors.currency && (
                        <p id="currency-error" className="mt-1.5 text-sm text-error" role="alert">
                          {errors.currency.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="monthlyIncomeTarget" className="label">Monthly Income Target</label>
                      <input
                        id="monthlyIncomeTarget"
                        type="text"
                        inputMode="decimal"
                        placeholder="Optional"
                        className={`input ${errors.monthlyIncomeTarget ? 'input-error' : ''}`}
                        {...register('monthlyIncomeTarget')}
                        aria-invalid={errors.monthlyIncomeTarget ? 'true' : 'false'}
                        aria-describedby={errors.monthlyIncomeTarget ? 'monthlyIncomeTarget-error' : undefined}
                      />
                      {errors.monthlyIncomeTarget && (
                        <p id="monthlyIncomeTarget-error" className="mt-1.5 text-sm text-error" role="alert">
                          {errors.monthlyIncomeTarget.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="monthlySavingsTarget" className="label">Monthly Savings Target</label>
                      <input
                        id="monthlySavingsTarget"
                        type="text"
                        inputMode="decimal"
                        placeholder="Optional"
                        className={`input ${errors.monthlySavingsTarget ? 'input-error' : ''}`}
                        {...register('monthlySavingsTarget')}
                        aria-invalid={errors.monthlySavingsTarget ? 'true' : 'false'}
                        aria-describedby={errors.monthlySavingsTarget ? 'monthlySavingsTarget-error' : undefined}
                      />
                      {errors.monthlySavingsTarget && (
                        <p id="monthlySavingsTarget-error" className="mt-1.5 text-sm text-error" role="alert">
                          {errors.monthlySavingsTarget.message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="card mt-6">
          <div className="card-body">
            <h2 className="heading-4 mb-2">Account</h2>
            <p className="text-sm text-text-muted mb-4">
              Email, password, and account status cannot be changed from this page.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-secondary" disabled>
                Change Password (coming soon)
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
