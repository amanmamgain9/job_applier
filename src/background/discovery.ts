/// <reference types="vite/client" />
/**
 * Job Discovery
 * 
 * Everything about finding jobs on LinkedIn:
 * - Building search queries from preferences
 * - Creating LLM task prompts
 * - Parsing job results
 * - Session tracking and reporting
 * - Agent lifecycle management
 */

import type { Job } from '@shared/types/job';
import type { ExtractedPreferences } from '@/components/onboarding/types';
import { AutomationAgent, BrowserContext } from '@/lib/automation-core';
import type { TaskResult, ExecutionEvent, LLMConfig, LLMProvider } from '@/lib/automation-core';

// ============================================================================
// Types
// ============================================================================

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
  searchQuery?: string;
}

export interface DiscoveryResult {
  success: boolean;
  jobs: Job[];
  error?: string;
  stoppedReason?: 'complete' | 'max_jobs' | 'user_stopped' | 'error' | 'captcha' | 'login';
  report?: SessionReport;
}

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
  duration: number;
  task: string;
  searchQuery: string;
  success: boolean;
  stoppedReason: string;
  error?: string;
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  jobsFound: number;
  jobsExtracted: Job[];
  steps: StepLog[];
  urlsVisited: string[];
  finalUrl?: string;
}

// Parsed job data from LLM response
interface ParsedJobData {
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  jobType?: string;
  experienceLevel?: string;
  description?: string;
  postedTime?: string;
  easyApply?: boolean;
  linkedinJobId?: string;
}

// ============================================================================
// State
// ============================================================================

// Discovery state
let discoveryState: DiscoveryState = {
  status: 'idle',
  jobsFound: 0,
  currentStep: 0,
  maxSteps: 50,
};

const stateListeners: Set<(state: DiscoveryState) => void> = new Set();
const jobListeners: Set<(job: Job) => void> = new Set();

// Agent state
let agent: AutomationAgent | null = null;
let browserContext: BrowserContext | null = null;

// Session reporting state
let currentReport: SessionReport | null = null;
let currentStepLog: StepLog | null = null;
let urlsVisited: Set<string> = new Set();
const sessionReports: SessionReport[] = [];

// ============================================================================
// LLM Configuration
// ============================================================================

function getLLMConfig(): LLMConfig {
  const provider = (import.meta.env.VITE_LLM_PROVIDER as LLMProvider) || 'anthropic';
  const apiKey = import.meta.env.VITE_LLM_API_KEY || import.meta.env.VITE_ANTHROPIC_API_KEY || '';
  const model = import.meta.env.VITE_LLM_MODEL || 'claude-sonnet-4-20250514';
  const baseUrl = import.meta.env.VITE_LLM_BASE_URL;

  if (!apiKey) {
    throw new Error('LLM API key not configured. Set VITE_LLM_API_KEY or VITE_ANTHROPIC_API_KEY in .env');
  }

  return {
    provider,
    apiKey,
    model,
    ...(baseUrl && { baseUrl }),
    temperature: 0.1,
  };
}

