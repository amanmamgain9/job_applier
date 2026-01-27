export function Loader() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 border-2 border-[var(--color-border)] rounded-full" />
        <div className="absolute inset-0 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">Loading jobs...</p>
    </div>
  );
}





