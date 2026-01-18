# Job Applier - Automation Service

Browser automation using AI agents for LinkedIn navigation, job extraction, and form filling.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      AUTOMATION SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│   AutomationAgent → @riruru/automation-core → Browser Actions   │
│                                                                  │
│   Task (NL) → LLM Decides → Action Execute → (loop until done)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Library: @riruru/automation-core

LLM-powered browser automation extracted from [Nanobrowser](https://github.com/nicepkg/nanobrowser).

### Requirements

- **Chrome Extension Manifest V3**
- **Permissions:** `debugger`, `tabs`, `scripting`, `activeTab`
- **Host Permissions:** `<all_urls>` or specific sites (e.g., `https://www.linkedin.com/*`)

⚠️ **Will NOT work in:** Node.js, web pages, or non-Chrome browsers.

### Installation

```bash
npm install @riruru/automation-core puppeteer-core zod
```

After installation, copy the required DOM script to your extension's public folder:

```bash
cp node_modules/@riruru/automation-core/buildDomTree.js public/
```

This script is injected into web pages to extract interactive elements and create visual highlights.

### Peer Dependencies

| Package | Purpose |
|---------|---------|
| `puppeteer-core` | Browser control via CDP (Chrome DevTools Protocol) |
| `zod` | Runtime validation of LLM outputs and action parameters |

---

## Setup

```typescript
import { AutomationAgent, BrowserContext } from '@riruru/automation-core';

let agent: AutomationAgent | null = null;

export async function initAutomation(llmConfig: LLMConfig): Promise<void> {
  // Create context from active tab
  const context = await BrowserContext.fromActiveTab();

  agent = new AutomationAgent({
    context,
    llm: {
      provider: llmConfig.provider,  // 'anthropic' | 'openai' | 'gemini' | 'ollama'
      apiKey: llmConfig.apiKey,
      model: llmConfig.model,
    },
    options: {
      maxSteps: 50,           // Max LLM decision loops
      maxActionsPerStep: 5,   // Max actions per step
      maxFailures: 3,         // Retry limit
      useVision: false,       // Screenshot-based decisions (slower)
    },
  });

  // Subscribe to events
  agent.on('step', (event) => console.log(`Step ${event.step}: ${event.details}`));
  agent.on('error', (event) => console.error(`Error: ${event.details}`));
}

export function getAgent(): AutomationAgent {
  if (!agent) throw new Error('Automation not initialized');
  return agent;
}
```

---

## Supported LLM Providers

| Provider | Models |
|----------|--------|
| Anthropic | Claude 3 Opus, Sonnet, Haiku, Claude 3.5/4 Sonnet |
| OpenAI | GPT-4, GPT-4 Turbo, GPT-3.5 Turbo |
| Google | Gemini Pro, Gemini Ultra |
| Ollama | Any local model |

---

## Built-in Actions

The library provides these browser actions out of the box:

| Category | Actions |
|----------|---------|
| **Navigation** | `go_to_url`, `go_back`, `search_google` |
| **Interaction** | `click_element`, `input_text`, `send_keys` |
| **Scrolling** | `scroll_to_top`, `scroll_to_bottom`, `next_page`, `previous_page` |
| **Tab Management** | `open_tab`, `switch_tab`, `close_tab` |
| **Dropdowns** | `get_dropdown_options`, `select_dropdown_option` |
| **Utility** | `wait`, `cache_content`, `done` |

The LLM agent automatically selects which actions to use based on the task.

---

## Task Execution

```typescript
// Simple task execution
async function runSearchTask(searchQuery: string): Promise<TaskResult> {
  const agent = getAgent();

  const result = await agent.execute(
    `Go to LinkedIn Jobs. Search for "${searchQuery}". 
     Wait for results to load. Extract the job titles visible on page.`
  );

  return result;
  // {
  //   success: true,
  //   steps: [...],
  //   finalUrl: "https://linkedin.com/jobs/search?...",
  //   finalAnswer: "Found 25 jobs: Software Engineer at Google, ...",
  //   data: undefined
  // }
}

async function runApplyTask(jobUrl: string): Promise<TaskResult> {
  const agent = getAgent();

  const result = await agent.execute(
    `Navigate to ${jobUrl}. 
     Click "Easy Apply" button if available.
     Fill out the application form with my profile information.
     STOP before clicking the final Submit button.`
  );

  return result;
}
```

---

## BrowserContext API

```typescript
import { BrowserContext } from '@riruru/automation-core';

// Create from active tab
const context = await BrowserContext.fromActiveTab();

// Create from specific tab
const context = await BrowserContext.fromTab(tabId);

// Navigation
await context.navigateTo('https://www.linkedin.com/jobs/');

// Tab management
const page = await context.openTab('https://example.com');
await context.switchTab(tabId);
await context.closeTab(tabId);

// Get current page for direct manipulation
const page = await context.getCurrentPage();

// Get browser state (DOM, URL, etc.)
const state = await context.getState();

// Cleanup
await context.cleanup();
```

---

## TaskResult Interface

```typescript
interface TaskResult {
  success: boolean;        // Whether task completed successfully
  error?: string;          // Error message if failed
  steps: StepRecord[];     // History of all steps taken
  finalUrl: string;        // URL when task completed
  finalAnswer?: string;    // LLM's summary of what was done
  data?: unknown;          // Any extracted data
}

interface StepRecord {
  step: number;
  goal: string;            // What the LLM was trying to do
  actions: Array<{
    name: string;          // e.g., 'click_element'
    args: Record<string, unknown>;
    result: ActionResultData;
  }>;
  url: string;
  timestamp: number;
}
```

---

## Event Handling

```typescript
const agent = new AutomationAgent({ ... });

// Subscribe to specific events
agent.on('step', (event) => {
  // Step started or completed
  console.log(`Step ${event.step}/${event.maxSteps}: ${event.details}`);
});

agent.on('action', (event) => {
  // Individual action executed
  console.log(`Action: ${event.action}`);
});

agent.on('error', (event) => {
  // Error occurred
  console.error(`Error: ${event.details}`);
});

agent.on('complete', (event) => {
  // Task finished
  console.log('Task completed');
});

// Subscribe to all events
agent.on('all', (event) => {
  // event.type: 'step_start' | 'step_ok' | 'step_fail' | 
  //             'action_start' | 'action_ok' | 'action_fail' |
  //             'task_start' | 'task_ok' | 'task_fail' | 'task_cancel'
});
```

---

## Job Applier Use Cases

### 1. Job Search & Extraction

```typescript
async function searchJobs(query: string, maxJobs: number): Promise<Job[]> {
  const agent = getAgent();

  const result = await agent.execute(`
    Go to LinkedIn Jobs at https://www.linkedin.com/jobs/.
    Search for "${query}".
    Wait for results to load.
    For each of the first ${maxJobs} job cards visible:
    - Extract the job title, company name, location, and job URL.
    Return the extracted data as a JSON array.
  `);

  if (!result.success) {
    throw new Error(result.error || 'Job search failed');
  }

  // Parse extracted data from finalAnswer or data field
  return parseJobsFromResult(result);
}
```

### 2. Easy Apply Automation

```typescript
async function applyToJob(job: Job, profile: UserProfile): Promise<void> {
  const agent = getAgent();

  await agent.execute(`
    Navigate to ${job.url}.
    Click the "Easy Apply" button.
    
    Fill the application form:
    - First Name: ${profile.firstName}
    - Last Name: ${profile.lastName}
    - Email: ${profile.email}
    - Phone: ${profile.phone}
    
    If there's a resume upload, click the upload button.
    
    IMPORTANT: Do NOT click Submit. Stop before final submission.
  `);
}
```

### 3. Detecting Custom Questions

```typescript
async function detectCustomQuestions(): Promise<string[]> {
  const agent = getAgent();

  const result = await agent.execute(`
    Look at the current application form.
    Identify any custom questions that are NOT standard fields like:
    - First name, last name, email, phone, resume
    
    List all custom questions found with their labels.
  `);

  return parseQuestionsFromResult(result);
}
```

---

## Rate Limiting (Our Implementation)

```typescript
const RATE_LIMITS = {
  MIN_ACTION_DELAY: 500,        // ms between actions
  MIN_PAGE_DELAY: 2000,         // ms after navigation
  MIN_APPLICATION_DELAY: 30000, // ms between applications
  MAX_APPLICATIONS_PER_HOUR: 10,
};

class RateLimiter {
  private applicationCount = 0;
  private hourStart = Date.now();

  async beforeApplication(): Promise<void> {
    // Reset counter every hour
    if (Date.now() - this.hourStart > 3600000) {
      this.applicationCount = 0;
      this.hourStart = Date.now();
    }

    if (this.applicationCount >= RATE_LIMITS.MAX_APPLICATIONS_PER_HOUR) {
      const waitTime = 3600000 - (Date.now() - this.hourStart);
      throw new Error(`Rate limit reached. Wait ${Math.ceil(waitTime / 60000)} minutes.`);
    }

    this.applicationCount++;
  }
}
```

---

## Error Handling

```typescript
type AutomationErrorCode = 
  | 'NAVIGATION_FAILED' 
  | 'ELEMENT_NOT_FOUND' 
  | 'TIMEOUT' 
  | 'BLOCKED' 
  | 'SESSION_EXPIRED'
  | 'MAX_STEPS_REACHED';

class AutomationError extends Error {
  constructor(
    message: string, 
    public code: AutomationErrorCode,
    public screenshot?: string
  ) {
    super(message);
  }
}

// Usage with the library
async function safeExecute(task: string): Promise<TaskResult> {
  const agent = getAgent();

  try {
    const result = await agent.execute(task);
    
    if (!result.success) {
      throw new AutomationError(
        result.error || 'Task failed',
        'NAVIGATION_FAILED'
      );
    }
    
    return result;
  } catch (error) {
    // Handle library errors
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new AutomationError(error.message, 'TIMEOUT');
      }
    }
    throw error;
  }
}
```

---

## LinkedIn Considerations

```typescript
// CAPTCHA detection (check in task or via page evaluation)
async function checkForCaptcha(): Promise<boolean> {
  const context = agent.getBrowserContext();
  if (!context) return false;
  
  const page = await context.getCurrentPage();
  // Use page evaluation to detect CAPTCHA iframes
  // Implementation depends on Page API
  return false;
}

// Session validation
async function isLoggedIn(): Promise<boolean> {
  const agent = getAgent();
  
  const result = await agent.execute(`
    Check if user is logged into LinkedIn.
    Look for profile picture or "Sign In" button.
    Return "LOGGED_IN" or "NOT_LOGGED_IN".
  `);
  
  return result.finalAnswer?.includes('LOGGED_IN') ?? false;
}
```

---

## Manifest Configuration

Add these permissions to your `manifest.json`:

```json
{
  "manifest_version": 3,
  "permissions": [
    "debugger",
    "tabs", 
    "scripting",
    "activeTab",
    "storage"
  ],
  "host_permissions": [
    "https://www.linkedin.com/*"
  ]
}
```

---

## Architecture

```
AutomationAgent (our entry point)
    └── Executor
          ├── NavigatorAgent (LLM-driven decision making)
          │     ├── Prompts (system instructions)
          │     ├── Actions (click, input, scroll, etc.)
          │     └── MessageManager (conversation history)
          └── BrowserContext
                ├── Page (Puppeteer wrapper via CDP)
                └── DOM Services (element extraction)
```

---

## Cleanup

Always cleanup when done:

```typescript
// Stop current execution
await agent.stop();

// Release resources
await agent.cleanup();
```