export function hasLLMConfig(): boolean {
  try {
    getLLMConfig();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Agent Lifecycle
// ============================================================================

async function initAgent(): Promise<void> {
  console.log('[Agent] Initializing...');
  await cleanupAgent();

  const llmConfig = getLLMConfig();
  console.log('[Agent] LLM:', llmConfig.provider, llmConfig.model);

  // Create new tab for automation
  const newTab = await chrome.tabs.create({ 
    url: 'about:blank',
    active: true
  });
  
  if (!newTab.id) {
    throw new Error('Failed to create new tab');
  }
  
  console.log('[Agent] New tab created:', newTab.id);
  browserContext = await BrowserContext.fromTab(newTab.id);

  agent = new AutomationAgent({
    context: browserContext,
    llm: llmConfig,
    options: {
      maxSteps: 50,
      maxActionsPerStep: 5,
      maxFailures: 3,
      useVision: false,
    },
  });
  console.log('[Agent] Ready');
}

async function executeTask(task: string): Promise<TaskResult> {
  if (!agent) {
    throw new Error('Agent not initialized');
  }
  return agent.execute(task);
}

async function stopAgent(): Promise<void> {
  if (agent) {
    await agent.stop();
  }
}

async function cleanupAgent(): Promise<void> {
  if (agent) {
    await agent.cleanup();
    agent = null;
  }
  if (browserContext) {
    await browserContext.cleanup();
    browserContext = null;
  }
}

// ============================================================================
// Search Query Building
// ============================================================================

function buildSearchQuery(preferences: ExtractedPreferences): string {
  const parts: string[] = [];

  if (preferences.roles?.length) {
    parts.push(preferences.roles.slice(0, 3).join(' OR '));
  }

  if (preferences.locations?.length) {
    const remote = preferences.locations.find((l) => l.type === 'remote');
    if (remote) {
      parts.push('remote');
    } else {
      const locations = preferences.locations
        .filter((l) => l.location)
        .map((l) => l.location)
        .slice(0, 2);
      if (locations.length) {
        parts.push(locations.join(' OR '));
      }
    }
  }

  return parts.join(' ') || 'software engineer';
}

// ============================================================================
// Task Prompt Building
// ============================================================================

function buildDiscoveryTask(searchQuery: string, maxJobs: number): string {
  const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchQuery)}`;
  
  return `
TASK: Find and extract EXACTLY ${maxJobs} job listings from LinkedIn with FULL DETAILS.

You MUST collect ${maxJobs} jobs. Do not stop until you have ${maxJobs} jobs or run out of listings.

=== PHASE 1: NAVIGATE ===
Go to: ${linkedinUrl}
Wait for the page to fully load.

=== PHASE 2: COLLECT JOBS (Repeat until you have ${maxJobs} jobs) ===

For EACH job listing in the left sidebar:

1. CLICK on the job card to open its details in the right panel
2. WAIT for the job details to load (look for job description text)
3. EXTRACT these details from the right panel:
   - title: Job title (e.g., "Senior Software Engineer")
   - company: Company name
   - location: Location (e.g., "San Francisco, CA" or "Remote")
   - salary: Salary range if shown (e.g., "$120,000 - $150,000/yr") or null
   - jobType: "Full-time", "Part-time", "Contract", etc.
   - experienceLevel: "Entry level", "Mid-Senior level", etc.
   - easyApply: true if "Easy Apply" button is present, false otherwise
   - linkedinJobId: The number from the URL (e.g., /jobs/view/4133166618/ → "4133166618")
   - description: First 500 characters of the job description
   - postedTime: When posted (e.g., "2 days ago", "1 week ago")

4. Use cache_content to save the extracted job data
5. Move to the NEXT job card

=== PHASE 3: SCROLL FOR MORE JOBS ===
After processing visible jobs, if you have fewer than ${maxJobs} jobs:
- Use scroll_to_bottom or next_page to load more job cards
- Continue extracting from new jobs that appear
- Repeat until you have ${maxJobs} jobs

=== PHASE 4: FINISH ===
Once you have collected ${maxJobs} jobs (or no more jobs available), call:
done(success=true, text="[...array of job objects as JSON...]")

=== EXAMPLE OUTPUT ===
[
  {
    "title": "Senior Frontend Engineer",
    "company": "Thinkgrid Labs",
    "location": "India (Remote)",
    "salary": "$100,000 - $130,000/yr",
    "jobType": "Full-time",
    "experienceLevel": "Mid-Senior level",
    "easyApply": true,
    "linkedinJobId": "4133166618",
    "description": "We are looking for a Senior Frontend Engineer to join our team...",
    "postedTime": "1 week ago"
  }
]

=== ERROR HANDLING ===
- If you see a LOGIN page: done(success=false, text="login_required")
- If you see CAPTCHA: done(success=false, text="captcha")
- If blocked or error: done(success=false, text="error: <describe what happened>")

=== IMPORTANT REMINDERS ===
- You MUST click each job to see full details - don't just read the card
- Use scroll_to_bottom or next_page to load more jobs
- Keep track of how many jobs you've collected
- Stop at exactly ${maxJobs} jobs
`.trim();
}

// ============================================================================
// Result Parsing
// ============================================================================

function parseJobsFromResult(finalAnswer: string | undefined): ParsedJobData[] {
  if (!finalAnswer) return [];

  try {
    const jsonMatch = finalAnswer.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          title: item.title || 'Unknown Title',
          company: item.company || 'Unknown Company',
          location: item.location || '',
          salary: item.salary || null,
          jobType: item.jobType || 'full-time',
          experienceLevel: item.experienceLevel || null,
          description: item.description || '',
          postedTime: item.postedTime || null,
          easyApply: Boolean(item.easyApply),
          linkedinJobId: String(item.linkedinJobId || item.jobId || ''),
        }));
      }
    }
  } catch (err) {
    console.error('[Discovery] Failed to parse jobs:', err);
  }

  return [];
}

function createJob(partial: ParsedJobData): Job {
  const now = new Date().toISOString();
  const linkedinJobId = partial.linkedinJobId || crypto.randomUUID();

  const locationLower = (partial.location || '').toLowerCase();
  let locationType: 'remote' | 'hybrid' | 'onsite' = 'onsite';
  if (locationLower.includes('remote')) locationType = 'remote';
  else if (locationLower.includes('hybrid')) locationType = 'hybrid';

  const jobTypeLower = (partial.jobType || '').toLowerCase();
  let jobType: 'full-time' | 'part-time' | 'contract' | 'internship' = 'full-time';
  if (jobTypeLower.includes('part')) jobType = 'part-time';
  else if (jobTypeLower.includes('contract')) jobType = 'contract';
  else if (jobTypeLower.includes('intern')) jobType = 'internship';

  const expLower = (partial.experienceLevel || '').toLowerCase();
  let experienceLevel: 'internship' | 'entry' | 'associate' | 'mid-senior' | 'director' | 'executive' | undefined;
  if (expLower.includes('intern')) experienceLevel = 'internship';
  else if (expLower.includes('entry')) experienceLevel = 'entry';
  else if (expLower.includes('associate')) experienceLevel = 'associate';
  else if (expLower.includes('mid') || expLower.includes('senior')) experienceLevel = 'mid-senior';
  else if (expLower.includes('director')) experienceLevel = 'director';
  else if (expLower.includes('executive')) experienceLevel = 'executive';

  return {
    id: crypto.randomUUID(),
    linkedinJobId,
    title: partial.title || 'Unknown Title',
    company: partial.company || 'Unknown Company',
    location: partial.location || '',
    locationType,
    jobType,
    experienceLevel,
    salaryText: partial.salary || undefined,
    description: partial.description,
    postedAt: now,
    postedTime: partial.postedTime,
    capturedAt: now,
    url: `https://www.linkedin.com/jobs/view/${linkedinJobId}`,
    status: 'pending',
    easyApply: partial.easyApply ?? false,
  };
}

