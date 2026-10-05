import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, MailCheck, ShieldAlert } from 'lucide-react';
import { emailVerificationApi } from '../services/emailVerificationApi';
import { getApiErrorMessage } from '../services/error';

type VerificationState = 'missing-token' | 'verifying' | 'verified' | 'invalid';

/**
 * Client-side cooldown for the resend form. Mirrors the server-side per-account
 * cooldown so a user is not invited to press a button that is guaranteed to be
 * refused; the server remains the authority — this is presentation only.
 */
const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<VerificationState>(
    token ? 'verifying' : 'missing-token'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Guards against React 18 StrictMode double-invoking the effect and, more
  // importantly, against a re-render re-running the verification for a token
  // that has already been consumed.
  const attemptedTokenRef = useRef<string | null>(null);

  const verify = useCallback(async (candidate: string) => {
    if (attemptedTokenRef.current === candidate) {
      return;
    }
    attemptedTokenRef.current = candidate;

    setState('verifying');
    setErrorMessage(null);

    try {
      await emailVerificationApi.verifyEmail(candidate);
      setState('verified');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
      setState('invalid');
    }
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    void verify(token);
  }, [token, verify]);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [cooldownSeconds]);

  const onResend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResendError(null);
    setResendMessage(null);

    setIsResending(true);
    try {
      const result = await emailVerificationApi.resendVerification(email);
      setResendMessage(result.message);
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setResendError(getApiErrorMessage(error));
    } finally {
      setIsResending(false);
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
          <h1 className="heading-2">Verify your email</h1>
        </div>

        <div className="card">
          <div className="card-body space-y-5">
            {state === 'verifying' && (
              <div className="text-center" data-testid="verify-email-loading">
                <Loader2
                  className="w-10 h-10 mx-auto text-primary animate-spin"
                  aria-hidden="true"
                />
                <p className="mt-4 text-text-muted" role="status">
                  Verifying your email address...
                </p>
              </div>
            )}

            {state === 'verified' && (
              <div className="text-center" data-testid="verify-email-success">
                <CheckCircle2 className="w-10 h-10 mx-auto text-success" aria-hidden="true" />
                <p className="mt-4 font-medium text-text" role="status">
                  Email verified successfully.
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  Your email address is confirmed and your account is fully set up.
                </p>
                <Link to="/dashboard" className="btn-primary inline-block mt-5">
                  Go to Dashboard
                </Link>
              </div>
            )}

            {(state === 'invalid' || state === 'missing-token') && (
              <div data-testid="verify-email-fallback">
                <div className="text-center">
                  <ShieldAlert
                    className="w-10 h-10 mx-auto text-warning"
                    aria-hidden="true"
                  />
                  <p className="mt-4 font-medium text-text">
                    {state === 'invalid'
                      ? 'This verification link is invalid or has expired.'
                      : 'We sent a verification link to the email address you registered.'}
                  </p>
                  <p className="mt-2 text-sm text-text-muted">
                    {state === 'invalid'
                      ? 'Request a new link below to finish verifying your account.'
                      : 'Open it to confirm your account. The link works once and expires after 24 hours.'}
                  </p>
                </div>

                {errorMessage && (
                  <div
                    className="mt-5 rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                    data-testid="verify-email-error"
                  >
                    {errorMessage}
                  </div>
                )}

                <form
                  onSubmit={onResend}
                  className="mt-6 space-y-4"
                  noValidate
                  data-testid="resend-form"
                >
                  {resendMessage && (
                    <div
                      className="rounded-lg border border-primary bg-primary-light px-4 py-3 text-sm text-primary"
                      role="status"
                      data-testid="resend-success"
                    >
                      {resendMessage}
                    </div>
                  )}

                  {resendError && (
                    <div
                      className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                      role="alert"
                      data-testid="resend-error"
                    >
                      {resendError}
                    </div>
                  )}

                  <div>
                    <label htmlFor="resendEmail" className="label">
                      Email address
                    </label>
                    <input
                      id="resendEmail"
                      type="email"
                      autoComplete="email"
                      className="input"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-primary w-full"
                    disabled={isResending || cooldownSeconds > 0 || email.trim() === ''}
                  >
                    {cooldownSeconds > 0
                      ? `Resend available in ${cooldownSeconds}s`
                      : isResending
                        ? 'Sending...'
                        : 'Resend verification email'}
                  </button>
                </form>
              </div>
            )}
          </div>
          <div className="card-footer flex justify-center">
            <p className="text-sm text-text-muted">
              <MailCheck className="w-4 h-4 inline mr-1 align-text-bottom" aria-hidden="true" />
              Already verified?{' '}
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