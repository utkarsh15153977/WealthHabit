export function Loading() {
  return (
    <div className="page-container flex items-center justify-center min-h-[60vh]">
      <div
        className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