// ============================================================================
// State Management
// ============================================================================

function updateState(updates: Partial<DiscoveryState>): void {
  discoveryState = { ...discoveryState, ...updates };
  stateListeners.forEach((listener) => {
    try {
      listener(discoveryState);
    } catch (err) {
      console.error('State listener error:', err);
    }
  });
}

function notifyJobFound(job: Job): void {
  if (currentReport) {
    currentReport.jobsFound++;
    currentReport.jobsExtracted.push(job);
    currentReport.endedAt = Date.now();
    currentReport.duration = currentReport.endedAt - currentReport.startedAt;
  }
  
  jobListeners.forEach((listener) => {
    try {
      listener(job);
    } catch (err) {
      console.error('Job listener error:', err);
    }
  });
}

// ============================================================================
// Session Reporting
// ============================================================================

function initSession(task: string, searchQuery: string): void {
  currentReport = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    endedAt: Date.now(),
    duration: 0,
    task,
    searchQuery,
    success: false,
    stoppedReason: 'running',
    totalSteps: 0,
    successfulSteps: 0,
    failedSteps: 0,
    totalActions: 0,
    successfulActions: 0,
    failedActions: 0,
    jobsFound: 0,
    jobsExtracted: [],
    steps: [],
    urlsVisited: [],
  };
  
  currentStepLog = null;
  urlsVisited = new Set();
  sessionReports.push(currentReport);
}

function logAction(action: string, status: 'start' | 'ok' | 'fail', details: string, error?: string): void {
  if (!currentStepLog || !currentReport) return;
  
  currentStepLog.actions.push({
    timestamp: Date.now(),
    action,
    details,
    status,
    ...(error && { error }),
  });
  
  if (status === 'ok') {
    currentReport.totalActions++;
    currentReport.successfulActions++;
  } else if (status === 'fail') {
    currentReport.totalActions++;
    currentReport.failedActions++;
  }
  
  currentReport.endedAt = Date.now();
  currentReport.duration = currentReport.endedAt - currentReport.startedAt;
}

