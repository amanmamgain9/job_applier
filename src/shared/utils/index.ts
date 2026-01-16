export * from './storage';
export * from './messaging';

// Generate unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Format relative time
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

// Format salary range
export function formatSalary(salary?: { min: number; max: number; currency: string }): string {
  if (!salary) return '';
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: salary.currency,
    maximumFractionDigits: 0,
  });
  
  if (salary.min === salary.max) {
    return formatter.format(salary.min);
  }
  
  return `${formatter.format(salary.min)} - ${formatter.format(salary.max)}`;
}

// Debounce function
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// Sleep utility
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Logger
export const logger = {
  info: (msg: string, data?: unknown) => {
    console.log(`[JobApplier] ${msg}`, data ?? '');
  },
  error: (msg: string, error?: unknown) => {
    console.error(`[JobApplier] ${msg}`, error ?? '');
  },
  debug: (msg: string, data?: unknown) => {
    if (import.meta.env.DEV) {
      console.debug(`[JobApplier] ${msg}`, data ?? '');
    }
  },
};

