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
| Element highlighting during automation | ✅ (built-in) |
| LLM config from settings | ⏳ (using .env for now) |
| Actual LinkedIn scraping test | ⏳ |

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

- `@riruru/automation-core` — Browser automation with LLM
- `@tanstack/react-query` — Data fetching and caching
- `puppeteer-core` — CDP browser control (peer dep)

---

## Debugging

Check the background service worker console:

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
| 2026-01-16 | Rewrote docs to show complete call flow |
| 2026-01-16 | Updated hooks to use TanStack Query |
| 2026-01-15 | Initial implementation |