function startStep(stepNumber: number, goal?: string, url?: string): void {
  if (!currentReport) return;
  
  if (currentStepLog) {
    currentReport.steps.push(currentStepLog);
    currentReport.totalSteps++;
    if (currentStepLog.success) currentReport.successfulSteps++;
    else currentReport.failedSteps++;
  }
  
  currentStepLog = {
    step: stepNumber,
    timestamp: Date.now(),
    goal: goal || '',
    actions: [],
    url,
    success: true,
  };
  
  if (url) {
    urlsVisited.add(url);
    currentReport.urlsVisited = Array.from(urlsVisited);
  }
  
  currentReport.endedAt = Date.now();
  currentReport.duration = currentReport.endedAt - currentReport.startedAt;
}

function failStep(error: string): void {
  if (currentStepLog) {
    currentStepLog.success = false;
    currentStepLog.error = error;
  }
}

function finalizeSessionReport(
  success: boolean,
  stoppedReason: string,
  jobs: Job[],
  error?: string,
  finalUrl?: string
): SessionReport {
  if (!currentReport) {
    return {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      endedAt: Date.now(),
      duration: 0,
      task: '',
      searchQuery: '',
      success: false,
      stoppedReason: 'error',
      error: 'No session was initialized',
      totalSteps: 0,
      successfulSteps: 0,
      failedSteps: 0,
      totalActions: 0,
      successfulActions: 0,
      failedActions: 0,
      jobsFound: 0,
      jobsExtracted: [],
      steps: [],
      urlsVisited: [],
    };
  }
  
  if (currentStepLog) {
    currentReport.steps.push(currentStepLog);
    currentReport.totalSteps++;
    if (currentStepLog.success) currentReport.successfulSteps++;
    else currentReport.failedSteps++;
    currentStepLog = null;
  }
  
  currentReport.endedAt = Date.now();
  currentReport.duration = currentReport.endedAt - currentReport.startedAt;
  currentReport.success = success;
  currentReport.stoppedReason = stoppedReason;
  if (error) currentReport.error = error;
  if (finalUrl) currentReport.finalUrl = finalUrl;
  currentReport.jobsFound = jobs.length;
  currentReport.jobsExtracted = jobs;
  currentReport.urlsVisited = Array.from(urlsVisited);
  
  const report = currentReport;
  currentReport = null;
  
  console.log(`[Session] Finalized: ${success ? 'SUCCESS' : 'FAILED'} - ${jobs.length} jobs, ${report.totalSteps} steps`);
  
  return report;
}

// ============================================================================
// Event Handling (from automation-core)
// ============================================================================

