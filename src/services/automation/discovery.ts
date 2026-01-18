/**
 * Job Discovery Service
 * 
 * Uses automation agent to search LinkedIn and extract jobs.
 */

import { initAgent, executeTask, stopAgent, cleanupAgent, onDiscoveryEvent } from './agent';
import type { 
  DiscoveryOptions, 
  DiscoveryResult, 
  DiscoveryState, 
  DiscoveryEvent, 
  SessionReport,
  StepLog,
  ActionLog,
} from './types';
import type { Job } from '@shared/types/job';
import type { ExtractedPreferences } from '@/components/onboarding/types';

let discoveryState: DiscoveryState = {
  status: 'idle',
  jobsFound: 0,
  currentStep: 0,
  maxSteps: 50,
};

const stateListeners: Set<(state: DiscoveryState) => void> = new Set();
const jobListeners: Set<(job: Job) => void> = new Set();

// Session reporting state - now with live report that updates in real-time
let currentReport: SessionReport | null = null;
let currentStepLog: StepLog | null = null;
let urlsVisited: Set<string> = new Set();
const sessionReports: SessionReport[] = [];

/**
 * Build search query from preferences
 */
function buildSearchQuery(preferences: ExtractedPreferences): string {
  const parts: string[] = [];

  // Roles
  if (preferences.roles?.length) {
    parts.push(preferences.roles.slice(0, 3).join(' OR '));
  }

  // Location
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

/**
 * Build the discovery task prompt
 */
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

/**
 * Parse jobs from task result
 */
function parseJobsFromResult(finalAnswer: string | undefined): Partial<Job>[] {
  if (!finalAnswer) {
    console.log('[Discovery] No final answer to parse');
    return [];
  }

  console.log('[Discovery] Parsing jobs from:', finalAnswer.substring(0, 500));

  try {
    // Try to find JSON array in the response - use greedy match for nested objects
    const jsonMatch = finalAnswer.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      console.log('[Discovery] Found JSON array, length:', jsonMatch[0].length);
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        console.log('[Discovery] Parsed', parsed.length, 'jobs');
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
    } else {
      console.log('[Discovery] No JSON array found in response');
    }
  } catch (err) {
    console.error('[Discovery] Failed to parse jobs from result:', err);
    console.error('[Discovery] Raw answer was:', finalAnswer);
  }

  return [];
}

/**
 * Convert partial job to full Job object
 */
function createJob(partial: Partial<Job> & { salary?: string; postedTime?: string }): Job {
  const now = new Date().toISOString();
  const linkedinJobId = partial.linkedinJobId || crypto.randomUUID();

  // Parse location type
  const locationLower = (partial.location || '').toLowerCase();
  let locationType: 'remote' | 'hybrid' | 'onsite' = 'onsite';
  if (locationLower.includes('remote')) {
    locationType = 'remote';
  } else if (locationLower.includes('hybrid')) {
    locationType = 'hybrid';
  }

  // Parse job type
  const jobTypeLower = (partial.jobType || '').toLowerCase();
  let jobType: 'full-time' | 'part-time' | 'contract' | 'internship' = 'full-time';
  if (jobTypeLower.includes('part')) {
    jobType = 'part-time';
  } else if (jobTypeLower.includes('contract')) {
    jobType = 'contract';
  } else if (jobTypeLower.includes('intern')) {
    jobType = 'internship';
  }

  // Parse experience level
  const expLower = (partial.experienceLevel || '').toLowerCase();
  let experienceLevel: 'internship' | 'entry' | 'associate' | 'mid-senior' | 'director' | 'executive' | undefined;
  if (expLower.includes('intern')) {
    experienceLevel = 'internship';
  } else if (expLower.includes('entry')) {
    experienceLevel = 'entry';
  } else if (expLower.includes('associate')) {
    experienceLevel = 'associate';
  } else if (expLower.includes('mid') || expLower.includes('senior')) {
    experienceLevel = 'mid-senior';
  } else if (expLower.includes('director')) {
    experienceLevel = 'director';
  } else if (expLower.includes('executive')) {
    experienceLevel = 'executive';
  }

  return {
    id: crypto.randomUUID(),
    linkedinJobId,
    title: partial.title || 'Unknown Title',
    company: partial.company || 'Unknown Company',
    location: partial.location || '',
    locationType,
    jobType,
    experienceLevel,
    salaryText: typeof partial.salary === 'string' ? partial.salary : undefined,
    description: partial.description,
    postedAt: now,
    postedTime: partial.postedTime,
    capturedAt: now,
    url: `https://www.linkedin.com/jobs/view/${linkedinJobId}`,
    status: 'pending',
    easyApply: partial.easyApply ?? false,
  };
}

