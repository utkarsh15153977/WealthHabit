import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/useAuth';
import { getApiErrorMessage } from '../services/error';

const registerSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, 'First name is required')
      .max(50, 'First name must be at most 50 characters'),
    lastName: z
      .string()
      .trim()
      .min(1, 'Last name is required')
      .max(50, 'Last name must be at most 50 characters'),
    email: z.string().trim().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterForm = z.infer<typeof registerSchema>;

export function Register() {
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterForm) => {
    setServerError(null);
    try {
      await registerUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
      });
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  };

  return (
    <div className="page-container flex items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <svg className="w-10 h-10 text-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="currentColor"/>
              <path d="M8 16L14 22L24 10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span className="text-2xl font-bold text-text">WealthHabit</span>
          </Link>
          <h1 className="heading-2">Create Account</h1>
          <p className="text-text-muted mt-2">Start building better financial habits today</p>
        </div>

        <div className="card">
          <div className="card-body">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {serverError && (
                <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error" role="alert">
                  {serverError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="label">First Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" aria-hidden="true" />
                    <input
                      id="firstName"
                      type="text"
                      autoComplete="given-name"
                      className={`input pl-10 ${errors.firstName ? 'input-error' : ''}`}
                      placeholder="John"
                      {...register('firstName')}
                      aria-invalid={errors.firstName ? 'true' : 'false'}
                      aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                    />
                  </div>
                  {errors.firstName && (
                    <p id="firstName-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.firstName.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="lastName" className="label">Last Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" aria-hidden="true" />
                    <input
                      id="lastName"
                      type="text"
                      autoComplete="family-name"
                      className={`input pl-10 ${errors.lastName ? 'input-error' : ''}`}
                      placeholder="Doe"
                      {...register('lastName')}
                      aria-invalid={errors.lastName ? 'true' : 'false'}
                      aria-describedby={errors.lastName ? 'lastName-error' : undefined}
                    />
                  </div>
                  {errors.lastName && (
                    <p id="lastName-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.lastName.message}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="email" className="label">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" aria-hidden="true" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    className={`input pl-10 ${errors.email ? 'input-error' : ''}`}
                    placeholder="you@example.com"
                    {...register('email')}
                    aria-invalid={errors.email ? 'true' : 'false'}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                  />
                </div>
                {errors.email && (
                  <p id="email-error" className="mt-1.5 text-sm text-error" role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" aria-hidden="true" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className={`input pl-10 pr-10 ${errors.password ? 'input-error' : ''}`}
                    placeholder="••••••••"
                    {...register('password')}
                    aria-invalid={errors.password ? 'true' : 'false'}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {errors.password && (
                  <p id="password-error" className="mt-1.5 text-sm text-error" role="alert">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="label">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" aria-hidden="true" />
                  <input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className={`input pl-10 pr-10 ${errors.confirmPassword ? 'input-error' : ''}`}
                    placeholder="••••••••"
                    {...register('confirmPassword')}
                    aria-invalid={errors.confirmPassword ? 'true' : 'false'}
                    aria-describedby={errors.confirmPassword ? 'confirm-error' : undefined}
                  />
                </div>
                {errors.confirmPassword && (
                  <p id="confirm-error" className="mt-1.5 text-sm text-error" role="alert">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          </div>
          <div className="card-footer flex justify-center">
            <p className="text-sm text-text-muted">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
