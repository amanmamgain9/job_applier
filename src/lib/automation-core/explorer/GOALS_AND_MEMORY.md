# Recipe Generation System

Technical documentation for the task automation system.

---

## Overview

The system automates web tasks through two phases:

| Phase | Purpose |
|-------|---------|
| 1. Discovery | Learn how to do the task |
| 2. Recipe Generation | Convert learnings into replayable steps |

---

## Architecture

```
Manager (coordinates phases)
    │
    ├── Manager Memory
    │     └── task, goals, phase results, recipe
    │
    ├── Discovery (Phase 1) ─── runs its own loop
    │     │
    │     ├── DiscoverEventLog
    │     │     └── DiscoveryEvent[] + currentPageKey
    │     │
    │     ├── Step Decider (per-step decision: explore/done)
    │     │
    │     └── Sub-agents:
    │           ├── Analyzer (visual diff after actions)
    │           └── Summarizer (consolidate observations at finish)
    │
    ├── Recipe Generation (Phase 2) [not yet implemented]
    │     └── Composer (generates steps)
    │
    └── Page (browser interface)
          └── dom/service (DOM utilities)
```

**Flow:**
1. Manager calls Discovery (passes task, goals)
2. Discovery runs its exploration loop (many steps, uses own memory)
3. Discovery returns `ExplorationResult` to Manager
4. Manager saves result to its memory
5. Manager calls Composer to generate recipe

---

## Memory Model

Each agent owns its memory and decides what to save.

### Manager Memory

```typescript
interface ManagerMemory {
  task: string;
  goals: string[];
  
  // Results from phases
  discoveryResult?: ExplorationResult;
  recipe?: Recipe;
  
  // Execution state
  currentPhase: 'discovery' | 'recipe_generation' | 'done';
}
```

**What Manager saves:**
- Task and goals (received from user)
- Results returned by each phase
- Current phase state

---

### DiscoverEventLog

```typescript
// DiscoverEventLog is the single source of truth for Discovery state
interface DiscoverEventLog {
  events: DiscoveryEvent[];            // event log (what happened)
  currentPageKey: string | null;
}
```

**What Discovery saves:**
- Event log (all sub-agent outputs + URLs + screenshots inside analyzer/page-change events)
- Current page key (for tagging events)

---

### Sub-Agent Memory

Sub-agents are currently **stateless** — they take input and return output without persisting state.

| Sub-Agent | Located | State |
|-----------|---------|-------|
| Analyzer | `agents/discovery/analyzer-agent.ts` | Stateless |
| PageMatch | `agents/discovery/page-match-agent.ts` | Stateless |
| Summarizer | `agents/discovery/summarizer-agent.ts` | Stateless |

Discovery records sub-agent outputs as events in the event log.

---

## Handoff Contracts

Every agent/sub-agent call must include a **goal**. This is the minimum contract.

### Contract Structure

```typescript
// Input (calling an agent)
interface HandoffInput<TContext = unknown> {
  goal: string;                // REQUIRED: what we want to achieve
  context?: TContext;          // optional: additional context
}

// Output (agent returns)
interface HandoffOutput<TResult = unknown> {
  goalCompleted: boolean;      // REQUIRED: did we achieve the goal?
  result?: TResult;            // optional: what we produced
  reason?: string;             // optional: why goal failed (if not completed)
}
```

### Handoffs

| From | To | Goal Example | Returns |
|------|----|--------------|---------|
| Manager | Discovery | "Learn how to find job listings" | goalCompleted + ExplorationResult |
| Manager | Composer | "Generate replayable recipe" | goalCompleted + Recipe |
| Discovery | Analyzer | "Describe what changed after click" | goalCompleted + summary |
| Discovery | PageMatch | "Is this the same page?" | goalCompleted + isSamePage |
| Discovery | Summarizer | "Consolidate observations for page" | goalCompleted + summary |

### Why Goal Only?

- **Not brittle**: Agents can evolve their internal logic
- **Clear intent**: Every call has explicit purpose
- **Debuggable**: Easy to trace what each step was trying to do
- **Flexible**: Context can vary, goal stays consistent

