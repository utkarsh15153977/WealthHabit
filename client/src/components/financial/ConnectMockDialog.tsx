import { Landmark, X } from 'lucide-react';

interface ConnectMockDialogProps {
  isConnecting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConnectMockDialog({
  isConnecting,
  error,
  onCancel,
  onConfirm,
}: ConnectMockDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isConnecting && onCancel()} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-mock-title"
        aria-describedby="connect-mock-description"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center flex-shrink-0">
            <Landmark className="w-5 h-5 text-primary" aria-hidden="true" />
          </div>
          <h2 id="connect-mock-title" className="heading-3">
            Connect Mock Financial Account
          </h2>
          <button
            type="button"
            className="btn-ghost p-2 ml-auto"
            aria-label="Close dialog"
            onClick={onCancel}
            disabled={isConnecting}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <p id="connect-mock-description" className="text-sm text-text-muted mb-2">
          This development connection uses simulated financial data.
        </p>
        <p className="text-sm text-text-muted mb-6">
          No bank credentials, UPI PIN, OTP, CVV, or password are required.
        </p>

        <span className="badge badge-info">Development / Mock</span>

        {error && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mt-4"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-6">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={isConnecting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