function handleExecutionEvent(event: ExecutionEvent): void {
  const eventType = event.type;
  
  // Handle step events
  if (eventType === 'step_start' || eventType === 'step_ok') {
    const stepNum = event.step || 0;
    startStep(stepNum, event.details);
    updateState({
      currentStep: stepNum,
      maxSteps: event.maxSteps || 50,
    });
  } else if (eventType === 'step_fail') {
    const stepNum = event.step || 0;
    updateState({ currentStep: stepNum });
    failStep(event.details || 'Step failed');
  }
  
  // Handle action events
  if (eventType === 'action_start') {
    logAction(event.action || 'action', 'start', event.details || '');
  } else if (eventType === 'action_ok') {
    logAction(event.action || 'action', 'ok', event.details || '');
  } else if (eventType === 'action_fail') {
    logAction(event.action || 'action', 'fail', event.details || '', event.details);
  }
  
  // Handle LLM events
  if (eventType === 'llm_start') {
    logAction('llm_call', 'start', event.details || '');
  } else if (eventType === 'llm_ok') {
    logAction('llm_call', 'ok', event.details || '');
  } else if (eventType === 'llm_fail') {
    logAction('llm_call', 'fail', event.details || '', event.details);
  }
  
  // Handle task failure
  if (eventType === 'task_fail') {
    const errorMsg = event.details || 'Unknown error';
    failStep(errorMsg);
    
    const errorLower = errorMsg.toLowerCase();
    if (errorLower.includes('captcha')) {
      updateState({ status: 'captcha', error: 'CAPTCHA detected' });
    } else if (errorLower.includes('login')) {
      updateState({ status: 'login_required', error: 'Login required' });
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

export function getSessionReports(): SessionReport[] {
  return [...sessionReports];
}

export function getLastSessionReport(): SessionReport | null {
  return sessionReports.length > 0 ? sessionReports[sessionReports.length - 1] : null;
}

export function clearSessionReports(): void {
  sessionReports.length = 0;
}

export async function startDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { maxJobs = 20, preferences, searchQuery } = options;

  if (discoveryState.status === 'running') {
    return { success: false, jobs: [], error: 'Discovery already running' };
  }

  const query = searchQuery || buildSearchQuery(preferences);
  const jobs: Job[] = [];
  const task = buildDiscoveryTask(query, maxJobs);
  
  initSession(task, query);

  try {
    updateState({
      status: 'running',
      jobsFound: 0,
      currentStep: 0,
      startedAt: Date.now(),
      error: undefined,
    });

    startStep(0, 'Initializing automation agent');
    logAction('init_agent', 'start', 'Creating browser context');
    
    await initAgent();
    logAction('init_agent', 'ok', 'Agent initialized');

    // Subscribe to automation events
    agent?.on('all', handleExecutionEvent);

    startStep(1, 'Executing discovery task');
    logAction('execute_task', 'start', `Search: ${query}`);
    
    let result: TaskResult;
    let finalUrl: string | undefined;
    
    try {
      result = await executeTask(task);
      finalUrl = result.finalUrl;
      
      // Log step records from result
      for (const stepRecord of result.steps || []) {
        startStep(stepRecord.step, stepRecord.goal, stepRecord.url);
        for (const action of stepRecord.actions) {
          logAction(
            action.name, 
            action.result.error ? 'fail' : 'ok', 
            JSON.stringify(action.args).substring(0, 100),
            action.result.error || undefined
          );
        }
        if (stepRecord.url) urlsVisited.add(stepRecord.url);
      }
      
      logAction('execute_task', 'ok', `${result.steps?.length || 0} steps completed`);
    } catch (taskError) {
      const errorMsg = taskError instanceof Error ? taskError.message : String(taskError);
      logAction('execute_task', 'fail', 'Task failed', errorMsg);
      failStep(errorMsg);
      throw taskError;
    }

    if (!result.success) {
      const errorLower = result.error?.toLowerCase() || '';
      const answerLower = result.finalAnswer?.toLowerCase() || '';

      if (errorLower.includes('captcha') || answerLower.includes('captcha')) {
        updateState({ status: 'captcha', error: 'CAPTCHA detected' });
        return { 
          success: false, jobs: [], error: 'CAPTCHA detected', 
          stoppedReason: 'captcha', 
          report: finalizeSessionReport(false, 'captcha', [], 'CAPTCHA detected', finalUrl) 
        };
      }

      if (errorLower.includes('login') || answerLower.includes('login_required')) {
        updateState({ status: 'login_required', error: 'Login required' });
        return { 
          success: false, jobs: [], error: 'Login required', 
          stoppedReason: 'login', 
          report: finalizeSessionReport(false, 'login', [], 'Login required', finalUrl) 
        };
      }

      updateState({ status: 'error', error: result.error });
      return { 
        success: false, jobs: [], error: result.error, 
        stoppedReason: 'error', 
        report: finalizeSessionReport(false, 'error', [], result.error, finalUrl) 
      };
    }

    // Parse jobs from result
    startStep(discoveryState.currentStep + 1, 'Parsing extracted jobs');
    logAction('parse_jobs', 'start', 'Parsing jobs from result');
    
    const parsedJobs = parseJobsFromResult(result.finalAnswer);
    logAction('parse_jobs', 'ok', `Parsed ${parsedJobs.length} jobs`);

    for (const partial of parsedJobs) {
      const job = createJob(partial);
      jobs.push(job);
      updateState({ jobsFound: jobs.length });
      notifyJobFound(job);
    }

    updateState({ status: 'idle' });

    const stoppedReason = jobs.length >= maxJobs ? 'max_jobs' : 'complete';
    return {
      success: true,
      jobs,
      stoppedReason,
      report: finalizeSessionReport(true, stoppedReason, jobs, undefined, finalUrl),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    updateState({ status: 'error', error: errorMessage });
    return { 
      success: false, jobs, error: errorMessage, 
      stoppedReason: 'error', 
      report: finalizeSessionReport(false, 'error', jobs, errorMessage) 
    };
  } finally {
    await cleanupAgent();
  }
}

export async function stopDiscovery(): Promise<void> {
  if (discoveryState.status === 'running') {
    await stopAgent();
    updateState({ status: 'idle' });
  }
}

export function getDiscoveryState(): DiscoveryState {
  return { ...discoveryState };
}

export function onStateChange(listener: (state: DiscoveryState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function onJobFound(listener: (job: Job) => void): () => void {
  jobListeners.add(listener);
  return () => jobListeners.delete(listener);
}
