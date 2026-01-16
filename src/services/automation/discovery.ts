/**
 * Job Discovery Service
 * 
 * Uses automation agent to search LinkedIn and extract jobs.
 */

import { initAgent, executeTask, stopAgent, cleanupAgent, onDiscoveryEvent } from './agent';
import type { DiscoveryOptions, DiscoveryResult, DiscoveryState, DiscoveryEvent, DiscoveryEventHandler } from './types';
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
  return `
Search for jobs on LinkedIn with the following steps:

1. Navigate to https://www.linkedin.com/jobs/
2. Enter "${searchQuery}" in the search box
3. Press Enter or click search
4. Wait for job listings to load
5. For each job card (up to ${maxJobs} jobs), extract:
   - Job title
   - Company name
   - Location (city or "Remote")
   - Whether it says "Easy Apply"
   - The job URL or job ID

Return the extracted jobs as a JSON array in your final answer with this format:
[
  {
    "title": "Job Title",
    "company": "Company Name", 
    "location": "Location",
    "easyApply": true/false,
    "linkedinJobId": "job ID from URL"
  }
]

If you see a login page, stop and report "login_required".
If you see a CAPTCHA, stop and report "captcha".
`.trim();
}

/**
 * Parse jobs from task result
 */
function parseJobsFromResult(finalAnswer: string | undefined): Partial<Job>[] {
  if (!finalAnswer) return [];

  try {
    // Try to find JSON array in the response
    const jsonMatch = finalAnswer.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          title: item.title || 'Unknown Title',
          company: item.company || 'Unknown Company',
          location: item.location || '',
          easyApply: Boolean(item.easyApply),
          linkedinJobId: String(item.linkedinJobId || item.jobId || ''),
        }));
      }
    }
  } catch (err) {
    console.error('Failed to parse jobs from result:', err);
  }

  return [];
}

/**
 * Convert partial job to full Job object
 */
function createJob(partial: Partial<Job>): Job {
  const now = new Date().toISOString();
  const linkedinJobId = partial.linkedinJobId || crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    linkedinJobId,
    title: partial.title || 'Unknown Title',
    company: partial.company || 'Unknown Company',
    location: partial.location || '',
    locationType: partial.location?.toLowerCase().includes('remote') ? 'remote' : 'onsite',
    jobType: 'full-time',
    postedAt: now,
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
 * Notify job listeners of a new job
 */
function notifyJobFound(job: Job): void {
  jobListeners.forEach((listener) => {
    try {
      listener(job);
    } catch (err) {
      console.error('Job listener error:', err);
    }
  });
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

  try {
    updateState({
      status: 'running',
      jobsFound: 0,
      currentStep: 0,
      startedAt: Date.now(),
      error: undefined,
    });

    console.log('[Discovery] Initializing agent...');
    // Initialize agent (will open new tab)
    await initAgent();
    console.log('[Discovery] Agent initialized');

    // Subscribe to step updates
    const unsubscribe = onDiscoveryEvent((event: DiscoveryEvent) => {
      if (event.type === 'step') {
        updateState({
          currentStep: event.payload.step || 0,
          maxSteps: event.payload.maxSteps || 50,
        });
      } else if (event.type === 'error') {
        // Check for special error conditions
        const errorMsg = event.payload.error?.toLowerCase() || '';
        if (errorMsg.includes('captcha')) {
          updateState({ status: 'captcha', error: 'CAPTCHA detected' });
        } else if (errorMsg.includes('login')) {
          updateState({ status: 'login_required', error: 'Login required' });
        }
      }
    });

    // Execute discovery task
    const task = buildDiscoveryTask(query, maxJobs);
    console.log('[Discovery] Executing task...');
    const result = await executeTask(task);
    console.log('[Discovery] Task result:', result);

    unsubscribe();

    if (!result.success) {
      // Check for special conditions
      const errorLower = result.error?.toLowerCase() || '';
      const answerLower = result.finalAnswer?.toLowerCase() || '';

      if (errorLower.includes('captcha') || answerLower.includes('captcha')) {
        updateState({ status: 'captcha', error: 'CAPTCHA detected' });
        return { success: false, jobs: [], error: 'CAPTCHA detected', stoppedReason: 'captcha' };
      }

      if (errorLower.includes('login') || answerLower.includes('login_required')) {
        updateState({ status: 'login_required', error: 'Login required' });
        return { success: false, jobs: [], error: 'Login required', stoppedReason: 'login' };
      }

      updateState({ status: 'error', error: result.error });
      return { success: false, jobs: [], error: result.error, stoppedReason: 'error' };
    }

    // Parse extracted jobs
    const parsedJobs = parseJobsFromResult(result.finalAnswer);

    for (const partial of parsedJobs) {
      const job = createJob(partial);
      jobs.push(job);
      updateState({ jobsFound: jobs.length });
      notifyJobFound(job);
    }

    updateState({ status: 'idle' });

    return {
      success: true,
      jobs,
      stoppedReason: jobs.length >= maxJobs ? 'max_jobs' : 'complete',
    };
  } catch (err) {
    console.error('[Discovery] Error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    updateState({ status: 'error', error: errorMessage });
    return { success: false, jobs, error: errorMessage, stoppedReason: 'error' };
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

