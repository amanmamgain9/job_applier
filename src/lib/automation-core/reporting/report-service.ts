/**
 * ReportService - Streams session reports in real-time
 * 
 * Inject this into automation components to capture:
 * - Steps and their status
 * - Actions within steps  
 * - Logs
 * - LLM responses
 * - Errors
 * 
 * Reports are streamed via callback, not batched at the end.
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('ReportService');

// ============================================================================
// Types
// ============================================================================

export interface ActionLog {
  timestamp: number;
  action: string;
  details?: string;
  status: 'start' | 'ok' | 'fail';
  error?: string;
  duration?: number;
}

export interface StepLog {
  step: number;
  timestamp: number;
  goal: string;
  actions: ActionLog[];
  success: boolean;
}

export interface SessionReport {
  id: string;
  startedAt: number;
  endedAt?: number;
  duration: number;
  task: string;
  sourceUrl: string;
  searchQuery?: string;
  success: boolean;
  error?: string;
  stoppedReason?: string;
  jobsFound: number;
  totalSteps: number;
  totalActions: number;
  steps: StepLog[];
  logs: string[];
  // Phase outputs for debugging
  phaseOutputs?: PhaseOutput[];
}

export interface PhaseOutput {
  phase: string;
  timestamp: number;
  duration: number;
  success: boolean;
  output?: string;
  error?: string;
}

export type ReportCallback = (report: SessionReport) => void;

// ============================================================================
// ReportService
// ============================================================================

export class ReportService {
  private report: SessionReport;
  private currentStep: StepLog | null = null;
  private currentActionStart: number = 0;
  private onUpdate: ReportCallback;

  constructor(options: {
    task: string;
    sourceUrl: string;
    searchQuery?: string;
    onUpdate: ReportCallback;
  }) {
    this.report = {
      id: `report_${Date.now()}`,
      startedAt: Date.now(),
      duration: 0,
      task: options.task,
      sourceUrl: options.sourceUrl,
      searchQuery: options.searchQuery,
      success: false,
      jobsFound: 0,
      totalSteps: 0,
      totalActions: 0,
      steps: [],
      logs: [],
      phaseOutputs: [],
    };
    this.onUpdate = options.onUpdate;
    
    // Stream initial report
    this.stream();
  }

  // ---- Logging ----
  
  log(message: string): void {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const logLine = `[${timestamp}] ${message}`;
    this.report.logs.push(logLine);
    logger.info(message);
    this.stream();
  }

  /** Log a pre-formatted message (no timestamp added) - used by logger sink */
  logRaw(message: string): void {
    this.report.logs.push(message);
    this.stream();
  }

  // ---- Steps ----
  
  startStep(goal: string): void {
    // Close previous step if open
    if (this.currentStep) {
      this.endStep(true);
    }
    
    this.report.totalSteps++;
    this.currentStep = {
      step: this.report.totalSteps,
      timestamp: Date.now(),
      goal,
      actions: [],
      success: false,
    };
    this.report.steps.push(this.currentStep);
    
    this.log(`Step ${this.currentStep.step}: ${goal}`);
    this.stream();
  }

  endStep(success: boolean, error?: string): void {
    if (this.currentStep) {
      this.currentStep.success = success;
      if (error) {
        this.log(`  Error: ${error}`);
      }
      this.currentStep = null;
      this.stream();
    }
  }

  // ---- Actions ----
  
  startAction(action: string, details?: string): void {
    this.currentActionStart = Date.now();
    this.report.totalActions++;
    
    const actionLog: ActionLog = {
      timestamp: this.currentActionStart,
      action,
      details,
      status: 'start',
    };
    
    if (this.currentStep) {
      this.currentStep.actions.push(actionLog);
    }
    
    this.log(`  → ${action}${details ? `: ${details}` : ''}`);
    this.stream();
  }

  endAction(success: boolean, error?: string): void {
    const duration = Date.now() - this.currentActionStart;
    
    if (this.currentStep && this.currentStep.actions.length > 0) {
      const lastAction = this.currentStep.actions[this.currentStep.actions.length - 1];
      lastAction.status = success ? 'ok' : 'fail';
      lastAction.duration = duration;
      if (error) {
        lastAction.error = error;
      }
    }
    
    if (error) {
      this.log(`  ✗ Failed: ${error}`);
    } else {
      this.log(`  ✓ Done (${duration}ms)`);
    }
    
    this.stream();
  }

  // ---- Phase Outputs (for LLM responses) ----
  
  addPhaseOutput(phase: string, output: string, success: boolean, duration: number, error?: string): void {
    this.report.phaseOutputs?.push({
      phase,
      timestamp: Date.now(),
      duration,
      success,
      output,
      error,
    });
    this.stream();
  }

  // ---- Jobs ----
  
  incrementJobsFound(count: number = 1): void {
    this.report.jobsFound += count;
    this.stream();
  }

  // ---- Finalization ----
  
  complete(success: boolean, error?: string, stoppedReason?: string): SessionReport {
    this.report.endedAt = Date.now();
    this.report.duration = this.report.endedAt - this.report.startedAt;
    this.report.success = success;
    this.report.error = error;
    this.report.stoppedReason = stoppedReason || (success ? 'complete' : 'error');
    
    // Close any open step
    if (this.currentStep) {
      this.endStep(success, error);
    }
    
    this.log(`Session ${success ? 'completed' : 'failed'} in ${this.report.duration}ms`);
    this.stream();
    
    return this.report;
  }

  // ---- Streaming ----
  
  private stream(): void {
    // Update duration
    this.report.duration = Date.now() - this.report.startedAt;
    
    // Call the callback with current report state
    try {
      this.onUpdate({ ...this.report });
    } catch (err) {
      logger.error('Failed to stream report update:', err);
    }
  }

  // ---- Getters ----
  
  getReport(): SessionReport {
    return { ...this.report };
  }
}

