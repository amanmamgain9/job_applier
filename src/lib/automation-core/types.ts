/**
 * Shared types for the automation-core library
 */

// ============================================================================
// LLM Configuration
// ============================================================================

export type LLMProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'azure-openai';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string; // For proxies or local models
  temperature?: number;
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentOptions {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  maxErrorLength: number;
  useVision: boolean;
  includeAttributes: string[];
  maxHistoryMessages: number; // Sliding window: keep last N messages in history
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxSteps: 50,
  maxActionsPerStep: 5,
  maxFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: false,
  maxHistoryMessages: 20, // Keep ~10 steps worth of history (state + response pairs)
  includeAttributes: [
    'title',
    'type',
    'checked',
    'name',
    'role',
    'value',
    'placeholder',
    'data-date-format',
    'data-state',
    'alt',
    'aria-checked',
    'aria-label',
    'aria-expanded',
    'href',
  ],
};

// ============================================================================
// Execution Events
// ============================================================================

export type ExecutionEventType = 
  | 'step_start' | 'step_ok' | 'step_fail' 
  | 'action_start' | 'action_ok' | 'action_fail' 
  | 'task_start' | 'task_ok' | 'task_fail' | 'task_cancel'
  | 'llm_start' | 'llm_ok' | 'llm_fail';

export interface ExecutionEvent {
  type: ExecutionEventType;
  taskId: string;
  step?: number;
  maxSteps?: number;
  action?: string;
  details?: string;
  timestamp: number;
}

// ============================================================================
// Action Results
// ============================================================================

export interface ActionResultData {
  isDone?: boolean;
  success?: boolean;
  extractedContent?: string | null;
  error?: string | null;
  includeInMemory?: boolean;
  interactedElement?: unknown | null;
}

export class ActionResult {
  isDone: boolean;
  success: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  interactedElement: unknown | null;

  constructor(params: ActionResultData = {}) {
    this.isDone = params.isDone ?? false;
    this.success = params.success ?? false;
    this.interactedElement = params.interactedElement ?? null;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

// ============================================================================
// Task Results
// ============================================================================

export interface StepRecord {
  step: number;
  goal: string;
  actions: Array<{
    name: string;
    args: Record<string, unknown>;
    result: ActionResultData;
  }>;
  url: string;
  timestamp: number;
}

export interface TaskResult {
  success: boolean;
  error?: string;
  steps: StepRecord[];
  finalUrl: string;
  finalAnswer?: string;
  data?: unknown; // For extraction tasks
}

// ============================================================================
// Agent Output
// ============================================================================

export interface AgentOutput<T = unknown> {
  id: string;
  result?: T;
  error?: string;
}

// ============================================================================
// Step Info
// ============================================================================

export interface AgentStepInfo {
  stepNumber: number;
  maxSteps: number;
}

