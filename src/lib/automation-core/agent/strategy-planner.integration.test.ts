/**
 * StrategyPlanner Integration Test
 * 
 * Tests the StrategyPlanner with a REAL LLM (Gemini) against mock page scenarios.
 * 
 * Run with: npm test -- --run strategy-planner.integration
 * 
 * Requires: VITE_GEMINI_API_KEY environment variable
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { StrategyPlanner, createMockTools } from './strategy-planner';
import { createChatModel } from '../llm/factory';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// Skip if no API key
const API_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const SKIP_REASON = API_KEY ? '' : 'VITE_GEMINI_API_KEY not set - skipping integration tests';

// Sample DOMs
const LINKEDIN_DOM = `
[0]<div class="scaffold-layout">
  [1]<div class="scaffold-layout__list-container">
    [2]<ul class="jobs-search-results__list" role="list">
      [3]<li class="jobs-search-results__list-item" data-occludable-job-id="3847562910">
        [4]<div class="job-card-container">
          [5]<a class="job-card-container__link" href="/jobs/view/3847562910">
            [6]<span class="job-card-list__title">Senior Software Engineer</span>
            [7]<span class="job-card-container__company-name">TechCorp Inc.</span>
            [8]<span class="job-card-container__metadata-item">San Francisco, CA (Remote)</span>
            [9]<span class="job-card-container__footer-job-state">Applied 2 days ago</span>
          </a>
        </div>
      </li>
      [10]<li class="jobs-search-results__list-item" data-occludable-job-id="3847562911">
        [11]<div class="job-card-container">
          [12]<a class="job-card-container__link" href="/jobs/view/3847562911">
            [13]<span class="job-card-list__title">Frontend Developer</span>
            [14]<span class="job-card-container__company-name">StartupXYZ</span>
            [15]<span class="job-card-container__metadata-item">New York, NY (Hybrid)</span>
          </a>
        </div>
      </li>
      [16]<li class="jobs-search-results__list-item" data-occludable-job-id="3847562912">
        [17]<div class="job-card-container">
          [18]<a class="job-card-container__link" href="/jobs/view/3847562912">
            [19]<span class="job-card-list__title">Full Stack Engineer</span>
            [20]<span class="job-card-container__company-name">BigCorp</span>
            [21]<span class="job-card-container__metadata-item">Austin, TX</span>
          </a>
        </div>
      </li>
    </ul>
  </div>
  [22]<div class="jobs-search__job-details">
    [23]<div class="jobs-details">
      [24]<div class="jobs-details-top-card">
        [25]<h2 class="jobs-details-top-card__job-title">Senior Software Engineer</h2>
        [26]<span class="jobs-details-top-card__company-url">TechCorp Inc.</span>
        [27]<span class="jobs-details-top-card__bullet">San Francisco, CA</span>
        [28]<span class="jobs-details-top-card__job-insight">$150,000 - $200,000/yr</span>
      </div>
      [29]<div class="jobs-description">
        [30]<h3>About the job</h3>
        [31]<p>We are looking for a Senior Software Engineer to join our team...</p>
        [32]<h3>Requirements</h3>
        [33]<ul>
          [34]<li>5+ years of experience with Python, JavaScript, or Go</li>
          [35]<li>Experience with cloud platforms (AWS, GCP, Azure)</li>
          [36]<li>Strong problem-solving skills</li>
        </ul>
        [37]<h3>Benefits</h3>
        [38]<ul>
          [39]<li>Competitive salary and equity</li>
          [40]<li>Remote-first culture</li>
          [41]<li>Unlimited PTO</li>
        </ul>
      </div>
      [42]<button class="jobs-apply-button" aria-label="Apply to TechCorp Inc.">Apply</button>
      [43]<button class="jobs-save-button" aria-label="Save job">Save</button>
    </div>
  </div>
</div>
[44]<footer class="jobs-search-results__pagination">
  [45]<button aria-label="Page 1" aria-current="true">1</button>
  [46]<button aria-label="Page 2">2</button>
  [47]<button aria-label="Page 3">3</button>
  [48]<button aria-label="Next" class="artdeco-pagination__button--next">Next</button>
</footer>
`;

const INDEED_DOM = `
[0]<div id="mosaic-provider-jobcards">
  [1]<div class="jobsearch-ResultsList">
    [2]<div class="job_seen_beacon" data-jk="a1b2c3d4e5f6">
      [3]<table class="jobCard_mainContent">
        [4]<h2 class="jobTitle"><a href="/viewjob?jk=a1b2c3d4e5f6">Software Engineer</a></h2>
        [5]<span class="companyName">Google</span>
        [6]<div class="companyLocation">Mountain View, CA</div>
        [7]<div class="salary-snippet">$140,000 - $180,000 a year</div>
        [8]<div class="job-snippet">We're looking for talented engineers to build the next generation...</div>
      </table>
    </div>
    [9]<div class="job_seen_beacon" data-jk="f6e5d4c3b2a1">
      [10]<table class="jobCard_mainContent">
        [11]<h2 class="jobTitle"><a href="/viewjob?jk=f6e5d4c3b2a1">Backend Developer</a></h2>
        [12]<span class="companyName">Meta</span>
        [13]<div class="companyLocation">Menlo Park, CA</div>
        [14]<div class="job-snippet">Join our infrastructure team to scale systems...</div>
      </table>
    </div>
  </div>
</div>
[15]<nav class="pagination" role="navigation" aria-label="pagination">
  [16]<a href="?start=0" aria-current="page">1</a>
  [17]<a href="?start=10">2</a>
  [18]<a href="?start=20">3</a>
  [19]<a href="?start=10" aria-label="Next Page">
    [20]<span>Next</span>
  </a>
</nav>
`;

describe.skipIf(!!SKIP_REASON)('StrategyPlanner Integration', () => {
  let llm: BaseChatModel;

  beforeAll(() => {
    if (!API_KEY) {
      console.log('Skipping integration tests:', SKIP_REASON);
      return;
    }

    llm = createChatModel({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey: API_KEY,
    });
  });

  it('should explore LinkedIn-style page and plan list-detail strategy', async () => {
    const planner = new StrategyPlanner(llm, { maxToolCalls: 5 });
    const tools = createMockTools('linkedin');

    console.log('\n=== LINKEDIN STRATEGY PLANNING START ===\n');

    const result = await planner.plan({
      dom: LINKEDIN_DOM,
      url: 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=San%20Francisco',
      title: 'software engineer Jobs in San Francisco | LinkedIn',
      task: 'Extract all job listings from this page. I want to get job title, company, location, and full description for each job.',
    }, tools);

    console.log('\n--- TOOL CALLS ---');
    for (const call of result.toolCalls) {
      console.log(`\n${call.tool}(${JSON.stringify(call.args)})`);
      console.log(`→ ${call.result}`);
    }

    console.log('\n--- FINAL STRATEGY ---');
    console.log(result.strategy);
    console.log('\n=== LINKEDIN STRATEGY PLANNING END ===\n');

    // Assertions - the LLM should understand key concepts
    expect(result.strategy.toLowerCase()).toMatch(/list|panel|detail|card/);
    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  }, 30000);

  it('should explore Indeed-style page and plan pagination strategy', async () => {
    const planner = new StrategyPlanner(llm, { maxToolCalls: 5 });
    const tools = createMockTools('indeed');

    console.log('\n=== INDEED STRATEGY PLANNING START ===\n');

    const result = await planner.plan({
      dom: INDEED_DOM,
      url: 'https://www.indeed.com/jobs?q=software+engineer&l=California',
      title: 'Software Engineer Jobs in California | Indeed.com',
      task: 'Extract all job listings from this page including job title, company, location, and any salary information.',
    }, tools);

    console.log('\n--- TOOL CALLS ---');
    for (const call of result.toolCalls) {
      console.log(`\n${call.tool}(${JSON.stringify(call.args)})`);
      console.log(`→ ${call.result}`);
    }

    console.log('\n--- FINAL STRATEGY ---');
    console.log(result.strategy);
    console.log('\n=== INDEED STRATEGY PLANNING END ===\n');

    // Assertions
    expect(result.strategy.toLowerCase()).toMatch(/pagination|page|navigat/);
    expect(result.toolCalls.length).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  }, 30000);

  it('should identify key elements and explain extraction strategy', async () => {
    const planner = new StrategyPlanner(llm, { maxToolCalls: 3 });
    const tools = createMockTools('linkedin');

    const result = await planner.plan({
      dom: LINKEDIN_DOM,
      url: 'https://www.linkedin.com/jobs/search/',
      title: 'Jobs | LinkedIn',
      task: 'I need to extract 100 jobs. How should I approach this?',
    }, tools);

    console.log('\n--- STRATEGY ---');
    console.log(result.strategy);

    // Should mention scrolling or pagination for getting more items
    expect(result.strategy.toLowerCase()).toMatch(/scroll|pagination|page|more|load|next/);
  }, 30000);
});

// Quick sanity check that runs without API key
describe('StrategyPlanner Integration (mocked)', () => {
  it('should work with mock LLM for sanity check', async () => {
    // Create a simple mock LLM
    const mockLLM = {
      invoke: async () => ({
        content: `## PAGE UNDERSTANDING
This is a job search page. I can see job cards on the left and a details panel on the right.

## STRATEGY
1. SCROLL/PAGINATION: Use infinite scroll
2. EXTRACTION: Click each card, extract from panel
3. NEEDED GENERATORS: None
4. LOOP: For each card, click and extract`,
        tool_calls: [],
      }),
      _llmType: () => 'mock',
      _modelType: () => 'mock',
    } as unknown as BaseChatModel;

    const planner = new StrategyPlanner(mockLLM, { maxToolCalls: 3 });
    const tools = createMockTools('linkedin');

    const result = await planner.plan({
      dom: '<div>test</div>',
      url: 'https://example.com',
      title: 'Test',
      task: 'Test task',
    }, tools);

    expect(result.strategy).toContain('PAGE UNDERSTANDING');
    expect(result.strategy).toContain('STRATEGY');
    expect(result.toolCalls.length).toBe(0); // Mock LLM doesn't call tools
  });
});
