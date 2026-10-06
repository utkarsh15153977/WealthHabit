import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '../services/authApi';
import { getApiErrorMessage } from '../services/error';
import { useAuth } from '../context/useAuth';

/**
 * The only rejection that means the link itself is bad. Everything else — a
 * network outage, a 5xx, even a rate limit — leaves the token potentially
 * usable, so the page must let the user retry rather than tell them the link
 * died.
 */
const INVALID_LINK_CODE = 'PASSWORD_RESET_INVALID';

// Mirrors the server's shared password policy (8–128 characters). The server is
// the authority; this only avoids a pointless round trip on an obvious mistake.
const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

type ResetState = 'form' | 'submitting' | 'success' | 'invalid';

/**
 * Reads the single-use token from the link. It is only ever sent to the backend
 * in a POST body — never as a query parameter on this API — so it does not
 * appear in this app's request log or any intermediary's.
 */
export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, refreshSession } = useAuth();
  const token = searchParams.get('token');

  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<ResetState>(token ? 'form' : 'invalid');
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Guards against a re-render resubmitting a token that has already been
  // consumed, which the server would (correctly) reject as invalid.
  const submittedTokenRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = useCallback(
    async (data: ResetPasswordForm) => {
      if (!token || submittedTokenRef.current === token) {
        return;
      }
      submittedTokenRef.current = token;

      setState('submitting');
      setServerError(null);
      setServerMessage(null);

      try {
        const result = await authApi.resetPassword({
          token,
          newPassword: data.newPassword,
        });
        setServerMessage(result.message);
        setState('success');

        // The backend has just revoked every session for this account, so any
        // session this tab is still holding is dead. Reuse the existing refresh
        // path to drop it: it fails against a revoked session and clears the
        // stored access token and user. Skipped when there is no session, to
        // avoid a pointless request on the common unauthenticated path.
        if (isAuthenticated) {
          await refreshSession();
        }
      } catch (error) {
        const message = getApiErrorMessage(error);
        const code = (error as {
          response?: { data?: { error?: { code?: string } } };
        })?.response?.data?.error?.code;

        setServerError(message);

        if (code === INVALID_LINK_CODE) {
          // The link is spent, expired or for another account: show the
          // dead-link fallback and do not let the user retry with it.
          submittedTokenRef.current = token;
          setState('invalid');
        } else {
          // Transient failure. The token is still valid server-side, so drop
          // the double-submit guard and let the user try again in place.
          submittedTokenRef.current = null;
          setState('form');
        }
      }
    },
    [isAuthenticated, refreshSession, token]
  );

  const goToLogin = () => {
    // Drop the now-meaningless token from the address bar on the way out.
    navigate('/login', { replace: true });
  };

  const goToForgotPassword = () => {
    navigate('/forgot-password', { replace: true });
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
          <h1 className="heading-2">Choose a new password</h1>
        </div>

        <div className="card">
          <div className="card-body space-y-5">
            {state === 'submitting' && (
              <div className="text-center" data-testid="reset-password-loading">
                <Loader2 className="w-10 h-10 mx-auto text-primary animate-spin" aria-hidden="true" />
                <p className="mt-4 text-text-muted" role="status">
                  Updating your password...
                </p>
              </div>
            )}

            {state === 'success' && (
              <div className="text-center" data-testid="reset-password-success">
                <CheckCircle2 className="w-10 h-10 mx-auto text-success" aria-hidden="true" />
                <p className="mt-4 font-medium text-text" role="status">
                  {serverMessage ?? 'Your password has been reset.'}
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  All other devices have been signed out. Sign in again with your new password.
                </p>
                <button
                  type="button"
                  onClick={goToLogin}
                  className="btn-primary w-full mt-6"
                  data-testid="reset-password-continue"
                >
                  Go to Sign in
                </button>
              </div>
            )}

            {state === 'invalid' && (
              <div data-testid="reset-password-fallback">
                <div className="text-center">
                  <ShieldAlert className="w-10 h-10 mx-auto text-warning" aria-hidden="true" />
                  <p className="mt-4 font-medium text-text">
                    This password reset link is invalid or has expired.
                  </p>
                  <p className="mt-2 text-sm text-text-muted">
                    Reset links can only be used once and expire after 30 minutes. Request a new
                    one to try again.
                  </p>
                </div>

                {serverError && (
                  <div
                    className="mt-5 rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                    data-testid="reset-password-error"
                  >
                    {serverError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={goToForgotPassword}
                  className="btn-primary w-full mt-6"
                  data-testid="reset-password-back"
                >
                  Request a new reset link
                </button>
              </div>
            )}

            {state === 'form' && (
              <>
                <p className="text-sm text-text-muted">
                  Your new password must be 8–128 characters. Signing in on every other device will
                  require the new password.
                </p>

                {serverError && (
                  <div
                    className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                    data-testid="reset-password-error"
                  >
                    {serverError}
                  </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="newPassword" className="label">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        id="newPassword"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="input pr-10"
                        aria-invalid={errors.newPassword ? 'true' : 'false'}
                        {...register('newPassword')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((shown) => !shown)}
                        className="absolute inset-y-0 right-0 pr-3 text-text-muted"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {errors.newPassword && (
                      <p className="mt-1 text-sm text-error" role="alert">
                        {errors.newPassword.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="confirmPassword" className="label">
                      Confirm new password
                    </label>
                    <input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      className="input"
                      aria-invalid={errors.confirmPassword ? 'true' : 'false'}
                      {...register('confirmPassword')}
                    />
                    {errors.confirmPassword && (
                      <p className="mt-1 text-sm text-error" role="alert">
                        {errors.confirmPassword.message}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="btn-primary w-full"
                    disabled={isSubmitting}
                    data-testid="reset-password-submit"
                  >
                    {isSubmitting ? 'Updating...' : 'Update password'}
                  </button>
                </form>
              </>
            )}
          </div>
          <div className="card-footer flex justify-center">
            <p className="flex items-center gap-1 text-sm text-text-muted">
              <KeyRound className="w-4 h-4 inline" aria-hidden="true" />
              Remembered it?{' '}
              <Link to="/login" className="text-primary hover:underline font-medium">
                Sign in instead
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}