### Example Handoff

```typescript
// Manager → Discovery
const result = await runDiscovery({
  goal: "Learn how to find software engineer jobs in Seattle",
  context: {
    page,
    llm,
    apiKey,
    goals: ["find job listings", "locate apply button"]
  }
});
// result: { goalCompleted: true, result: ExplorationResult }
// or:     { goalCompleted: false, reason: "Login required" }

// Discovery → Analyzer
const analysis = await runAnalyzer({
  goal: "Describe what changed after clicking job card",
  context: {
    apiKey,
    action: "click job card",
    beforeUrl, afterUrl,
    beforeScreenshot, afterScreenshot
  }
});
// analysis: { goalCompleted: true, result: { summary, urlChanged, significantChange } }
```

---

## Page (Browser Interface)

The `Page` class wraps Puppeteer and provides:

- Navigation (go to URL)
- Actions (click, scroll, type)
- Screenshot capture
- DOM tree extraction
- Clickable element detection

Located: `browser/page.ts`

Internally uses:
- `dom/service` — DOM parsing, injects `buildDomTree.js` into tabs
- `dom/clickable/service` — Element detection

---

## File Structure

```
automation-core/
├── explorer/
│   ├── manager.ts                ─ Manager class (coordinates phases)
│   └── index.ts                  ─ Exports
│
├── agents/discovery/
│   ├── discovery-agent.ts        ─ Discovery loop + step decider (Phase 1)
│   ├── analyzer-agent.ts         ─ Visual diff after actions
│   ├── page-match-agent.ts       ─ Same-page detection (screenshot compare)
│   ├── summarizer-agent.ts       ─ Consolidates observations
│   ├── discover-event-log.ts     ─ Discovery event log (single source of truth)
│   ├── memory/
│   │   └── types.ts              ─ DiscoveryEvent + ExplorationResult
│   ├── types/
│   │   └── handoff.ts            ─ HandoffInput/HandoffOutput contracts
│   └── index.ts                  ─ Exports
│
└── browser/
    ├── page.ts                   ─ Page class (browser interface)
    └── dom/service.ts            ─ DOM utilities
```

---

## Phase 1: Discovery

Discovery is an agent that runs its own exploration loop, coordinating sub-agents to learn how to complete a task.

### Entry Point

Manager calls `runDiscovery()`. Located: `agents/discovery/discovery-agent.ts`

```typescript
interface DiscoveryContext {
  page: Page;
  goals?: string[];
  llm: BaseChatModel;
  apiKey: string;
  model?: string;
  report?: ReportService;
  maxSteps?: number;  // default: 20
}

// Called via handoff contract
const result = await runDiscovery({
  goal: "Learn how to find job listings",
  context: discoveryContext
});
```

### Discovery Loop

```
runDiscovery(task, goals)
    │
    ├── Initialize
    │     page.getState() → DOM + URL
    │     eventLog.setCurrent(pageKey) + record initial analyzer event
    │
    └── while (stepCount < maxSteps)
          │
          ├── Step Decider decides: explore() or done()
          │     (sees: task, goals, DOM, event-log summary, recent events)
          │
          ├── if done() → finishExploration()
          │                 └── for each page: Summarizer
          │                 └── return ExplorationResult to Manager
          │
          └── if explore() → executeAndAnalyze()
                │
                ├── page.takeScreenshot() → before
                ├── page.executeAction()
                ├── page.takeScreenshot() → after
                ├── page.getState() → new DOM
                │
                └── Analyzer + PageMatch
                      │
                      └── record analyzer/page-change event in log
```

### Handoff to Manager

When Discovery finishes, it returns `ExplorationResult` to Manager:

```
Discovery ─── done() ──→ ExplorationResult ──→ Manager ──→ Phase 2
```

---

## Discovery Sub-Agents

Discovery coordinates two sub-agents. Each is a **single LLM call** with a goal.

### Analyzer

**Role:** Describes what changed and whether the page/state fundamentally shifted.

**Located:** `agents/discovery/analyzer-agent.ts`

**Called by:** Discovery loop (after each action)

