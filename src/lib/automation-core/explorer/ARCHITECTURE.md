# Recipe Generation System Architecture

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
    │     │     ├── events: DiscoveryEvent[]
    │     │     └── currentPageKey + snapshot store
    │     │
    │     ├── Step Decider (per-step decision: explore/done)
    │     │
    │     └── Sub-agents:
    │           ├── Analyzer (visual diff after actions)
    │           ├── PageMatch (same-page detection)
    │           └── Summarizer (consolidate observations at finish)
    │
    ├── Recipe Generation (Phase 2)
    │     └── Composer (generates replayable steps)
    │
    └── Page (browser interface)
          └── dom/service (DOM utilities)
```

**Flow:**
1. Manager calls Discovery (passes task, goals)
2. Discovery runs its exploration loop (many steps, uses its own memory)
3. Discovery returns `ExplorationResult` to Manager
4. Manager saves result to memory
5. Manager calls Composer to generate a recipe

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
- Event log (decisions, actions, LLM calls, analyzer/summarizer outputs, page_change rollups)
- Snapshot store (screenshots saved separately; events carry snapshot IDs)
- Current page key (for tagging events)

**Event kinds (high level):**
- `llm_call` — every LLM call (step decider, analyzer, page match, page id, summarizer)
- `page_change` — rollup of post-action analysis (analyzer result + page key resolution)
- `analyzer` — initial page analysis (baseline)
- `decision`, `action`, `summarizer` — step control and end-of-run summary

Screenshots are stored separately and referenced by `snapshotId` in event metadata.

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

- **Not brittle**: Agents can evolve internal logic
- **Clear intent**: Every call has explicit purpose
- **Debuggable**: Easy to trace what each step was trying to do
- **Flexible**: Context can vary, goal stays consistent

---

## Phase 1: Discovery

Discovery is an agent that runs its own exploration loop, coordinating sub-agents to learn how to complete a task.

### Entry Point

Manager calls `runDiscovery()` in `agents/discovery/discovery-agent.ts`.

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

const result = await runDiscovery({
  goal: "Learn how to find job listings",
  context: discoveryContext
});
```

### Discovery Loop (per step)

```
Step N:
1. Step Decider chooses explore() or done()
2. Capture BEFORE screenshot
3. Execute action (click/scroll)
4. Capture AFTER screenshot
5. Analyzer + PageMatch
6. Record page_change rollup + LLM call events
```

### Step Decider (internal)

Each step, the Step Decider looks at context and decides: **explore** or **done**.

- Tools: `explore(action, target, reason)` and `done(understanding)`
- Mode: `FunctionCallingMode.ANY` (must call a tool)
- Inputs: task, goals, DOM, event-log summary, recent events, click labels, screenshot

### Page Keys and `page_change` Rollups

When URL changes, Discovery resolves the page key:
1. Page Match Agent compares screenshots vs existing pages
2. If match: reuse page key; else create new key with LLM id
3. Record `fromPageKey`/`toPageKey` + snapshot IDs on the page_change rollup and switch current page key

---

## Phase 2: Recipe Generation (Composer)

### Goal

Turn an `ExplorationResult` into a robust, replayable recipe that is already
program-executable (not human-style prose):
- Steps are structured actions with selectors and validations
- LLM produces stable selectors from DOM + screenshots
- Expected UI changes are explicit checks
- Apply link capture is part of the step definition

### Inputs

- `ExplorationResult` (events + finalUnderstanding)
- Event log rollups (`page_change`) and `llm_call` traces
- Snapshot IDs for before/after inspection

### Outputs

- `Recipe` (linked `Step` chain)
- Each step includes selector strategy + validation checks

### Composer Pipeline (planned)

1. **Generate structured recipe steps (LLM)**
   - Input: action + page_change summaries + goal + DOM text + screenshots
   - Output: executable step objects (action type, selector, expected change)