/**
 * Update discovery state and notify listeners
 */
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

/**
 * Notify job listeners of a new job and update live report
 */
function notifyJobFound(job: Job): void {
  // Update live report with new job
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

/**
 * Initialize a new session for reporting - creates live report immediately
 */
function initSession(task: string, searchQuery: string): void {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  
  // Create live report immediately - this will be updated in real-time
  currentReport = {
    id: sessionId,
    startedAt: now,
    endedAt: now,
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
  
  // Add to reports array immediately so it's visible right away
  sessionReports.push(currentReport);
  
  console.log(`[Session ${sessionId}] Started - live report created`);
}

/**
 * Log an action within the current step - updates live report
 */
function logAction(action: string, status: 'start' | 'ok' | 'fail', details: string, error?: string): void {
  if (!currentStepLog || !currentReport) return;
  
  const actionLog: ActionLog = {
    timestamp: Date.now(),
    action,
    details,
    status,
    ...(error && { error }),
  };
  
  currentStepLog.actions.push(actionLog);
  
  // Update live report stats
  if (status === 'ok') {
    currentReport.totalActions++;
    currentReport.successfulActions++;
  } else if (status === 'fail') {
    currentReport.totalActions++;
    currentReport.failedActions++;
  }
  
  // Update timestamp
  currentReport.endedAt = Date.now();
  currentReport.duration = currentReport.endedAt - currentReport.startedAt;
  
  console.log(`[Session] Step ${currentStepLog.step} - ${action}: ${status} - ${details}`);
}

/**
 * Start a new step in the session - updates live report
 */
function startStep(stepNumber: number, goal?: string, url?: string): void {
  if (!currentReport) return;
  
  // Finalize previous step if exists and add to report
  if (currentStepLog) {
    currentReport.steps.push(currentStepLog);
    currentReport.totalSteps++;
    if (currentStepLog.success) {
      currentReport.successfulSteps++;
    } else {
      currentReport.failedSteps++;
    }
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
  
  // Update timestamp
  currentReport.endedAt = Date.now();
  currentReport.duration = currentReport.endedAt - currentReport.startedAt;
  
  console.log(`[Session] Step ${stepNumber} started${goal ? `: ${goal}` : ''}`);
}

/**
 * Mark current step as failed
 */
function failStep(error: string): void {
  if (currentStepLog) {
    currentStepLog.success = false;
    currentStepLog.error = error;
  }
}

/**
 * Finalize the live session report with final status
 */
function finalizeSessionReport(
  success: boolean,
  stoppedReason: string,
  jobs: Job[],
  error?: string,
  finalUrl?: string
): SessionReport {
  if (!currentReport) {
    // Shouldn't happen, but create a minimal report if it does
    console.error('[Session] No current report to finalize!');
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
  
  // Finalize current step if exists
  if (currentStepLog) {
    currentReport.steps.push(currentStepLog);
    currentReport.totalSteps++;
    if (currentStepLog.success) {
      currentReport.successfulSteps++;
    } else {
      currentReport.failedSteps++;
    }
    currentStepLog = null;
  }
  
  // Update final status
  const endedAt = Date.now();
  currentReport.endedAt = endedAt;
  currentReport.duration = endedAt - currentReport.startedAt;
  currentReport.success = success;
  currentReport.stoppedReason = stoppedReason;
  if (error) {
    currentReport.error = error;
  }
  if (finalUrl) {
    currentReport.finalUrl = finalUrl;
  }
  currentReport.jobsFound = jobs.length;
  currentReport.jobsExtracted = jobs;
  currentReport.urlsVisited = Array.from(urlsVisited);
  
  const report = currentReport;
  
  // Clear current report reference (it's already in sessionReports array)
  currentReport = null;
  
  // Log summary
  console.log('\n========== SESSION REPORT FINALIZED ==========');
  console.log(`Session ID: ${report.id}`);
  console.log(`Duration: ${(report.duration / 1000).toFixed(1)}s`);
  console.log(`Success: ${report.success}`);
  console.log(`Stopped Reason: ${report.stoppedReason}`);
  if (report.error) console.log(`Error: ${report.error}`);
  console.log(`Steps: ${report.successfulSteps}/${report.totalSteps} successful`);
  console.log(`Actions: ${report.successfulActions}/${report.totalActions} successful`);
  console.log(`Jobs Found: ${report.jobsFound}`);
  console.log(`URLs Visited: ${report.urlsVisited.length}`);
  console.log('\n--- Step Details ---');
  for (const step of report.steps) {
    const stepStatus = step.success ? '✓' : '✗';
    console.log(`  Step ${step.step} ${stepStatus}: ${step.goal || 'No goal'}`);
    for (const action of step.actions) {
      const actionIcon = action.status === 'ok' ? '  ✓' : action.status === 'fail' ? '  ✗' : '  ⟳';
      console.log(`    ${actionIcon} ${action.action}: ${action.details.substring(0, 80)}`);
    }
    if (step.error) {
      console.log(`      Error: ${step.error}`);
    }
  }
  console.log('====================================\n');
  
  return report;
}

/**
 * Get all session reports
 */
export function getSessionReports(): SessionReport[] {
  return [...sessionReports];
}

/**
 * Get the most recent session report
 */
export function getLastSessionReport(): SessionReport | null {
  return sessionReports.length > 0 ? sessionReports[sessionReports.length - 1] : null;
}

/**
 * Clear all session reports
 */
export function clearSessionReports(): void {
  sessionReports.length = 0;
}

/**
 * Start job discovery
 */
export async function startDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { maxJobs = 20, preferences, searchQuery } = options;

  console.log('[Discovery] Starting discovery with options:', { maxJobs, searchQuery, preferences });

  if (discoveryState.status === 'running') {
    console.log('[Discovery] Already running, aborting');
    return { success: false, jobs: [], error: 'Discovery already running' };
  }

  const query = searchQuery || buildSearchQuery(preferences);
  console.log('[Discovery] Search query:', query);
  
  const jobs: Job[] = [];
  
  // Build task for reporting
  const task = buildDiscoveryTask(query, maxJobs);
  
  // Initialize session reporting
  initSession(task, query);

  try {
    updateState({
      status: 'running',
      jobsFound: 0,
      currentStep: 0,
      startedAt: Date.now(),
      error: undefined,
    });

    console.log('[Discovery] Initializing agent...');
    startStep(0, 'Initializing automation agent');
    logAction('init_agent', 'start', 'Creating browser context and agent');
    
    // Initialize agent (will open new tab)
    await initAgent();
    logAction('init_agent', 'ok', 'Agent initialized successfully');
    console.log('[Discovery] Agent initialized');

    // Subscribe to ALL automation events for comprehensive logging
    const unsubscribe = onDiscoveryEvent((event: DiscoveryEvent) => {
      if (event.type === 'step') {
        const stepNum = event.payload.step || 0;
        if (event.payload.actionStatus !== 'fail') {
          startStep(stepNum, event.payload.details);
        }
        updateState({
          currentStep: stepNum,
          maxSteps: event.payload.maxSteps || 50,
        });
      } else if (event.type === 'action') {
        // Log individual actions (clicks, inputs, navigation, etc.)
        const actionName = event.payload.action || 'unknown_action';
        const status = event.payload.actionStatus || 'ok';
        const details = event.payload.details || '';
        logAction(actionName, status, details, status === 'fail' ? details : undefined);
      } else if (event.type === 'llm') {
        // Log LLM calls
        const status = event.payload.actionStatus || 'ok';
        const details = event.payload.details || '';
        logAction('llm_call', status, details, status === 'fail' ? details : undefined);
      } else if (event.type === 'error') {
        const errorMsg = event.payload.error || 'Unknown error';
        logAction('error', 'fail', errorMsg, errorMsg);
        failStep(errorMsg);
        
        // Check for special error conditions
        const errorLower = errorMsg.toLowerCase();
        if (errorLower.includes('captcha')) {
          updateState({ status: 'captcha', error: 'CAPTCHA detected' });
        } else if (errorLower.includes('login')) {
          updateState({ status: 'login_required', error: 'Login required' });
        }
      }
    });

    // Execute discovery task
    console.log('[Discovery] Executing task...');
    startStep(1, 'Executing discovery task');
    logAction('execute_task', 'start', `Task: ${task.substring(0, 100)}...`);
    
    let result;
    let finalUrl: string | undefined;
    
    try {
      result = await executeTask(task);
      finalUrl = result.finalUrl;
      
      console.log('[Discovery] Task completed with result:', {
        success: result.success,
        error: result.error,
        stepsCount: result.steps?.length || 0,
        finalAnswerLength: result.finalAnswer?.length || 0,
      });
      
      // Log each step from the result
      for (const stepRecord of result.steps || []) {
        startStep(stepRecord.step, stepRecord.goal, stepRecord.url);
        for (const action of stepRecord.actions) {
          const actionStatus = action.result.error ? 'fail' : 'ok';
          logAction(
            action.name, 
            actionStatus, 
            JSON.stringify(action.args).substring(0, 100),
            action.result.error || undefined
          );
        }
        if (stepRecord.url) {
          urlsVisited.add(stepRecord.url);
        }
      }
      
      logAction('execute_task', 'ok', `Completed with ${result.steps?.length || 0} steps`);
    } catch (taskError) {
      const errorMsg = taskError instanceof Error ? taskError.message : String(taskError);
      console.error('[Discovery] Task execution threw error:', taskError);
      logAction('execute_task', 'fail', 'Task execution failed', errorMsg);
      failStep(errorMsg);
      throw taskError;
    }
    
    console.log('[Discovery] Task result:', result);

    unsubscribe();

    if (!result.success) {
      // Check for special conditions
      const errorLower = result.error?.toLowerCase() || '';
      const answerLower = result.finalAnswer?.toLowerCase() || '';

      if (errorLower.includes('captcha') || answerLower.includes('captcha')) {
        updateState({ status: 'captcha', error: 'CAPTCHA detected' });
        const report = finalizeSessionReport(false, 'captcha', [], 'CAPTCHA detected', finalUrl);
        return { success: false, jobs: [], error: 'CAPTCHA detected', stoppedReason: 'captcha', report };
      }

      if (errorLower.includes('login') || answerLower.includes('login_required')) {
        updateState({ status: 'login_required', error: 'Login required' });
        const report = finalizeSessionReport(false, 'login', [], 'Login required', finalUrl);
        return { success: false, jobs: [], error: 'Login required', stoppedReason: 'login', report };
      }

      updateState({ status: 'error', error: result.error });
      const report = finalizeSessionReport(false, 'error', [], result.error, finalUrl);
      return { success: false, jobs: [], error: result.error, stoppedReason: 'error', report };
    }

    // Parse extracted jobs
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
    const report = finalizeSessionReport(true, stoppedReason, jobs, undefined, finalUrl);

    return {
      success: true,
      jobs,
      stoppedReason,
      report,
    };
  } catch (err) {
    console.error('[Discovery] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    updateState({ status: 'error', error: errorMessage });
    
    const report = finalizeSessionReport(false, 'error', jobs, errorMessage);
    return { success: false, jobs, error: errorMessage, stoppedReason: 'error', report };
  } finally {
    console.log('[Discovery] Cleaning up agent');
    await cleanupAgent();
  }
}

/**
 * Stop discovery
 */
export async function stopDiscovery(): Promise<void> {
  if (discoveryState.status === 'running') {
    await stopAgent();
    updateState({ status: 'idle' });
  }
}

/**
 * Get current discovery state
 */
export function getDiscoveryState(): DiscoveryState {
  return { ...discoveryState };
}

/**
 * Subscribe to state changes
 */
export function onStateChange(listener: (state: DiscoveryState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/**
 * Subscribe to job found events
 */
export function onJobFound(listener: (job: Job) => void): () => void {
  jobListeners.add(listener);
  return () => jobListeners.delete(listener);
}

