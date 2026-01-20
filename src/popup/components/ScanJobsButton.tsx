import { useState } from 'react';
import { Search, Square, AlertCircle, LogIn, ShieldAlert, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDiscovery } from '../hooks/useDiscovery';

// Predefined job search URLs to scan
const JOB_SEARCH_URLS = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=Remote',
  },
  {
    id: 'wellfound',
    name: 'Wellfound',
    url: 'https://wellfound.com/jobs',
  },
];

interface StatusUI {
  icon: React.ReactNode;
  text: string;
  subtext: string;
  className: string;
}

export function ScanJobsButton() {
  const {
    status,
    isRunning,
    jobsFound,
    currentStep,
    maxSteps,
    error,
    startDiscovery,
    stopDiscovery,
  } = useDiscovery();
  
  // All URLs selected by default
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(JOB_SEARCH_URLS.map(item => item.id))
  );

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClick = async () => {
    if (isRunning) {
      stopDiscovery();
    } else {
      // Get first selected URL for now (TODO: support multiple in sequence)
      const selectedUrl = JOB_SEARCH_URLS.find(item => selectedIds.has(item.id));
      if (selectedUrl) {
        startDiscovery({ url: selectedUrl.url });
      }
    }
  };
  
  const selectedCount = selectedIds.size;

  const getStatusUI = (): StatusUI => {
    switch (status) {
      case 'running':
        return {
          icon: <Square className="w-4 h-4" />,
          text: `Scanning... (${jobsFound} found)`,
          subtext: `Step ${currentStep}/${maxSteps}`,
          className: 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30',
        };

      case 'captcha':
        return {
          icon: <ShieldAlert className="w-4 h-4" />,
          text: 'CAPTCHA Detected',
          subtext: 'Please solve it in the browser',
          className: 'bg-red-500/20 text-red-400 border-red-500/30',
        };

      case 'login_required':
        return {
          icon: <LogIn className="w-4 h-4" />,
          text: 'Login Required',
          subtext: 'Please log in to LinkedIn',
          className: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
        };

      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          text: 'Scan Failed',
          subtext: error || 'Unknown error',
          className: 'bg-red-500/20 text-red-400 border-red-500/30',
        };

      default:
        return {
          icon: <Search className="w-4 h-4" />,
          text: 'Scan Jobs',
          subtext: `${selectedCount} source${selectedCount !== 1 ? 's' : ''} selected`,
          className: cn(
            'bg-gradient-to-r from-[var(--color-accent)] to-indigo-500',
            'hover:from-indigo-500 hover:to-[var(--color-accent)]',
            'text-white shadow-lg shadow-[var(--color-accent-glow)]'
          ),
        };
    }
  };

  const { icon, text, subtext, className } = getStatusUI();
  const isDisabled = status === 'captcha' || status === 'login_required' || selectedCount === 0;

  return (
    <div className="space-y-3">
      {/* Source Checklist */}
      {!isRunning && status === 'idle' && (
        <div className="space-y-1">
          {JOB_SEARCH_URLS.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleSelection(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                  'transition-colors duration-150',
                  'bg-[var(--color-bg-card)] border',
                  isSelected
                    ? 'border-[var(--color-accent)]/50 text-[var(--color-text)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 rounded flex items-center justify-center',
                    'border transition-colors duration-150',
                    isSelected
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                      : 'border-[var(--color-border)]'
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
                <span>{item.name}</span>
              </button>
            );
          })}
        </div>
      )}
      
      <button
        onClick={handleClick}
        disabled={isDisabled}
        className={cn(
          'w-full py-3 px-4 rounded-xl font-semibold',
          'flex items-center justify-center gap-2',
          'transition-all duration-300 border',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
      >
        <span className={cn(isRunning && 'animate-pulse')}>{icon}</span>
        <div className="flex flex-col items-start">
          <span className="text-sm">{text}</span>
          {subtext && (
            <span className="text-xs opacity-70 font-normal">{subtext}</span>
          )}
        </div>
      </button>

      {/* Progress bar for running state */}
      {isRunning && (
        <div className="mt-2 h-1 bg-[var(--color-bg-card)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--color-accent)] to-indigo-500 transition-all duration-300"
            style={{ width: `${(currentStep / maxSteps) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