2. **Validate selectors (code)**
   - Replay steps sequentially and validate selectors at their step state
   - Ensure selector matches at least one element
   - Reject unstable selectors (e.g., `#ember...`)
3. **Build step sequence**
   - navigation → search → refine → select listing → capture apply link
   - mark repeatable steps (e.g., job card selection)
4. **Add validation**
   - expected elements or analyzer summaries
5. **Attach capture logic**
   - apply link href or redirect target
   - include `collectsFor: "apply_links"`

### Step Structure (current)

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

### Step Structure (planned extension)

```typescript
type Step = {
  navigate?: string;
  onThisPage?: string;              // page assertion
  action?: {
    type: 'click' | 'type' | 'scroll' | 'wait';
    selector: string;
    text?: string;
  };
  selectors?: {
    primary: string;
  };
  expectedChange?: string;          // short description of expected UI change
  repeatable?: boolean;
  patternConfirmed?: boolean;
  collectsFor?: string;             // e.g., "apply_links"
  nextStep?: Step | null;
}
```

### Selector Strategy (robustness)

LLM is instructed to prefer:
1. `data-testid` / stable attributes
2. `aria-label` + role
3. Visible text + role
4. Semantic tag + label/placeholder
5. Class selectors only if stable

Selectors matching `#ember...` are rejected during validation.

### Validation (no fallbacks)

Each step should include:
- Expected element present (assertion)
- Optional analyzer-style expected summary

No retries or fallback selectors are part of the recipe language.
If a step fails, recovery is handled by a separate fallback system.

### Recipe Language (v0, minimal and explicit)

We keep step types distinct to avoid confusing LLMs.
Pagination is handled as normal clicks (no `nextPage` primitive).

Allowed constructs:
- `action` (click/type/scroll)
- `wait` (explicit delay or waitFor selector)
- `extract` (capture structured data)
- `loop` (`forEach` over items, or `until` condition)

Example primitives:
```typescript
type Step = {
  action?: { type: 'click' | 'type' | 'scroll'; target: TargetDescriptor; text?: string };
  wait?: { type: 'delay' | 'until'; ms?: number; target?: TargetDescriptor };
  extract?: { key: string; from: TargetDescriptor; attr?: 'href' | 'text' };
  loop?: { type: 'forEach' | 'until'; over: TargetDescriptor; maxIterations?: number };
  expect?: { target: TargetDescriptor; containsText?: string };
  nextStep?: Step | null;
}
```

### Capturing Apply Links

Preferred order:
1. Read `href` from the Apply button if present
2. If click triggers navigation, capture the redirect target
3. Record job id from URL (`currentJobId`) for dedupe

---

## Pattern Confirmation

1. Execute action via Page
2. Observe via Analyzer
3. Record event in log (sub-agent outputs + URLs + snapshot IDs)
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

## File Structure

```
src/lib/automation-core/
├── explorer/
│   ├── ARCHITECTURE.md          # This document
│   ├── GOALS_AND_MEMORY.md      # Legacy redirect to ARCHITECTURE.md
│   ├── manager.ts               # Manager (phase coordinator)
│   └── index.ts                 # Exports
├── agents/discovery/
│   ├── discovery-agent.ts       # Discovery loop + step decider
│   ├── analyzer-agent.ts        # Visual diff + page match orchestration
│   ├── page-match-agent.ts      # Same-page detection
│   ├── summarizer-agent.ts      # End-of-run summarizer
│   ├── discover-event-log.ts    # DiscoverEventLog
│   ├── memory/
│   │   └── types.ts             # DiscoveryEvent, ExplorationResult
│   └── types/
│       └── handoff.ts           # HandoffInput/HandoffOutput
└── browser/
    ├── page.ts                  # Page API
    └── dom/                     # DOM utilities
```

---

## Summary

- **Manager** coordinates phases (Discovery → Composer)
- **Discovery** runs its own loop and logs every LLM call
- **Event log** is the source of truth (actions, rollups, snapshots)
- **Composer** turns discovery signals into a robust, replayable recipe

