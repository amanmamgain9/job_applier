import { useState } from 'react';
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
  
  const [inputUrl, setInputUrl] = useState('');

  const handleClick = async () => {
    if (isRunning) {
      stopDiscovery();
    } else {
      // Use input URL or get current tab URL
      let url = inputUrl.trim();
      
      if (!url) {
        // Try to get current tab URL
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && (tab.url.includes('/jobs') || tab.url.includes('indeed.com'))) {
          url = tab.url;
        }
      }
      
      if (!url) {
        alert('Please enter a job search URL or navigate to a job search page');
        return;
      }
      
      startDiscovery({ url });
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
          subtext: 'Enter URL or use current tab',
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
    <div className="space-y-2">
      {/* URL Input */}
      {!isRunning && status === 'idle' && (
        <input
          type="url"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          placeholder="https://linkedin.com/jobs/search?..."
          className={cn(
            'w-full px-3 py-2 rounded-lg text-sm',
            'bg-[var(--color-bg-card)] border border-[var(--color-border)]',
            'text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50'
          )}
        />
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
