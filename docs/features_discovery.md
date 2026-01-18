# Feature: Job Discovery

AI-powered job scanning using browser automation.

---

## Progress

| Task | Status |
|------|--------|
| Automation agent wrapper | ✅ |
| Discovery service | ✅ |
| Background message handling | ✅ |
| Scan Jobs button UI | ✅ |
| Real-time job streaming | ✅ |
| Full-page dashboard (not popup) | ✅ |
| New tab for automation (no black page) | ✅ |
| Element highlighting during automation | ✅ (fixed - buildDomTree.js added) |
| LLM config from settings | ⏳ (using .env for now) |
| LinkedIn job discovery test | ⏳ |

---

## How It Works

### The Complete Call Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER ACTION                                     │
│                     User clicks "Scan Jobs" button                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ScanJobsButton.tsx                                                          │
│  ─────────────────                                                           │
│  handleClick() → calls startDiscovery() from useDiscovery hook               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useDiscovery.ts                                                             │
│  ───────────────                                                             │
│  startDiscovery() → sends chrome message: START_DISCOVERY { maxJobs: 20 }    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  background/index.ts                                                         │
│  ───────────────────                                                         │
│  handleMessage() receives START_DISCOVERY                                    │
│    → checks hasLLMConfig()                                                   │
│    → gets preferences from chrome.storage                                    │
│    → calls startDiscovery({ maxJobs, preferences, searchQuery })             │
│    → returns { success: true } immediately (async, doesn't wait)             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  services/automation/discovery.ts                                            │
│  ────────────────────────────────                                            │
│  startDiscovery()                                                            │
│    → updateState({ status: 'running' })                                      │
│    → buildSearchQuery(preferences) → "software engineer remote"              │
│    → calls initAgent() to create browser automation                          │
│    → buildDiscoveryTask(query, maxJobs) → LLM prompt                         │
│    → calls executeTask(task)                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  services/automation/agent.ts                                                │
│  ────────────────────────────                                                │
│  initAgent()                                                                 │
│    → chrome.tabs.create({ url: 'about:blank' }) → NEW TAB                    │
│    → BrowserContext.fromTab(newTab.id) → CDP connection                      │
│    → new AutomationAgent({ context, llm })                                   │
│                                                                              │
│  executeTask(task)                                                           │
│    → agent.execute(task) → LLM controls browser                              │
│    → LLM navigates to LinkedIn, searches, extracts jobs                      │
│    → returns { success, finalAnswer: "[{title, company, ...}]" }             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  services/automation/discovery.ts (continued)                                │
│  ────────────────────────────────                                            │
│  After executeTask returns:                                                  │
│    → parseJobsFromResult(result.finalAnswer) → Job[]                         │
│    → for each job:                                                           │
│        → createJob(partial) → full Job object with UUID                      │
│        → notifyJobFound(job) → triggers listeners                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  background/index.ts (event listener)                                        │
│  ───────────────────                                                         │
│  onJobFound(async (job) => {                                                 │
│    → addJob(job) → saves to chrome.storage                                   │
│    → broadcastMessage(DISCOVERY_JOB_FOUND, job) → sends to UI                │
│  })                                                                          │
│                                                                              │
│  onStateChange((state) => {                                                  │
│    → broadcastMessage(DISCOVERY_STATE, state) → sends to UI                  │
│  })                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useDiscovery.ts (message listener)                                          │
│  ───────────────                                                             │
│  chrome.runtime.onMessage listens for:                                       │
│    → DISCOVERY_STATE → updates query cache with new status                   │
│    → DISCOVERY_JOB_FOUND → increments jobsFound counter                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useJobs.ts                                                                  │
│  ──────────                                                                  │
│  onStorageChange listens for chrome.storage changes                          │
│    → when jobs array changes, updates query cache                            │
│    → UI re-renders with new jobs                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  JobQueue.tsx → JobCard.tsx                                                  │
│  ──────────────────────────                                                  │
│  Renders job cards from jobs array                                           │
│  User sees jobs appear in real-time as they're discovered                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/
├── background/
│   └── index.ts              # Message handler, event subscriptions
│
├── services/automation/
│   ├── config.ts             # LLM config from env vars
│   ├── types.ts              # DiscoveryState, DiscoveryResult, etc.
│   ├── agent.ts              # AutomationAgent wrapper (initAgent, executeTask)
│   ├── discovery.ts          # High-level orchestration (startDiscovery)
│   └── index.ts              # Exports
│
├── popup/
│   ├── hooks/
│   │   ├── useDiscovery.ts   # Discovery state + actions
│   │   └── useJobs.ts        # Job queue state (TanStack Query)
│   └── components/
│       ├── ScanJobsButton.tsx
│       ├── JobQueue.tsx
│       ├── JobCard.tsx
│       ├── TabBar.tsx
│       └── EmptyState.tsx
│
└── App.tsx                   # Dashboard that uses all above
```

---

## Message Flow

```
┌──────────────┐                    ┌────────────────┐
│   Dashboard  │                    │   Background   │
│   (React)    │                    │   (Service     │
│              │                    │    Worker)     │
└──────┬───────┘                    └───────┬────────┘
       │                                    │
       │  START_DISCOVERY ─────────────────►│
       │  { maxJobs: 20 }                   │
       │                                    │
       │◄───────────────── { success: true }│
       │                                    │
       │                              ┌─────┴─────┐
       │                              │ Discovery │
       │                              │ runs...   │
       │                              └─────┬─────┘
       │                                    │
       │◄──────── DISCOVERY_STATE ──────────│
       │          { status: 'running' }     │
       │                                    │
       │◄──────── DISCOVERY_JOB_FOUND ──────│
       │          { job object }            │
       │                                    │
       │◄──────── DISCOVERY_JOB_FOUND ──────│
       │          { job object }            │
       │                                    │
       │◄──────── DISCOVERY_STATE ──────────│
       │          { status: 'idle' }        │
       │                                    │
```

---

## Key Files Explained

### `background/index.ts`
The central hub. Receives all messages from UI, routes to appropriate handlers.

**What it does:**
1. Subscribes to `onStateChange` and `onJobFound` from discovery service
2. When discovery finds a job → saves to storage → broadcasts to UI
3. Handles `START_DISCOVERY` → calls `startDiscovery()` from automation service
4. Opens full-page dashboard when extension icon clicked

### `services/automation/discovery.ts`
Orchestrates the entire discovery process.

**Key functions:**
- `startDiscovery(options)` — Main entry point. Builds query, inits agent, runs task, parses results
- `buildSearchQuery(preferences)` — Turns user prefs into search string
- `buildDiscoveryTask(query, maxJobs)` — Creates the LLM prompt
- `parseJobsFromResult(answer)` — Extracts JSON from LLM response
- `onJobFound(listener)` / `onStateChange(listener)` — Event subscriptions

### `services/automation/agent.ts`
Thin wrapper around `@riruru/automation-core`.

**Key functions:**
- `initAgent(tabId?)` — Creates new tab, connects CDP, initializes AutomationAgent
- `executeTask(task)` — Runs natural language task through the agent
- `stopAgent()` / `cleanupAgent()` — Lifecycle management

### `useDiscovery.ts`
React hook for discovery UI state.

**What it does:**
1. Fetches initial state from background via `DISCOVERY_STATE` message
2. Listens for push updates via `chrome.runtime.onMessage`
3. Provides `startDiscovery()` and `stopDiscovery()` actions
4. State stored in TanStack Query cache

### `useJobs.ts`
React hook for job queue.

**What it does:**
1. Fetches jobs from storage via TanStack Query
2. Listens for storage changes (jobs added by background)
3. Provides `updateStatus()` with optimistic updates

---

## Discovery States

| State | Meaning | Triggered By |
|-------|---------|--------------|
| `idle` | Not running | Initial, or after completion/stop |
| `running` | Actively scanning | After `startDiscovery()` called |
| `paused` | Temporarily paused | (Not used yet) |
| `error` | Failed with error | LLM error, network error |
| `captcha` | CAPTCHA detected | LLM reports "captcha" in response |
| `login_required` | LinkedIn login needed | LLM reports "login_required" |

---

## Why Two Tabs?

When discovery starts, it opens a **new tab** for automation. This is intentional:

```
Tab 1: Dashboard (React app)     Tab 2: Automation (LinkedIn)
┌─────────────────────────┐     ┌─────────────────────────┐
│                         │     │                         │
│  Job Applier Dashboard  │     │  LinkedIn Jobs          │
│                         │     │  [1] Search box         │
│  [Scanning... 3 found]  │     │  [2] Job card           │
│                         │     │  [3] Job card           │
│  ┌─────────────────┐    │     │                         │
│  │ Job 1           │    │     │  AI is clicking [2]...  │
│  │ Job 2           │    │     │                         │
│  │ Job 3           │    │     │                         │
│  └─────────────────┘    │     │                         │
│                         │     │                         │
└─────────────────────────┘     └─────────────────────────┘
```

If we used the same tab, the dashboard would go black during automation.

---

## LLM Configuration

Currently uses environment variables (TODO: move to Settings UI):

```env
VITE_LLM_PROVIDER=anthropic
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_LLM_MODEL=claude-sonnet-4-20250514
```

---

## Dependencies

- `src/lib/automation-core` — Internal browser automation library with LLM (not an npm package)
- `@tanstack/react-query` — Data fetching and caching
- `puppeteer-core` — CDP browser control (peer dep)

### Required Static Files

- `public/buildDomTree.js` — DOM extraction script (copied from automation-core package)
  - This file is injected into web pages to extract interactive elements
  - Creates visual highlight overlays with numbered indices
  - Required for the LLM to "see" what elements are clickable

---

## How the Internal automation-core Library Works

This is the internal AI agent library (located at `src/lib/automation-core/`) that powers the browser automation. Understanding this is key to extending the feature.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AutomationAgent                                    │
│  ─────────────────────────────────────────────────────────────────────────  │
│  High-level wrapper. You call agent.execute("task") and get results.        │
│                                                                              │
│    ┌─────────────────────────────────────────────────────────────────────┐  │
│    │                          Executor                                    │  │
│    │  ───────────────────────────────────────────────────────────────── │  │
│    │  Runs the step loop. Each step = 1 LLM call + N actions.            │  │
│    │                                                                      │  │
│    │  while (!done && !stopped && steps < maxSteps) {                     │  │
│    │    result = await navigator.execute()  // Ask LLM what to do         │  │
│    │    if (result.done) break                                            │  │
│    │  }                                                                   │  │
│    │                                                                      │  │
│    │    ┌─────────────────────────────────────────────────────────────┐  │  │
│    │    │                   NavigatorAgent                             │  │  │
│    │    │  ─────────────────────────────────────────────────────────  │  │  │
│    │    │  Makes LLM calls, decides actions, executes them.            │  │  │
│    │    │                                                              │  │  │
│    │    │  1. Get page state (DOM elements, URL, etc.)                 │  │  │
│    │    │  2. Build prompt with state + history + task                 │  │  │
│    │    │  3. Call LLM → get actions (click, type, scroll, etc.)       │  │  │
│    │    │  4. Execute each action via BrowserContext                   │  │  │
│    │    │  5. Return result (success/fail, done flag, extracted data)  │  │  │
│    │    └─────────────────────────────────────────────────────────────┘  │  │
│    └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│    ┌─────────────────────────────────────────────────────────────────────┐  │
│    │                       BrowserContext                                 │  │
│    │  ───────────────────────────────────────────────────────────────── │  │
│    │  Manages browser tabs and pages via Chrome DevTools Protocol (CDP)  │  │
│    │                                                                      │  │
│    │  - fromTab(tabId) → Attach to existing tab                          │  │
│    │  - navigateTo(url) → Navigate current page                          │  │
│    │  - openTab(url) → Open new tab                                      │  │
│    │  - getCurrentPage() → Get Page wrapper for DOM access               │  │
│    │  - cleanup() → Detach from all tabs                                 │  │
│    │                                                                      │  │
│    │    ┌─────────────────────────────────────────────────────────────┐  │  │
│    │    │                        Page                                  │  │  │
│    │    │  ─────────────────────────────────────────────────────────  │  │  │
│    │    │  Wraps a single tab. Handles DOM extraction, actions.        │  │  │
│    │    │                                                              │  │  │
│    │    │  - getState() → Extract interactive elements from DOM        │  │  │
│    │    │  - click(selector) → Click element                           │  │  │
│    │    │  - type(selector, text) → Type into input                    │  │  │
│    │    │  - highlight(elements) → Show visual indicators              │  │  │
│    │    └─────────────────────────────────────────────────────────────┘  │  │
│    └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### The Step Loop (Core Execution)

The agent runs in a **step loop**. Each step:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 1                                                                      │
├────────────────────────────────────────────────────────────────────────────┤
│ 1. Get browser state                                                        │
│    └── Extract all clickable/interactive elements from DOM                  │
│    └── Get current URL, page title                                          │
│                                                                             │
│ 2. Build LLM prompt                                                         │
│    └── System: "You are a browser automation agent..."                      │
│    └── User: "Task: {task}\nCurrent page: {elements}\nHistory: {steps}"     │
│                                                                             │
│ 3. Call LLM                                                                 │
│    └── Returns structured JSON with actions to take                         │
│    └── Example: { actions: [{ click_element: { index: 5 } }] }              │
│                                                                             │
│ 4. Execute actions                                                          │
│    └── For each action, call the corresponding browser method               │
│    └── click_element → page.click(element[5])                               │
│    └── input_text → page.type(element[3], "software engineer")              │
│                                                                             │
│ 5. Check if done                                                            │
│    └── LLM can return { done: true, extractedContent: "..." }               │
│    └── If done, exit loop and return result                                 │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ STEP 2 (if not done)                                                        │
│ ...repeat...                                                                │
└────────────────────────────────────────────────────────────────────────────┘
```

### Available Actions

The LLM can choose from these actions each step:

| Action | Description | Example Args |
|--------|-------------|--------------|
| `click_element` | Click an element by index | `{ index: 5 }` |
| `input_text` | Type text into an input | `{ index: 3, text: "hello" }` |
| `go_to_url` | Navigate to URL | `{ url: "https://..." }` |
| `go_back` | Browser back button | `{}` |
| `scroll_down` / `scroll_up` | Scroll the page | `{ amount: 500 }` |
| `scroll_to_element` | Scroll element into view | `{ index: 7 }` |
| `send_keys` | Send keyboard keys | `{ keys: "Enter" }` |
| `wait` | Wait for page load | `{ seconds: 2 }` |
| `open_tab` | Open new tab | `{ url: "https://..." }` |
| `switch_tab` | Switch to tab | `{ tabId: 123 }` |
| `close_tab` | Close a tab | `{ tabId: 123 }` |
| `get_dropdown_options` | Get select options | `{ index: 4 }` |
| `select_dropdown_option` | Select an option | `{ index: 4, option: "value" }` |
| `done` | Task complete | `{ success: true, text: "result" }` |

### Event System

The agent emits events you can subscribe to:

```typescript
agent.on('step', (event) => {
  // Fired at start/end of each step
  // event.type: 'step_start' | 'step_ok' | 'step_fail'
  // event.step: 1, 2, 3...
  // event.maxSteps: 50
});

agent.on('action', (event) => {
  // Fired for each action execution
  // event.type: 'action_start' | 'action_ok' | 'action_fail'
  // event.action: 'click_element'
});

agent.on('error', (event) => {
  // Fired on task failure
  // event.type: 'task_fail'
  // event.details: 'Error message'
});

agent.on('complete', (event) => {
  // Fired on task success
  // event.type: 'task_ok'
});

agent.on('all', (event) => {
  // Receives ALL events
});
```

### Task Result Structure

When `agent.execute(task)` completes:

```typescript
interface TaskResult {
  success: boolean;           // Did the task complete successfully?
  error?: string;             // Error message if failed
  steps: StepRecord[];        // History of all steps taken
  finalUrl: string;           // URL when task ended
  finalAnswer?: string;       // Extracted content (e.g., JSON with jobs)
  data?: unknown;             // Additional structured data
}

interface StepRecord {
  step: number;               // Step number (1, 2, 3...)
  goal: string;               // What the LLM was trying to do
  actions: Array<{
    name: string;             // 'click_element', 'input_text', etc.
    args: Record<string, unknown>;
    result: ActionResultData;
  }>;
  url: string;                // URL at this step
  timestamp: number;          // When step occurred
}
```

---

## Cancellation (How stop() Works)

The agent supports clean cancellation via `agent.stop()`.

### The Cancellation Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│ User clicks "Stop" button in UI                                             │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ useDiscovery.stopDiscovery()                                                │
│   → sends STOP_DISCOVERY message to background                              │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ background/index.ts                                                         │
│   → calls stopDiscovery() from services/automation                          │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ discovery.ts stopDiscovery()                                                │
│   → calls stopAgent() from agent.ts                                         │
│   → updates state to 'idle'                                                 │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ agent.ts stopAgent()                                                        │
│   → calls agent.stop()                                                      │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ AutomationAgent.stop()                                                      │
│   → calls executor.stop()                                                   │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Executor.stop()                                                             │
│   → sets context.stopped = true                                             │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Step loop checks shouldStop() at start of each iteration:                   │
│                                                                             │
│   while (!context.shouldStop() && !isDone) {                                │
│     await executeStep();  // <── If stopped, this loop exits                │
│   }                                                                         │
│                                                                             │
│   shouldStop() returns true if:                                             │
│     - context.stopped === true  (user cancelled)                            │
│     - nSteps >= maxSteps        (hit step limit)                            │
│     - consecutiveFailures >= maxFailures (too many errors)                  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Executor returns result:                                                    │
│                                                                             │
│   if (context.stopped) {                                                    │
│     context.emitEvent('task_cancel', 'Task was cancelled');                 │
│     return { success: false, error: 'Task was cancelled' };                 │
│   }                                                                         │
└────────────────────────────────────────────────────────────────────────────┘
```

### Key Points About Cancellation

1. **Non-blocking**: `stop()` just sets a flag. It doesn't wait for the current step to finish.

2. **Checked between steps**: The flag is checked at the START of each step loop iteration. 
   - If the LLM is mid-response, it will finish that step before stopping.
   - If an action is being executed, it will complete before stopping.

3. **Clean exit**: When stopped, the agent emits `task_cancel` event and returns a result with `success: false`.

4. **Cleanup still needed**: After stopping, you should still call `cleanupAgent()` to release CDP connections.

### Current Implementation in Our Code

```typescript
// agent.ts
export async function stopAgent(): Promise<void> {
  if (agent) {
    await agent.stop();  // Sets the stopped flag
  }
}

// discovery.ts
export async function stopDiscovery(): Promise<void> {
  if (discoveryState.status === 'running') {
    await stopAgent();                    // Tell agent to stop
    updateState({ status: 'idle' });      // Update our state
  }
}

// background/index.ts
case 'STOP_DISCOVERY': {
  await stopDiscovery();
  return { success: true };
}
```

### Timing Considerations

```
Timeline when user clicks Stop:
────────────────────────────────────────────────────────────────────────────
                         │
Step 3 starts            │ User clicks Stop
LLM thinking...          │ stop() called → stopped = true
LLM returns actions      │
Actions execute          │
Step 3 ends              │
                         ▼
────────── shouldStop() ─── returns TRUE ─── loop exits ────────────────────
                                             │
                                             ▼
                                    Returns cancelled result
```

The step that was in progress WILL complete. Cancellation happens between steps.

---

## Adding Custom Tasks

To add a new automation task (e.g., auto-apply to jobs):

### 1. Create a task builder function

```typescript
// In a new file: services/automation/apply.ts

function buildApplyTask(jobUrl: string, userData: UserData): string {
  return `
Apply to the job at ${jobUrl}:

1. Navigate to the job page
2. Click "Easy Apply" button
3. Fill in the application form:
   - Name: ${userData.name}
   - Email: ${userData.email}
   - Phone: ${userData.phone}
4. Upload resume if prompted
5. Submit the application
6. Confirm success

Return result as JSON: { "success": true/false, "message": "..." }
If you encounter errors, report them in the message field.
`.trim();
}
```

### 2. Create the service function

```typescript
export async function applyToJob(
  jobUrl: string, 
  userData: UserData
): Promise<ApplyResult> {
  // Initialize agent (opens new tab)
  await initAgent();
  
  // Subscribe to events if needed
  const unsubscribe = onDiscoveryEvent((event) => {
    if (event.type === 'step') {
      console.log(`Apply step ${event.payload.step}`);
    }
  });
  
  try {
    // Build and execute task
    const task = buildApplyTask(jobUrl, userData);
    const result = await executeTask(task);
    
    unsubscribe();
    
    // Parse result
    return parseApplyResult(result);
  } finally {
    await cleanupAgent();
  }
}
```

### 3. Wire to background message handler

```typescript
// In background/index.ts

case 'APPLY_TO_JOB': {
  const { jobUrl, userData } = message.payload;
  
  // Start application (async)
  applyToJob(jobUrl, userData)
    .then((result) => {
      broadcastMessage(createMessage('APPLY_RESULT', result));
    })
    .catch((err) => {
      broadcastMessage(createMessage('APPLY_ERROR', { error: err.message }));
    });
  
  return { success: true, message: 'Application started' };
}
```

### 4. Add UI trigger

```typescript
// In a component

const handleApply = async (job: Job) => {
  const userData = await getUserData();
  await chrome.runtime.sendMessage({
    type: 'APPLY_TO_JOB',
    payload: { jobUrl: job.url, userData }
  });
};
```

---

## Known Issues

### Highlighting Not Working

**Status**: ✅ **FIXED** (2026-01-17)

The `buildDomTree.js` file is now included in:
1. Internal `src/lib/automation-core/` library
2. This extension's `public/` folder

**What was fixed**:
- Added `buildDomTree.js` to the internal automation-core library
- Copied the file to `public/buildDomTree.js` so Vite includes it in dist

**If you update the automation-core library**, remember to copy the updated `buildDomTree.js`:
```bash
cp src/lib/automation-core/buildDomTree.js public/
```

---

## Debugging

1. Go to `chrome://extensions`
2. Find "Job Applier" → click **"service worker"**
3. Look for logs:
   - `[Background] START_DISCOVERY received`
   - `[Discovery] Starting discovery with:`
   - `[Agent] Initializing...`
   - `[Discovery] Task result:`

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-01-17 | Fixed buildDomTree.js - added to automation-core package and public folder |
| 2026-01-16 | Rewrote docs to show complete call flow |
| 2026-01-16 | Updated hooks to use TanStack Query |
| 2026-01-15 | Initial implementation |
