import { confidenceLabel, reasonLabel } from '../../utils/categorization';
import type { CategorizationPreview } from '../../types/financial';

interface CategorizationSuggestionProps {
  preview: CategorizationPreview | null;
  isLoading: boolean;
  error: string | null;
  onUseSuggestion?: () => void;
}

export function CategorizationSuggestion({
  preview,
  isLoading,
  error,
  onUseSuggestion,
}: CategorizationSuggestionProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-text-muted">
        Loading suggestion...
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-text-muted">
        <p className="font-medium text-text">No suggestion available</p>
        {error && <p className="mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary bg-primary-light/40 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
        Suggested category
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="badge badge-primary">{preview.category.name}</span>
        <span className="text-xs text-text-muted">{confidenceLabel(preview.confidence)}</span>
      </div>
      <p className="text-xs text-text-muted">{reasonLabel(preview.reason)}</p>
      {onUseSuggestion && (
        <button
          type="button"
          className="btn-secondary btn-sm mt-3"
          onClick={onUseSuggestion}
          aria-label={`Use suggested category ${preview.category.name}`}
        >
          Use suggestion
        </button>
      )}
    </div>
  );
}
