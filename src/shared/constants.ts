// LinkedIn URL patterns
export const LINKEDIN_PATTERNS = {
  jobs: /linkedin\.com\/jobs/,
  jobView: /linkedin\.com\/jobs\/view\/(\d+)/,
  jobCollections: /linkedin\.com\/jobs\/collections/,
  messaging: /linkedin\.com\/messaging/,
} as const;

// Rate limiting
export const RATE_LIMITS = {
  minCaptureDelay: 1000,
  maxCaptureDelay: 5000,
  applicationDelay: 3000,
  retryDelay: 2000,
  maxRetries: 3,
} as const;

// Storage keys
export const STORAGE_KEYS = {
  jobs: 'jobs',
  settings: 'settings',
  profile: 'profile',
  lastSync: 'lastSync',
} as const;

// Job status labels
export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Review',
  approved: 'Ready to Apply',
  rejected: 'Skipped',
  applied: 'Applied',
  failed: 'Failed',
} as const;

// Location type labels
export const LOCATION_LABELS: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
} as const;







