import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '../services/authApi';
import { getApiErrorMessage } from '../services/error';

const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

/**
 * Client-side cooldown, mirroring the server-side per-account cooldown
 * (default 300s) so the user is not invited to press a button that is
 * guaranteed to be refused. The server remains the authority — this is
 * presentation only, and deliberately not a security control.
 */
const REQUEST_COOLDOWN_SECONDS = 300;

export function ForgotPassword() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [cooldownSeconds]);

  const onSubmit = async (data: ForgotPasswordForm) => {
    setServerError(null);
    setServerMessage(null);

    try {
      const result = await authApi.forgotPassword({ email: data.email });
      // The server answers with one generic message for every outcome. Showing
      // it verbatim — and showing it identically whether or not the account
      // exists — is what keeps this page from becoming an enumeration oracle in
      // the UI as well as in the API.
      setServerMessage(result.message);
      setSubmittedEmail(data.email.trim());
      setCooldownSeconds(REQUEST_COOLDOWN_SECONDS);
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  };

  const onTryAnother = () => {
    setSubmittedEmail(null);
    setServerMessage(null);
    setServerError(null);
    setCooldownSeconds(0);
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
          <h1 className="heading-2">Reset your password</h1>
        </div>

        <div className="card">
          <div className="card-body space-y-5">
            {serverMessage ? (
              <div className="text-center" data-testid="forgot-password-sent">
                <MailCheck className="w-10 h-10 mx-auto text-success" aria-hidden="true" />
                <p className="mt-4 text-text" role="status">
                  {serverMessage}
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  {submittedEmail
                    ? `If an account exists for ${submittedEmail}, an email is on its way.`
                    : 'If an account exists for that email address, an email is on its way.'}
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  The link works once and expires in 30 minutes. Check your spam folder if it
                  does not arrive.
                </p>
                <button
                  type="button"
                  onClick={onTryAnother}
                  className="btn-secondary w-full mt-6"
                  data-testid="forgot-password-try-another"
                >
                  Use a different email address
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-text-muted">
                  Enter the email address on your account and we will send you a link to choose a
                  new password.
                </p>

                {serverError && (
                  <div
                    className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                    data-testid="forgot-password-error"
                  >
                    {serverError}
                  </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="forgotEmail" className="label">
                      Email address
                    </label>
                    <input
                      id="forgotEmail"
                      type="email"
                      autoComplete="email"
                      className="input"
                      placeholder="you@example.com"
                      aria-invalid={errors.email ? 'true' : 'false'}
                      {...register('email')}
                    />
                    {errors.email && (
                      <p className="mt-1 text-sm text-error" role="alert">
                        {errors.email.message}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="btn-primary w-full"
                    disabled={isSubmitting || cooldownSeconds > 0}
                    data-testid="forgot-password-submit"
                  >
                    {cooldownSeconds > 0
                      ? `You can request another in ${cooldownSeconds}s`
                      : isSubmitting
                        ? 'Sending...'
                        : 'Send reset link'}
                  </button>
                </form>
              </>
            )}
          </div>
          <div className="card-footer flex flex-col gap-2 items-center">
            <p className="text-sm text-text-muted">
              Remembered it?{' '}
              <Link to="/login" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </p>
            <p className="flex items-center gap-1 text-xs text-text-muted">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              For your security, we never confirm whether an account exists.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}