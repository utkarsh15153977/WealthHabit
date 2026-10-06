import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/useAuth';
import { getApiErrorMessage } from '../services/error';
import type { MfaChallengeData } from '../types/auth';

const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginForm = z.infer<typeof loginSchema>;

interface LocationState {
  from?: {
    pathname?: string;
    search?: string;
  };
}

function useRedirectTo(): string {
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from;
  return from?.pathname ? `${from.pathname}${from.search ?? ''}` : '/dashboard';
}

function LoginHeader() {
  return (
    <div className="text-center mb-8">
      <Link to="/" className="inline-flex items-center gap-2 mb-6">
        <svg className="w-10 h-10 text-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="currentColor"/>
          <path d="M8 16L14 22L24 10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span className="text-2xl font-bold text-text">WealthHabit</span>
      </Link>
      <h1 className="heading-2">Welcome Back</h1>
      <p className="text-text-muted mt-2">Sign in to continue to your dashboard</p>
    </div>
  );
}

export function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<MfaChallengeData | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const redirectTo = useRedirectTo();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setServerError(null);
    try {
      const result = await login(data);
      if (result.requiresTwoFactor) {
        setChallenge(result);
        return;
      }
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  };

  if (challenge) {
    return (
      <div className="page-container flex items-center justify-center py-12">
        <div className="w-full max-w-md">
          <LoginHeader />
          <TwoFactorStep
            challenge={challenge}
            onUseDifferentAccount={() => {
              setChallenge(null);
              setServerError(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container flex items-center justify-center py-12">
      <div className="w-full max-w-md">
        <LoginHeader />

        <div className="card">
          <div className="card-body">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {serverError && (
                <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error" role="alert">
                  {serverError}
                </div>
              )}

              <div>
                <label htmlFor="email" className="label">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" aria-hidden="true" />
                  <input
                    id="email"
                    type="email"
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

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="rounded border-border text-primary focus:ring-primary" />
                  <span className="text-sm text-text-muted">Remember me</span>
                </label>
                <Link to="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
              </div>

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
          <div className="card-footer flex justify-center">
            <p className="text-sm text-text-muted">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

type TwoFactorMode = 'authenticator' | 'recovery';

interface TwoFactorValues {
  code: string;
}

const AUTHENTICATOR_HINT = 'Enter the 6-digit code from your authenticator app';

const authenticatorSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, AUTHENTICATOR_HINT),
});

const recoverySchema = z.object({
  code: z
    .string()
    .trim()
    .min(12, 'Enter one of your recovery codes')
    .max(64, 'This recovery code is invalid'),
});

function TwoFactorStep({
  challenge,
  onUseDifferentAccount,
}: {
  challenge: MfaChallengeData;
  onUseDifferentAccount: () => void;
}) {
  const [mode, setMode] = useState<TwoFactorMode>('authenticator');
  const [serverError, setServerError] = useState<string | null>(null);
  const { completeTwoFactorChallenge, completeTwoFactorRecovery } = useAuth();
  const navigate = useNavigate();
  const redirectTo = useRedirectTo();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorValues>({
    resolver: useMemo(
      () => zodResolver(mode === 'authenticator' ? authenticatorSchema : recoverySchema),
      [mode]
    ),
  });

  const onSubmit = async (values: TwoFactorValues) => {
    setServerError(null);
    try {
      if (mode === 'authenticator') {
        await completeTwoFactorChallenge({
          challengeToken: challenge.challengeToken,
          code: values.code.trim(),
        });
      } else {
        await completeTwoFactorRecovery({
          challengeToken: challenge.challengeToken,
          recoveryCode: values.code.trim(),
        });
      }
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  };

  const fieldId = mode === 'authenticator' ? 'authenticatorCode' : 'recoveryCode';

  return (
    <div className="card">
      <div className="card-body">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-8 h-8 text-primary mt-1 flex-shrink-0" aria-hidden="true" />
            <div>
              <h2 className="heading-4">
                {mode === 'authenticator' ? 'Two-factor verification' : 'Use a recovery code'}
              </h2>
              <p className="text-sm text-text-muted mt-1">
                {mode === 'authenticator'
                  ? `Enter the 6-digit code shown in your authenticator app. The challenge expires in ${challenge.expiresInSeconds} seconds.`
                  : 'Enter one of your single-use recovery codes. Each code works exactly once.'}
              </p>
            </div>
          </div>

          {serverError && (
            <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error" role="alert">
              {serverError}
            </div>
          )}

          <div>
            <label htmlFor={fieldId} className="label">
              {mode === 'authenticator' ? 'Authenticator code' : 'Recovery code'}
            </label>
            <div className="relative">
              <input
                id={fieldId}
                type="text"
                autoComplete="one-time-code"
                inputMode={mode === 'authenticator' ? 'numeric' : 'text'}
                className={`input pl-10 ${errors.code ? 'input-error' : ''}`}
                placeholder={mode === 'authenticator' ? '••••••' : 'XXXX-XXXX-XXXX'}
                {...register('code')}
                aria-invalid={errors.code ? 'true' : 'false'}
                aria-describedby={errors.code ? 'twoFactor-code-error' : undefined}
              />
              <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" aria-hidden="true" />
            </div>
            {errors.code && (
              <p id="twoFactor-code-error" className="mt-1.5 text-sm text-error" role="alert">
                {errors.code.message}
              </p>
            )}
          </div>

          {mode === 'authenticator' ? (
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => {
                setMode('recovery');
                setServerError(null);
              }}
            >
              Use a recovery code instead
            </button>
          ) : (
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => {
                setMode('authenticator');
                setServerError(null);
              }}
            >
              Use the authenticator app instead
            </button>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Verifying...' : 'Verify'}
          </button>
        </form>
      </div>
      <div className="card-footer flex flex-col gap-2 items-center">
        <button
          type="button"
          className="text-sm text-text-muted hover:text-text underline"
          onClick={onUseDifferentAccount}
        >
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}