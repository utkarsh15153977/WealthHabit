import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { QRCodeSVG } from 'qrcode.react';
import { authApi } from '../services/authApi';
import { getApiErrorMessage } from '../services/error';
import type { MfaSetupData, MfaStatusData } from '../types/auth';

const passwordSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

const codeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});

const confirmSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});

type PasswordForm = z.infer<typeof passwordSchema>;
type CodeForm = z.infer<typeof codeSchema>;
type ConfirmForm = z.infer<typeof confirmSchema>;

type Step =
  | 'idle'
  | 'password'
  | 'qr'
  | 'verify'
  | 'codes'
  | 'confirm';

type ConfirmAction = 'disable' | 'regenerate';

function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function TwoFactorSecurity() {
  const [status, setStatus] = useState<MfaStatusData | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<MfaSetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>('disable');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    register: registerPassword,
    handleSubmit: submitPassword,
    formState: passwordForm,
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const {
    register: registerCode,
    handleSubmit: submitCode,
    formState: codeForm,
  } = useForm<CodeForm>({
    resolver: zodResolver(codeSchema),
  });

  const {
    register: registerConfirm,
    handleSubmit: submitConfirm,
    formState: confirmForm,
  } = useForm<ConfirmForm>({
    resolver: zodResolver(confirmSchema),
  });

  const refreshStatus = async () => {
    setIsRefreshing(true);
    try {
      const result = await authApi.getMfaStatus();
      setStatus(result);
      setStatusError(null);
    } catch (err) {
      setStatusError(getApiErrorMessage(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await authApi.getMfaStatus();
        if (!cancelled) {
          setStatus(result);
        }
      } catch (err) {
        if (!cancelled) {
          setStatusError(getApiErrorMessage(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetWizard = () => {
    setStep('idle');
    setError(null);
    setSetup(null);
    setRecoveryCodes(null);
  };

  const onPasswordSubmit = async (data: PasswordForm) => {
    setError(null);
    try {
      const result = await authApi.setupMfa({ password: data.password });
      setSetup(result);
      setStep('qr');
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  const onCodeSubmit = async (data: CodeForm) => {
    if (!setup) return;
    setError(null);
    try {
      const result = await authApi.enableMfa({ code: data.code });
      setRecoveryCodes(result.recoveryCodes);
      setStep('codes');
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  const onConfirmSubmit = async (data: ConfirmForm) => {
    setError(null);
    try {
      if (confirmAction === 'disable') {
        await authApi.disableMfa({ password: data.password, code: data.code });
        await refreshStatus();
        resetWizard();
      } else {
        const result = await authApi.regenerateRecoveryCodes({
          password: data.password,
          code: data.code,
        });
        setRecoveryCodes(result.recoveryCodes);
        setStep('codes');
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  const onCodesDone = async () => {
    try {
      await refreshStatus();
    } finally {
      resetWizard();
    }
  };

  if (step === 'password') {
    return (
      <SecurityCard title="Turn on two-factor authentication" description="First, confirm it's really you.">
        <ErrorMessage message={error} />
        <form onSubmit={submitPassword(onPasswordSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="mfaPassword" className="label">Password</label>
            <input
              id="mfaPassword"
              type="password"
              autoComplete="current-password"
              className={`input ${passwordForm.errors.password ? 'input-error' : ''}`}
              {...registerPassword('password')}
              aria-invalid={passwordForm.errors.password ? 'true' : 'false'}
            />
            {passwordForm.errors.password && (
              <p className="mt-1.5 text-sm text-error" role="alert">
                {passwordForm.errors.password.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary" disabled={passwordForm.isSubmitting}>
              {passwordForm.isSubmitting ? 'Checking...' : 'Continue'}
            </button>
            <button type="button" className="btn-secondary" onClick={resetWizard}>
              Cancel
            </button>
          </div>
        </form>
      </SecurityCard>
    );
  }

  if (step === 'qr') {
    return (
      <SecurityCard title="Scan the QR code" description="Open your authenticator app and scan, then enter the 6-digit code on the next screen.">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {setup && <QRCodeSVG value={setup.otpauthUri} size={180} level="M" aria-label="Two-factor authentication QR code" />}
          <div className="min-w-0">
            <p className="text-sm text-text-muted">Manual entry key</p>
            <p className="font-mono text-sm break-all mt-1" data-testid="mfa-secret">
              {setup ? formatSecret(setup.secret) : ''}
            </p>
            <p className="text-xs text-text-muted mt-2">
              This setup expires in a few minutes, and the key is never shown again.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-5">
          <button type="button" className="btn-primary" onClick={() => setStep('verify')}>
            I've scanned the code
          </button>
          <button type="button" className="btn-secondary" onClick={resetWizard}>
            Cancel
          </button>
        </div>
      </SecurityCard>
    );
  }

  if (step === 'verify') {
    return (
      <SecurityCard title="Enter the authenticator code" description="Type the 6-digit code from your authenticator app to enable two-factor authentication.">
        <ErrorMessage message={error} />
        <form onSubmit={submitCode(onCodeSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="mfaCode" className="label">Authenticator code</label>
            <input
              id="mfaCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`input ${codeForm.errors.code ? 'input-error' : ''}`}
              placeholder="••••••"
              {...registerCode('code')}
              aria-invalid={codeForm.errors.code ? 'true' : 'false'}
            />
            {codeForm.errors.code && (
              <p className="mt-1.5 text-sm text-error" role="alert">
                {codeForm.errors.code.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary" disabled={codeForm.isSubmitting}>
              {codeForm.isSubmitting ? 'Enabling...' : 'Enable two-factor authentication'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setStep('qr')}>
              Back
            </button>
          </div>
        </form>
      </SecurityCard>
    );
  }

  if (step === 'codes') {
    return (
      <SecurityCard title="Save your recovery codes" description="These are shown once. Store them somewhere safe — each one grants full access to your account and can be used only a single time.">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="mfa-recovery-codes">
          {recoveryCodes?.map((code) => (
            <li key={code} className="font-mono text-sm rounded-lg border border-border bg-background px-3 py-2">
              {code}
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-2 rounded-lg border border-warning bg-yellow-50 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p>If you lose your authenticator app and have no recovery codes, you will be locked out of your account.</p>
        </div>
        <button type="button" className="btn-primary mt-5" onClick={onCodesDone} data-testid="mfa-codes-done">
          I've saved my recovery codes
        </button>
      </SecurityCard>
    );
  }

  if (step === 'confirm') {
    return (
      <SecurityCard
        title={confirmAction === 'disable' ? 'Turn off two-factor authentication' : 'Generate new recovery codes'}
        description={
          confirmAction === 'disable'
            ? 'Re-enter your password and a current authenticator code to confirm.'
            : 'Re-enter your password and a current authenticator code to mint a fresh set. Your old unused codes are retired immediately.'
        }
      >
        <ErrorMessage message={error} />
        <form onSubmit={submitConfirm(onConfirmSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="mfaConfirmPassword" className="label">Password</label>
            <input
              id="mfaConfirmPassword"
              type="password"
              autoComplete="current-password"
              className={`input ${confirmForm.errors.password ? 'input-error' : ''}`}
              {...registerConfirm('password')}
              aria-invalid={confirmForm.errors.password ? 'true' : 'false'}
            />
            {confirmForm.errors.password && (
              <p className="mt-1.5 text-sm text-error" role="alert">
                {confirmForm.errors.password.message}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="mfaConfirmCode" className="label">Authenticator code</label>
            <input
              id="mfaConfirmCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`input ${confirmForm.errors.code ? 'input-error' : ''}`}
              placeholder="••••••"
              {...registerConfirm('code')}
              aria-invalid={confirmForm.errors.code ? 'true' : 'false'}
            />
            {confirmForm.errors.code && (
              <p className="mt-1.5 text-sm text-error" role="alert">
                {confirmForm.errors.code.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-primary" disabled={confirmForm.isSubmitting}>
              {confirmForm.isSubmitting ? 'Confirming...' : 'Confirm'}
            </button>
            <button type="button" className="btn-secondary" onClick={resetWizard}>
              Cancel
            </button>
          </div>
        </form>
      </SecurityCard>
    );
  }

  const enabled = status?.twoFactorEnabled === true;
  const pendingSetup = status?.setupPending === true;

  return (
    <SecurityCard
      title="Two-factor authentication"
      description="Add an extra layer of security. When it's on, signing in requires a code from your authenticator app or a recovery code."
    >
      {statusError && <ErrorMessage message={statusError} />}
      {status === null && !statusError && (
        <p className="text-sm text-text-muted" data-testid="mfa-status-loading">
          {isRefreshing ? 'Checking current state...' : 'Loading...'}
        </p>
      )}
      {status !== null && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {enabled ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-success" aria-hidden="true" />
                <span className="text-sm font-medium text-text" data-testid="mfa-status-enabled">
                  Two-factor authentication is enabled
                </span>
              </>
            ) : (
              <>
                <ShieldOff className="w-4 h-4 text-text-muted" aria-hidden="true" />
                <span className="text-sm font-medium text-text" data-testid="mfa-status-disabled">
                  Two-factor authentication is not enabled
                </span>
              </>
            )}
            {pendingSetup && (
              <span className="badge badge-info" data-testid="mfa-status-pending">
                Setup in progress
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {enabled ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setConfirmAction('disable');
                    setStep('confirm');
                  }}
                  data-testid="mfa-disable"
                >
                  Turn off two-factor authentication
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setConfirmAction('regenerate');
                    setStep('confirm');
                  }}
                  data-testid="mfa-regenerate-codes"
                >
                  <KeyRound className="w-4 h-4 mr-1 inline" aria-hidden="true" />
                  Generate new recovery codes
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setStep('password');
                  setError(null);
                }}
                data-testid="mfa-setup"
              >
                <ShieldCheck className="w-4 h-4 mr-1 inline" aria-hidden="true" />
                {pendingSetup ? 'Continue setting up' : 'Turn on two-factor authentication'}
              </button>
            )}
          </div>
        </div>
      )}
    </SecurityCard>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error" role="alert">
      {message}
    </div>
  );
}

function SecurityCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="card mt-6">
      <div className="card-body">
        <h2 className="heading-4 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
          {title}
        </h2>
        <p className="text-sm text-text-muted mt-1 mb-4">{description}</p>
        {children}
      </div>
    </div>
  );
}