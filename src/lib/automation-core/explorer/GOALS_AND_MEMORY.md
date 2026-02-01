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
    │     ├── Discovery Memory
    │     │     └── PageNodes, Edges, Patterns, actionHistory
    │     │
    │     └── Sub-agents:
    │           ├── DiscoveryAnalyzer (visual diff after actions)
    │           └── DiscoverySummarizer (consolidate observations at finish)
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

### Discovery Memory

```typescript
interface DiscoveryMemory {
  // Page graph
  pages: Map<string, PageNode>;
  currentPageId: string;
  
  // Navigation
  navigationPath: string[];
  actionHistory: string[];
  
  // Observations
  pendingObservations: string[];
}
```

**What Discovery saves:**
- PageNodes with patterns and edges (learned behaviors)
- Action history (what was tried, what happened)
- Navigation path (how we got here)

---

### Sub-Agent Memory

Sub-agents are currently **stateless** — they take input and return output without persisting state.

| Sub-Agent | Located | State |
|-----------|---------|-------|
| DiscoveryAnalyzer | `agents/discovery-analyzer.ts` | Stateless |
| DiscoverySummarizer | `agents/discovery-summarizer.ts` | Stateless |

Discovery ingests sub-agent outputs into DiscoveryMemory (via `memory.addObservation()`).

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
| Discovery | DiscoveryAnalyzer | "Describe what changed after click" | goalCompleted + summary |
| Discovery | DiscoverySummarizer | "Consolidate observations for page" | goalCompleted + summary |

### Why Goal Only?

- **Not brittle**: Agents can evolve their internal logic
- **Clear intent**: Every call has explicit purpose
- **Debuggable**: Easy to trace what each step was trying to do
- **Flexible**: Context can vary, goal stays consistent

### Example Handoff

```typescript
// Manager → Discovery
const result = await discovery.run({
  goal: "Learn how to find software engineer jobs in Seattle",
  context: {
    startUrl: "linkedin.com/jobs",
    criteria: { title: "Software Engineer", location: "Seattle" }
  }
});
// result: { goalCompleted: true, result: ExplorationResult }
// or:     { goalCompleted: false, reason: "Login required" }

// Discovery → DiscoveryAnalyzer
const analysis = await discoveryAnalyzer.run({
  goal: "Describe what changed after clicking job card",
  context: {
    beforeScreenshot,
    afterScreenshot,
    action: "click job card"
  }
});
// analysis: { goalCompleted: true, result: { summary, urlChanged } }
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
explorer/
├── manager.ts                    ─ Manager class (coordinates phases)
├── discovery-loop.ts             ─ Discovery loop (Phase 1)
├── agents/
│   ├── discovery-agent.ts        ─ Per-step decision maker
│   ├── discovery-analyzer.ts     ─ Visual diff after actions
│   └── discovery-summarizer.ts   ─ Consolidates observations
├── memory/
│   ├── store.ts                  ─ MemoryStore class
│   └── types.ts                  ─ PageNode, Edge, etc.
├── types/
│   └── handoff.ts                ─ HandoffInput/HandoffOutput contracts
└── index.ts                      ─ Exports
```

---

## Phase 1: Discovery

Discovery is an agent that runs its own exploration loop, coordinating sub-agents to learn how to complete a task.

### Entry Point

Manager calls `runDiscoveryLoop()`. Located: `explorer/discovery-loop.ts`

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
const result = await runDiscoveryLoop({
  goal: "Learn how to find job listings",
  context: discoveryContext
});
```

### Discovery Loop

```
Discovery.run(task, goals)
    │
    ├── Initialize
    │     page.getState() → DOM + URL
    │     memory.initializePage(pageId, task, url)
    │
    └── while (stepCount < maxSteps)
          │
          ├── Discovery Agent decides: explore() or done()
          │     (sees: task, goals, DOM, memory, action history)
          │
          ├── if done() → finishExploration()
          │                 └── for each page: DiscoverySummarizer
          │                 └── return ExplorationResult to Manager
          │
          └── if explore() → executeAndAnalyze()
                │
                ├── page.takeScreenshot() → before
                ├── page.click/scroll()
                ├── page.takeScreenshot() → after
                ├── page.getState() → new DOM
                │
                └── DiscoveryAnalyzer(before, after)
                      │
                      └── memory.addObservation(summary)
