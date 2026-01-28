import type { Job, JobStatus } from './job';
import type { SessionReport } from '@/lib/automation-core';

export type MessageType =
  | 'CAPTURE_JOB'
  | 'JOB_CAPTURED'
  | 'APPLY_TO_JOB'
  | 'APPLICATION_RESULT'
  | 'GET_JOBS'
  | 'UPDATE_JOB_STATUS'
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'SCRAPE_CURRENT_PAGE'
  | 'JOBS_UPDATED'
  // Discovery messages
  | 'START_DISCOVERY'
  | 'STOP_DISCOVERY'
  | 'DISCOVERY_STATE'
  | 'DISCOVERY_JOB_FOUND'
  | 'GET_SESSION_REPORT'
  | 'REPORT_UPDATE'
  // Dev tools
  | 'TEST_STRATEGY_PLANNER';

export interface BaseMessage<T extends MessageType, P = unknown> {
  type: T;
  payload: P;
  timestamp: number;
}

export type CaptureJobMessage = BaseMessage<'CAPTURE_JOB', Job>;
export type JobCapturedMessage = BaseMessage<'JOB_CAPTURED', { jobId: string }>;
export type ApplyToJobMessage = BaseMessage<'APPLY_TO_JOB', { jobId: string }>;
export type ApplicationResultMessage = BaseMessage<'APPLICATION_RESULT', {
  jobId: string;
  success: boolean;
  error?: string;
}>;
export type GetJobsMessage = BaseMessage<'GET_JOBS', undefined>;
export type UpdateJobStatusMessage = BaseMessage<'UPDATE_JOB_STATUS', {
  jobId: string;
  status: JobStatus;
}>;
export type JobsUpdatedMessage = BaseMessage<'JOBS_UPDATED', { jobs: Job[] }>;
export type ScrapeCurrentPageMessage = BaseMessage<'SCRAPE_CURRENT_PAGE', undefined>;

// Discovery messages
export type DiscoveryStatus = 'idle' | 'running' | 'paused' | 'error' | 'captcha' | 'login_required';

export interface DiscoveryStatePayload {
  status: DiscoveryStatus;
  jobsFound: number;
  currentStep: number;
  maxSteps: number;
  error?: string;
}

export interface StartDiscoveryPayload {
  url: string;
  task?: string;
  goals?: string[];
  maxJobs?: number;
}

export type StartDiscoveryMessage = BaseMessage<'START_DISCOVERY', StartDiscoveryPayload>;
export type StopDiscoveryMessage = BaseMessage<'STOP_DISCOVERY', undefined>;
export type DiscoveryStateMessage = BaseMessage<'DISCOVERY_STATE', DiscoveryStatePayload>;
export type DiscoveryJobFoundMessage = BaseMessage<'DISCOVERY_JOB_FOUND', Job>;
export type GetSessionReportMessage = BaseMessage<'GET_SESSION_REPORT', undefined>;
export type ReportUpdateMessage = BaseMessage<'REPORT_UPDATE', SessionReport>;

// Dev tools
export interface TestStrategyPlannerPayload {
  task?: string;
}
export type TestStrategyPlannerMessage = BaseMessage<'TEST_STRATEGY_PLANNER', TestStrategyPlannerPayload>;

export type ExtensionMessage =
  | CaptureJobMessage
  | JobCapturedMessage
  | ApplyToJobMessage
  | ApplicationResultMessage
  | GetJobsMessage
  | UpdateJobStatusMessage
  | JobsUpdatedMessage
  | ScrapeCurrentPageMessage
  | StartDiscoveryMessage
  | StopDiscoveryMessage
  | DiscoveryStateMessage
  | DiscoveryJobFoundMessage
  | GetSessionReportMessage
  | ReportUpdateMessage
  | TestStrategyPlannerMessage;

export function createMessage<T extends MessageType, P>(
  type: T,
  payload: P
): BaseMessage<T, P> {
  return {
    type,
    payload,
    timestamp: Date.now(),
  };
}

