/**
 * Types for automation and job discovery
 */

import type { Job } from '@shared/types/job';
import type { ExtractedPreferences } from '@/components/onboarding/types';

export type DiscoveryStatus = 'idle' | 'running' | 'paused' | 'error' | 'captcha' | 'login_required';

export interface DiscoveryState {
  status: DiscoveryStatus;
  jobsFound: number;
  currentStep: number;
  maxSteps: number;
  error?: string;
  startedAt?: number;
}

export interface DiscoveryOptions {
  maxJobs: number;
  preferences: ExtractedPreferences;
  searchQuery?: string;  // Override preferences with explicit query
}

export interface DiscoveryResult {
  success: boolean;
  jobs: Job[];
  error?: string;
  stoppedReason?: 'complete' | 'max_jobs' | 'user_stopped' | 'error' | 'captcha' | 'login';
}

export interface DiscoveryEvent {
  type: 'job_found' | 'step' | 'error' | 'status_change';
  payload: {
    job?: Partial<Job>;
    step?: number;
    maxSteps?: number;
    status?: DiscoveryStatus;
    error?: string;
    details?: string;
  };
}

export type DiscoveryEventHandler = (event: DiscoveryEvent) => void;