```

### Handoff to Manager

When Discovery finishes, it returns `ExplorationResult` to Manager:

```
Discovery ─── done() ──→ ExplorationResult ──→ Manager ──→ Phase 2
```

---

## Discovery Sub-Agents

Discovery coordinates two sub-agents. Each is a **single LLM call** with a goal.

### DiscoveryAnalyzer

**Role:** Describes what changed and whether the page/state fundamentally shifted.

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

**Significant change** means the page's functional state changed enough that Discovery should treat it as a new step in the path. This can happen:
- without URL change (SPA state swap, modal → full page, panel replaces list)
- with URL change but still same component/state (e.g., pagination, filters)

---

### DiscoverySummarizer

**Role:** Consolidates observations into page understanding.

**Called by:** Discovery loop (at finish, for each page)

**Handoff:**
```typescript
type DiscoverySummarizerContext = {
  llm: BaseChatModel;
  pageId: string;
  observations: string[];
  currentUnderstanding: string;
};

type DiscoverySummarizerHandoff = HandoffInput<DiscoverySummarizerContext>;
```

**Output:**
```typescript
type DiscoverySummarizerResult = {
  summary: string;
};

type DiscoverySummarizerOutput = HandoffOutput<DiscoverySummarizerResult>;
```

---

## Discovery Agent

Located: `agents/discovery-agent.ts`

Each step, the Discovery agent looks at context and decides: **explore** or **done**.

Uses Gemini with function calling:
- Tools: `explore(action, target, reason)` and `done(understanding, key_elements)`
- Mode: `FunctionCallingMode.ANY` (must call a tool)

**Handoff (Manager → Discovery):**
```typescript
type DiscoveryContext = {
  startUrl: string;
  criteria?: Record<string, string>;
  maxSteps?: number;
};

type DiscoveryHandoff = HandoffInput<DiscoveryContext>;
```

**Per-Step Context (internal):**
```typescript
type DiscoveryStepContext = {
  goal: string;           // inherited from handoff
  currentDom: string;
  memorySummary: string;
  actionHistory: string[];
  confirmedPatternCount: number;
};
```

**Agent Output:**
```typescript
type DiscoveryDecision =
  | { type: 'explore'; action: 'click' | 'scroll_down' | 'scroll_up'; target?: string; reason: string }
  | { type: 'done'; understanding: string; keyElements: Record<string, string | string[]> };

type DiscoveryOutput = HandoffOutput<ExplorationResult>;
```

---

## Discovery Step Detail

### Per-Step Flow

```
Step N:
┌─────────────────────────────────────────────────────────────────┐
│ Discovery Loop                                                  │
│   │                                                             │
│   ├─→ Discovery Agent (Gemini function call)                    │
│   │     input: task, goals, DOM, memory, history                │
│   │     output: explore(click, "#btn", "why") or done()         │
│   │                                                             │
│   ├─→ page.takeScreenshot() → beforeScreenshot                  │
│   ├─→ page.clickSelector("#btn")                                │
│   ├─→ page.takeScreenshot() → afterScreenshot                   │
│   ├─→ page.getState() → newDom, newUrl                          │
│   │                                                             │
│   ├─→ Analyzer(action, before, after, urls)                     │
│   │     └── returns: { summary, urlChanged, significantChange } │
│   │                                                             │
│   ├─→ actionHistory.push(`click "#btn" → ${summary}`)           │
│   └─→ memory.addObservation(summary)                            │
└─────────────────────────────────────────────────────────────────┘
```

### Finish Flow

```
Discovery decides done():
┌─────────────────────────────────────────────────────────────────┐
│ Discovery.finishExploration()                                   │
│   │                                                             │
│   ├─→ for each pageId in memory.getPageIds():                   │
│   │     └─→ Summarizer(llm, pageId, observations, current)      │
│   │           └── memory.updatePageSummary(pageId, summary)     │
│   │                                                             │
│   ├─→ mergedKeyElements = { ...discovered, ...decision.keyElems}│
│   │                                                             │
│   └─→ return ExplorationResult to Manager                       │
│         { success, pages, navigationPath, finalUnderstanding,   │
│           keyElements }                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Full Flow (Manager → Discovery → Manager)

