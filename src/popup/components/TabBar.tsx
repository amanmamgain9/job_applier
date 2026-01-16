import { cn } from '@/lib/utils';

type Tab = 'queue' | 'approved' | 'applied' | 'settings';

interface TabBarProps {
  activeTab: string;
  onTabChange: (tab: Tab) => void;
  counts: {
    queue: number;
    approved: number;
    applied: number;
  };
}

export function TabBar({ activeTab, onTabChange, counts }: TabBarProps) {
  const tabs = [
    { id: 'queue' as const, label: 'Queue', count: counts.queue },
    { id: 'approved' as const, label: 'Ready', count: counts.approved },
    { id: 'applied' as const, label: 'Applied', count: counts.applied },
  ];

  return (
    <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex-1 py-2.5 px-3 text-sm font-medium transition-all relative',
            activeTab === tab.id
              ? 'text-[var(--color-accent)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          )}
        >
          <span className="flex items-center justify-center gap-1.5">
            {tab.label}
            {tab.count > 0 && (
              <span
                className={cn(
                  'px-1.5 py-0.5 text-xs rounded-full font-semibold',
                  activeTab === tab.id
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-bg-card)] text-[var(--color-text-muted)]'
                )}
              >
                {tab.count}
              </span>
            )}
          </span>

          {/* Active indicator */}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[var(--color-accent)]" />
          )}
        </button>
      ))}
    </div>
  );
}