**Handoff:**
```typescript
type DiscoveryAnalyzerContext = {
  apiKey: string;
  model?: string;
  action: string;
  beforeUrl: string;
  afterUrl: string;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
};

type DiscoveryAnalyzerHandoff = HandoffInput<DiscoveryAnalyzerContext>;
```

**Output:**
```typescript
type DiscoveryAnalyzerResult = {
  summary: string;              // human-readable change summary
  urlChanged: boolean;          // did URL change?
  significantChange: boolean;   // did page/state fundamentally change?
};

type DiscoveryAnalyzerOutput = HandoffOutput<DiscoveryAnalyzerResult>;
```

---

### Page Match Agent

Determines if two page states are the same page key using screenshots + URLs.

```typescript
type PageMatchContext = {
  apiKey: string;
  model?: string;
  beforeUrl: string;
  afterUrl: string;
  beforeScreenshot: string;
  afterScreenshot: string;
};

type PageMatchResult = {
  isSamePage: boolean;
  reason: string;
};

type PageMatchOutput = HandoffOutput<PageMatchResult>;
```

**Significant change** means the page's functional state changed enough that Discovery should treat it as a new step in the path. This can happen:
- without URL change (SPA state swap, modal → full page, panel replaces list)
- with URL change but still same component/state (e.g., pagination, filters)

---

### Summarizer

**Role:** Consolidates observations into page understanding.

**Located:** `agents/discovery/summarizer-agent.ts`

**Called by:** Discovery loop (at finish, for each page)

**Handoff:**
```typescript
type DiscoverySummarizerContext = {
  llm: BaseChatModel;
  pageKey: string;
  observations: string[];
  currentUnderstanding: string;
};

type DiscoverySummarizerHandoff = HandoffInput<DiscoverySummarizerContext>;
```

**Output:**
```typescript
type DiscoverySummarizerResult = {
  pageKey: string;
  summary: string;
};

type DiscoverySummarizerOutput = HandoffOutput<DiscoverySummarizerResult>;
```

---

## Step Decider (Internal)

Located: `agents/discovery/discovery-agent.ts` (internal function)

Each step, the Step Decider looks at context and decides: **explore** or **done**.

Uses Gemini with function calling:
- Tools: `explore(action, target, reason)` and `done(understanding)`
- Mode: `FunctionCallingMode.ANY` (must call a tool)

**Step Decider Context (internal):**
```typescript
interface DiscoveryAgentContext {
  apiKey: string;
  model?: string;
  task: string;
  goals?: string[];
  currentDom: string;
  memorySummary: string;
  actionHistory: DiscoveryEvent[];
}
```

**Agent Output:**
```typescript
type DiscoveryAction =
  | { type: 'explore'; action: 'click' | 'scroll_down' | 'scroll_up'; target?: string; reason: string }
  | { type: 'done'; understanding: string };

interface DiscoveryDecision {
  action: DiscoveryAction;
}

// Step Decider returns
type StepDeciderOutput = HandoffOutput<DiscoveryDecision>;
```

---

## Discovery Step Detail

### Per-Step Flow

```
Step N:
┌─────────────────────────────────────────────────────────────────┐
│ Discovery Loop (discovery-agent.ts)                             │
│   │                                                             │
│   ├─→ Step Decider (Gemini function call)                       │
│   │     input: task, goals, DOM, event-log summary, recent events│
│   │     output: explore(click, "#btn", "why") or done()         │
│   │                                                             │
│   ├─→ page.takeScreenshot() → beforeScreenshot                  │
│   ├─→ page.executeAction({ action: "click", target: "#btn" })   │
│   ├─→ page.takeScreenshot() → afterScreenshot                   │
│   ├─→ page.getState() → newDom, newUrl                          │
│   │                                                             │
│   ├─→ Analyzer + PageMatch                                      │
│   │     └── returns: { summary, urlChanged, significantChange } │
│   │                                                             │
│   └─→ record analyzer/page-change event in log                  │
└─────────────────────────────────────────────────────────────────┘
```

### Finish Flow

