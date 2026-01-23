/**
 * Manual Test Script for StrategyPlanner
 * 
 * This can be run from the browser extension's background script or console
 * to test the StrategyPlanner against a real page.
 * 
 * Usage:
 * 1. Open a job search page (LinkedIn, Indeed, etc.)
 * 2. Open extension background console
 * 3. Import and run: testStrategyPlanner()
 */

import { StrategyPlanner, createBrowserTools } from './strategy-planner';
import { BrowserContext } from '../browser/context';
import { createChatModel } from '../llm/factory';

export interface ManualTestResult {
  success: boolean;
  strategy?: string;
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  errors?: string[];
  error?: string;
  duration?: number;
}

/**
 * Run StrategyPlanner on the current active tab
 */
export async function testStrategyPlanner(options?: {
  apiKey?: string;
  task?: string;
  maxToolCalls?: number;
}): Promise<ManualTestResult> {
  const startTime = Date.now();
  
  const apiKey = options?.apiKey || import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'No API key provided. Set VITE_GEMINI_API_KEY or pass apiKey option.' };
  }

  const task = options?.task || 'Understand this page and explain how to extract all job listings from it.';

  try {
    console.log('[ManualTest] Starting StrategyPlanner test...');
    
    // Get browser context and page
    console.log('[ManualTest] Getting browser context...');
    const context = await BrowserContext.fromActiveTab();
    const page = await context.getCurrentPage();
    
    if (!page) {
      return { success: false, error: 'No active page found' };
    }

    console.log('[ManualTest] Page URL:', page.url());

    // Get DOM snapshot
    console.log('[ManualTest] Getting DOM state...');
    const state = await page.getState();
    if (!state?.elementTree) {
      return { success: false, error: 'Could not get page state' };
    }

    const domString = state.elementTree.clickableElementsToString();
    console.log('[ManualTest] DOM elements:', domString.length, 'chars');

    // Create LLM
    console.log('[ManualTest] Creating LLM...');
    const llm = createChatModel({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey,
    });

    // Create planner
    const planner = new StrategyPlanner(llm, { maxToolCalls: options?.maxToolCalls ?? 5 });

    // Create browser tools
    const tools = createBrowserTools(page);

    // Run planning
    console.log('[ManualTest] Starting strategy planning...');
    console.log('[ManualTest] Task:', task);
    
    const result = await planner.plan({
      dom: domString,
      url: page.url(),
      title: (await page.title()) || 'Unknown',
      task,
    }, tools);

    const duration = Date.now() - startTime;

    console.log('\n=== STRATEGY PLANNING COMPLETE ===');
    console.log('Duration:', duration, 'ms');
    console.log('Tool calls:', result.toolCalls.length);
    console.log('Errors:', result.errors.length);
    console.log('\n--- TOOL CALLS ---');
    for (const call of result.toolCalls) {
      console.log(`  ${call.tool}(${JSON.stringify(call.args)})`);
      console.log(`    → ${call.result.slice(0, 200)}...`);
    }
    console.log('\n--- STRATEGY ---');
    console.log(result.strategy);
    console.log('========================\n');

    return {
      success: true,
      strategy: result.strategy,
      toolCalls: result.toolCalls,
      errors: result.errors,
      duration,
    };

  } catch (error) {
    console.error('[ManualTest] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Test with mock tools (for testing without real browser interaction)
 */
export async function testStrategyPlannerMock(
  scenario: 'linkedin' | 'indeed' | 'simple-list',
  options?: {
    apiKey?: string;
    task?: string;
  }
): Promise<ManualTestResult> {
  const startTime = Date.now();

  const apiKey = options?.apiKey || import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'No API key provided' };
  }

  const task = options?.task || 'Extract all job listings from this page.';

  // Sample DOM for scenarios
  const sampleDOMs: Record<string, { dom: string; url: string; title: string }> = {
    linkedin: {
      dom: `[0]<div class="scaffold-layout__list">
  [1]<ul class="jobs-search-results__list">
    [2]<li class="job-card-container" data-occludable-job-id="12345">
      [3]<a class="job-card-container__link" href="/jobs/view/12345">
        [4]<span>Senior Software Engineer</span>
        [5]<span class="company-name">TechCorp</span>
        [6]<span>San Francisco, CA</span>
      </a>
    </li>
    [7]<li class="job-card-container" data-occludable-job-id="12346">
      [8]<a class="job-card-container__link" href="/jobs/view/12346">
        [9]<span>Frontend Developer</span>
        [10]<span class="company-name">StartupXYZ</span>
        [11]<span>Remote</span>
      </a>
    </li>
    <!-- ... more job cards ... -->
  </ul>
</div>
[12]<div class="jobs-details">
  [13]<div class="jobs-details__main-content">
    [14]<h2 class="job-title">Senior Software Engineer</h2>
    [15]<span class="company">TechCorp</span>
    [16]<div class="jobs-description">
      We are looking for a skilled software engineer...
      Requirements: 5+ years experience, Python, JavaScript...
    </div>
    [17]<button class="apply-button">Apply</button>
    [18]<button class="save-button">Save</button>
  </div>
</div>`,
      url: 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer',
      title: 'Jobs | LinkedIn',
    },
    indeed: {
      dom: `[0]<div class="mosaic-provider-jobcards">
  [1]<ul class="jobsearch-ResultsList">
    [2]<li class="result" data-jk="abc123">
      [3]<a class="jcs-JobTitle" href="/viewjob?jk=abc123">Software Engineer</a>
      [4]<span class="companyName">BigCorp</span>
      [5]<div class="companyLocation">New York, NY</div>
      [6]<div class="salary">$120,000 - $150,000</div>
    </li>
    [7]<li class="result" data-jk="abc124">
      [8]<a class="jcs-JobTitle" href="/viewjob?jk=abc124">Data Scientist</a>
      [9]<span class="companyName">DataCo</span>
      [10]<div class="companyLocation">Boston, MA</div>
    </li>
  </ul>
</div>
[11]<nav class="pagination" aria-label="pagination">
  [12]<a href="?start=0" aria-current="page">1</a>
  [13]<a href="?start=10">2</a>
  [14]<a href="?start=20">3</a>
  [15]<a aria-label="Next Page" href="?start=10">Next</a>
</nav>`,
      url: 'https://www.indeed.com/jobs?q=software+engineer&l=',
      title: 'Software Engineer Jobs | Indeed',
    },
    'simple-list': {
      dom: `[0]<main>
  [1]<div class="job-list">
    [2]<div class="job-item" data-id="1">
      [3]<h3>Python Developer</h3>
      [4]<p class="company">SmallCo</p>
      [5]<p class="location">Austin, TX</p>
    </div>
    [6]<div class="job-item" data-id="2">
      [7]<h3>React Developer</h3>
      [8]<p class="company">WebAgency</p>
      [9]<p class="location">Denver, CO</p>
    </div>
  </div>
</main>`,
      url: 'https://example-jobs.com/search',
      title: 'Job Search | Example',
    },
  };

  try {
    const { dom, url, title } = sampleDOMs[scenario];

    console.log('[ManualTest] Testing with mock scenario:', scenario);
    console.log('[ManualTest] URL:', url);

    const llm = createChatModel({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey,
    });

    const planner = new StrategyPlanner(llm, { maxToolCalls: 5 });
    
    // Import and use mock tools
    const { createMockTools } = await import('./strategy-planner');
    const tools = createMockTools(scenario);

    const result = await planner.plan({ dom, url, title, task }, tools);

    const duration = Date.now() - startTime;

    console.log('\n=== MOCK STRATEGY PLANNING COMPLETE ===');
    console.log('Scenario:', scenario);
    console.log('Duration:', duration, 'ms');
    console.log('Tool calls:', result.toolCalls.length);
    console.log('\n--- STRATEGY ---');
    console.log(result.strategy);
    console.log('==================================\n');

    return {
      success: true,
      strategy: result.strategy,
      toolCalls: result.toolCalls,
      errors: result.errors,
      duration,
    };

  } catch (error) {
    console.error('[ManualTest] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Export for console usage
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).testStrategyPlanner = testStrategyPlanner;
  (window as unknown as Record<string, unknown>).testStrategyPlannerMock = testStrategyPlannerMock;
}
