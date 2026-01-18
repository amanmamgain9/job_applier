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
  report?: SessionReport;
}

export interface DiscoveryEvent {
  type: 'job_found' | 'step' | 'action' | 'llm' | 'error' | 'status_change';
  payload: {
    job?: Partial<Job>;
    step?: number;
    maxSteps?: number;
    status?: DiscoveryStatus;
    error?: string;
    details?: string;
    action?: string;
    actionStatus?: 'start' | 'ok' | 'fail';
    timestamp?: number;
  };
}

export type DiscoveryEventHandler = (event: DiscoveryEvent) => void;

// ============================================================================
// Session Reporting
// ============================================================================

export interface ActionLog {
  timestamp: number;
  action: string;
  details: string;
  status: 'start' | 'ok' | 'fail';
  error?: string;
}

export interface StepLog {
  step: number;
  timestamp: number;
  goal: string;
  actions: ActionLog[];
  url?: string;
  success: boolean;
  error?: string;
}

export interface SessionReport {
  id: string;
  startedAt: number;
  endedAt: number;
  duration: number;  // in milliseconds
  
  // Task info
  task: string;
  searchQuery: string;
  
  // Results
  success: boolean;
  stoppedReason: string;
  error?: string;
  
  // Stats
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  
  // Jobs
  jobsFound: number;
  jobsExtracted: Job[];
  
  // Detailed logs
  steps: StepLog[];
  
  // URLs visited
  urlsVisited: string[];
  finalUrl?: string;
}

