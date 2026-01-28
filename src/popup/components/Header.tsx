import { RefreshCw, Briefcase } from 'lucide-react';

interface HeaderProps {
  onRefresh: () => void;
}

export function Header({ onRefresh }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-purple-500 flex items-center justify-center shadow-lg shadow-[var(--color-accent-glow)]">
          <Briefcase className="w-4 h-4 text-white" />
        </div>
        <h1 className="text-lg font-bold tracking-tight">
          Job<span className="text-[var(--color-accent)]">Applier</span>
        </h1>
      </div>
      
      <button
        onClick={onRefresh}
        className="p-2 rounded-lg hover:bg-[var(--color-bg-card)] transition-colors group"
        aria-label="Refresh jobs"
      >
        <RefreshCw className="w-4 h-4 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
      </button>
    </header>
  );
}







