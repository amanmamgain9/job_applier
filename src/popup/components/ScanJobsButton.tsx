import { Search, Square, AlertCircle, LogIn, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDiscovery } from '../hooks/useDiscovery';

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

  const handleClick = () => {
    if (isRunning) {
      stopDiscovery();
    } else {
      startDiscovery();
    }
  };

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
          subtext: 'Search LinkedIn based on your preferences',
          className: cn(
            'bg-gradient-to-r from-[var(--color-accent)] to-indigo-500',
            'hover:from-indigo-500 hover:to-[var(--color-accent)]',
            'text-white shadow-lg shadow-[var(--color-accent-glow)]'
          ),
        };
    }
  };

  const { icon, text, subtext, className } = getStatusUI();
  const isDisabled = status === 'captcha' || status === 'login_required';

  return (
    <div>
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
