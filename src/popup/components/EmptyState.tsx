import { Inbox, CheckCircle, Send } from 'lucide-react';

interface EmptyStateProps {
  tab: string;
}

export function EmptyState({ tab }: EmptyStateProps) {
  const states = {
    queue: {
      icon: Inbox,
      title: 'No jobs in queue',
      description: 'Browse LinkedIn to capture job recommendations!',
    },
    approved: {
      icon: CheckCircle,
      title: 'No approved jobs',
      description: 'Approve jobs from your queue to apply in bulk',
    },
    applied: {
      icon: Send,
      title: 'No applications yet',
      description: "Jobs you've applied to will appear here",
    },
  };

  const state = states[tab as keyof typeof states] || states.queue;
  const Icon = state.icon;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-[var(--color-text-muted)]" />
      </div>
      <h3 className="font-semibold text-[var(--color-text)] mb-1">
        {state.title}
      </h3>
      <p className="text-sm text-[var(--color-text-muted)] max-w-[200px]">
        {state.description}
      </p>
    </div>
  );
}