```
Step Decider decides done():
┌─────────────────────────────────────────────────────────────────┐
│ finishExploration() in discovery-agent.ts                       │
│   │                                                             │
│   ├─→ for each pageKey in event log:                            │
│   │     └─→ Summarizer(llm, pageKey, observations)              │
│   │           └── record summarizer event                       │
│   │                                                             │
│   └─→ return ExplorationResult to Manager                       │
│         { success, pageKeys, events, finalUnderstanding }       │
└─────────────────────────────────────────────────────────────────┘
```

### Full Flow (Manager → Discovery → Manager)

```
┌──────────┐                      ┌─────────────────────────────┐
│ Manager  │ ─── run Discovery ──→│ Discovery Loop              │
└──────────┘                      │   ├── Agent decides         │
     ▲                            │   ├── Page.execute()        │
     │                            │   ├── Analyzer/PageMatch    │
     │                            │   └── Record event          │
     │                            │                             │
     │                            │   ... repeats until done    │
     │                            │                             │
     │                            │   Summarizer (per page)     │
     │                            └──────────────┬──────────────┘
     │                                           │
     └──── ExplorationResult ────────────────────┘
```

---

## Discovery State (Detail)

Discovery’s state is a single `DiscoverEventLog`.

```typescript
interface DiscoverEventLog {
  events: DiscoveryEvent[];      // event log
  currentPageKey: string | null; // for tagging events
}
```

---
Key elements were removed from the Discovery output.

### ExplorationResult

Final payload from Phase 1 Discovery:

```typescript
interface ExplorationResult {
  success: boolean;
  pageKeys: string[];
  events: DiscoveryEvent[];
  finalUnderstanding: string;
  error?: string;
}
```

---

## Multi-Page Navigation

When URL changes, Discovery resolves the page key:
1. Page Match Agent compares screenshots vs existing pages
2. If match: reuse page key; else create new key with LLM id
3. Record `fromPageKey`/`toPageKey` on the page-change event and switch current page key

---

## Phase 2: Recipe Generation

### Step Structure

```typescript
type Step = {
  navigate?: string;
  onThisPage?: string;
  repeatable?: boolean;
  patternConfirmed?: boolean;
  collectsFor?: string;
  nextStep?: Step;
}
```

### Example Recipe

```
{
  navigate: "linkedin.com/jobs",
  nextStep: {
    onThisPage: "Search form. Fill job title and location, submit.",
    nextStep: {
      onThisPage: "Job cards. Click one to see details.",
      repeatable: true,
      patternConfirmed: true,
      nextStep: {
        onThisPage: "Job detail. Apply button is here.",
        collectsFor: "apply_links",
        nextStep: null
      }
    }
  }
}
```

---

## Pattern Confirmation

1. Execute action via Page
2. Observe via Analyzer
3. Record event in event log (sub-agent outputs + URLs + screenshots)
4. After 2+ observations of same pattern → `confirmed: true`

Navigation links are reliable for recipe generation.

---

## Exit Conditions

| Condition | Trigger |
|-----------|---------|
| Goal achievable | Discovery decides `done()` |
| Stuck | Discovery can't find relevant actions |
| Blocked | Needs user input (login, captcha) |
| Max steps | Safety limit reached (default: 20) |

---

## Summary

### Execution Model

- **Manager** coordinates phases (calls Discovery, then Composer)
  - Has its own memory (task, goals, phase results)
- **Discovery** runs its own loop:
  - Has its own memory (DiscoverEventLog with events + currentPageKey)
  - Agent decides explore/done each step
  - **Analyzer** — visual diff (stateless)
  - **Summarizer** — consolidates observations (stateless)

### Phase 1 Flow

```
Manager
  └─→ runDiscovery(task, goals)
        │
        └── Discovery Loop (many steps)
              ├── Step Decider → explore/done
              ├── Page.executeAction()
              ├── Analyzer + PageMatch
              └── Record event to DiscoverEventLog
        │
        └── Summarizer (per page)
        │
        └── return ExplorationResult
```

### Phase 2 Flow (planned)

```
Manager
  └─→ Composer.run(ExplorationResult)
        └── return Recipe
```

### Multi-Page Wiring

URL changes now produce new page keys and event-log entries via page-change events.