```
┌──────────┐                      ┌─────────────────────────────┐
│ Manager  │ ─── run Discovery ──→│ Discovery Loop              │
└──────────┘                      │   ├── Agent decides         │
     ▲                            │   ├── Page.execute()        │
     │                            │   ├── Analyzer              │
     │                            │   └── Memory.addObservation │
     │                            │                             │
     │                            │   ... repeats until done    │
     │                            │                             │
     │                            │   Summarizer (per page)     │
     │                            └──────────────┬──────────────┘
     │                                           │
     └──── ExplorationResult ────────────────────┘
```

---

## Discovery Memory (Detail)

Discovery's memory holds the learned page graph and exploration state.

### Memory Operations

```typescript
class DiscoveryMemory {
  // Initialization
  initializePage(pageId: string, task: string, url: string): void;
  
  // Recording
  addObservation(observation: string): void;
  addBehaviorPattern(pattern: BehaviorPatternInput): void;
  updatePageSummary(pageId: string, summary: string): void;
  updateFromClassification(result: ClassifierResult): void;
  
  // Querying
  getSummary(): string;
  getConfirmedPatternCount(): number;
  getPage(pageId: string): PageNode | undefined;
  getAllPages(): Map<string, PageNode>;
  getNavigationPath(): string[];
}
```

---

### PageNode

```typescript
interface PageNode {
  id: string;                     // "homepage", "job_search"
  understanding: string;          // summarized understanding
  rawObservations: string[];      // collected before summarization (deprecated, for compat)
  patterns: BehaviorPattern[];    // consolidated behavior patterns
  incomingEdges: Edge[];          // how to reach this page
  outgoingEdges: Edge[];          // where you can go from here
  visitCount: number;             // times visited
  lastVisitedAt: number;          // timestamp
  lastUrl: string;                // last URL seen for this page type
}
```

---

### Edge

```typescript
interface Edge {
  fromPageId: string;
  toPageId: string;
  action: string;        // "clicked Jobs nav link"
  selector?: string;     // the actual selector used
}
```

---

### BehaviorPattern

Consolidated from repeated observations. Pattern is `confirmed` after 2+ observations.

```typescript
interface BehaviorPattern {
  id: string;                     // unique pattern id (generated)
  action: string;                 // "click", "scroll", etc.
  targetDescription: string;      // "job listing", "filter button"
  effect: string;                 // "updates details panel", "opens modal"
  changeType: string;             // from Analyzer: "content_loaded", "navigation", etc.
  selectors: string[];            // example selectors that trigger this (max 3)
  count: number;                  // how many times observed
  confirmed: boolean;             // true if count >= 2 (pattern is reliable)
  firstSeen: number;              // timestamp
}
```

---

### ClassifierResult

Used for page classification when URL changes.

```typescript
interface ClassifierResult {
  pageId: string;
  isNewPage: boolean;
  isSamePage: boolean;
  understanding: string;
  cameFrom?: string;
  viaAction?: string;
}
```

Called in `discovery-loop.ts` when URL changes to create new PageNodes and Edges.

---

### KeyElements

Discovered selectors by semantic type. Merged from MemoryStore patterns + Manager's `done()` output.

```typescript
interface KeyElements {
  filter_button?: string;
  apply_button?: string;
  job_listings?: string[];
  search_input?: string;
  pagination?: string;
  close_button?: string;
  [key: string]: string | string[] | undefined;
}
```

---

### ExplorationResult

Final payload from Phase 1 Discovery:

```typescript
interface ExplorationResult {
  pages: Map<string, PageNode>;
  navigationPath: string[];
  finalUnderstanding: string;
  keyElements?: KeyElements;
}
```

---

## Multi-Page Navigation

When URL changes, Discovery creates a new PageNode and links it:
1. Classify page identity (URL-based for now)
2. Call `memory.updateFromClassification()` to create/update PageNode
3. Add Edge from previous page

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
3. Record in MemoryStore
4. After 2+ observations of same pattern → `confirmed: true`

Confirmed patterns are reliable for recipe generation.

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
  - Has its own memory (PageNodes, Edges, Patterns, actionHistory)
  - Agent decides explore/done each step
  - **Analyzer** — visual diff (stateless)
  - **Summarizer** — consolidates observations (stateless)

### Phase 1 Flow

```
Manager
  └─→ Discovery.run(task, goals)
        │
        └── Discovery Loop (many steps)
              ├── Agent decides → explore/done
              ├── Page.execute()
              ├── Analyzer → summary
              └── Memory.addObservation()
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

URL changes now produce new PageNodes and Edges via `updateFromClassification()`.
