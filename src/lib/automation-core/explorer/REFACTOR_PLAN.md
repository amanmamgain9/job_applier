# Refactor Plan: Legacy → Current Architecture

Note: This document captures the refactor history. Sections labeled **Legacy** describe pre-refactor code and are not expected to match the current implementation.

---

## Legacy Implementation (pre-refactor)

```
External code calls:
    runOrchestrator(options)
        │
        ├── DiscoverEventLog (event log)
        ├── actionHistory[] (local variable)
        │
        └── while loop:
              ├── runManager() → decides explore/done
              │     └── runDiscoverer() → generates context summary
              ├── page.click/scroll()
              ├── runAnalyzer() → visual diff
              └── record analyzer/page-change event
              
        └── on done:
              └── runSummarizer() per page
```

**Problems:**
- `runOrchestrator` = confusing name, does too much
- `runManager` = not a manager, it's the per-step decision agent
- No actual Manager coordinating phases
- No ManagerMemory
- Handoffs don't have `goal`/`goalCompleted`

---

## Current Architecture (post-refactor)

```
External code calls:
    Manager.run(task, goals)
        │
        ├── ManagerMemory
        │     └── task, goals, phaseResults
        │
        ├── Phase 1: Discovery.run(goal, context)
        │     │
        │     ├── DiscoverEventLog (current Discovery state)
        │     │
        │     └── while loop:
        │           ├── DiscoveryAgent.decide() → explore/done
        │           ├── page.execute()
        │           ├── DiscoveryAnalyzer.run(goal, context) → significantChange
        │           └── record analyzer/page-change event
        │     
        │     └── on done:
        │           └── DiscoverySummarizer.run() per page
        │           └── return { goalCompleted, result: ExplorationResult }
        │
        └── Phase 2: Composer.run(goal, context)
              └── return { goalCompleted, result: Recipe }
```

---

## Refactor Steps

### Step 1: Rename Agents (no logic change)

| Current | Target | File |
|---------|--------|------|
| `runOrchestrator` | `runDiscoveryLoop` | `orchestrator.ts` → `discovery-loop.ts` |
| `runManager` | `runDiscoveryAgent` | `agents/manager.ts` → `agents/discovery-agent.ts` |
| `runAnalyzer` | `runDiscoveryAnalyzer` | `agents/analyzer.ts` → `agents/discovery-analyzer.ts` |
| `runSummarizer` | `runDiscoverySummarizer` | `agents/summarizer.ts` → `agents/discovery-summarizer.ts` |
| `runDiscoverer` | (remove or inline) | `agents/discoverer.ts` — fold into DiscoveryAgent |

**Why remove `runDiscoverer`?** It just generates a prose summary for context. The DiscoveryAgent can do this internally or we inline it.

---

### Step 2: Add Handoff Contracts

Create `types/handoff.ts`:

```typescript
interface HandoffInput<TContext = unknown> {
  goal: string;
  context?: TContext;
}

interface HandoffOutput<TResult = unknown> {
  goalCompleted: boolean;
  result?: TResult;
  reason?: string;
}
```

Update each agent to use these types.

---

### Step 3: Fix DiscoveryAnalyzer Output

Current:
```typescript
interface AnalyzerOutput {
  summary: string;
  urlChanged: boolean;
  hasVisualChanges: boolean;  // regex-based, not semantic
}
```

Target:
```typescript
interface DiscoveryAnalyzerResult {
  summary: string;
  urlChanged: boolean;
  significantChange: boolean;  // semantic: did page/state fundamentally shift?
}
```

**Implementation:** Update prompt to explicitly ask LLM "did the page fundamentally change (new screen, modal→page, major state shift)?" and return that as `significantChange`.

---

### Step 4: Create Manager

New file: `manager.ts`

```typescript
interface ManagerMemory {
  task: string;
  goals: string[];
  discoveryResult?: ExplorationResult;
  recipe?: Recipe;
  currentPhase: 'discovery' | 'recipe_generation' | 'done';
}

class Manager {
  private memory: ManagerMemory;
  
  async run(task: string, goals: string[]): Promise<Recipe> {
    this.memory = { task, goals, currentPhase: 'discovery' };
    
    // Phase 1
    const discoveryResult = await runDiscoveryLoop({
      goal: `Learn how to: ${task}`,
      context: { goals, ... }
    });
    
    if (!discoveryResult.goalCompleted) {
      throw new Error(discoveryResult.reason);
    }
    
    this.memory.discoveryResult = discoveryResult.result;
    this.memory.currentPhase = 'recipe_generation';
    
    // Phase 2
    const recipeResult = await runComposer({
      goal: `Generate replayable recipe`,
      context: { explorationResult: discoveryResult.result }
    });
    
    this.memory.recipe = recipeResult.result;
    this.memory.currentPhase = 'done';
    
    return this.memory.recipe;
  }
}
```

---

### Step 5: Update Discovery Loop

Rename `orchestrator.ts` → `discovery-loop.ts`

Change signature:
```typescript
// Before
export async function runOrchestrator(options: OrchestratorOptions): Promise<ExplorationResult>

// After
export async function runDiscoveryLoop(
  input: HandoffInput<DiscoveryContext>
): Promise<HandoffOutput<ExplorationResult>>
```

Return `{ goalCompleted, result }` instead of raw `ExplorationResult`.

---

### Step 6: Update Sub-Agents

Each sub-agent gets handoff contract:

```typescript
// DiscoveryAnalyzer
export async function runDiscoveryAnalyzer(
  input: HandoffInput<DiscoveryAnalyzerContext>
): Promise<HandoffOutput<DiscoveryAnalyzerResult>>

// DiscoverySummarizer  
export async function runDiscoverySummarizer(
  input: HandoffInput<DiscoverySummarizerContext>
): Promise<HandoffOutput<DiscoverySummarizerResult>>
```

---

### Step 7: Update Exports

`explorer/index.ts`:
```typescript
// Before
export { runOrchestrator } from './orchestrator';

// After
export { Manager } from './manager';
export { runDiscoveryLoop } from './discovery-loop';
```

External code changes from:
```typescript
const result = await runOrchestrator({ page, task, goals, ... });
```

To:
```typescript
const manager = new Manager({ page, llm, apiKey });
const recipe = await manager.run(task, goals);
```

---

## File Changes Summary

| Action | Current File | Target File |
|--------|--------------|-------------|
| Rename | `orchestrator.ts` | `discovery-loop.ts` |
| Rename | `agents/manager.ts` | `agents/discovery-agent.ts` |
| Rename | `agents/analyzer.ts` | `agents/discovery-analyzer.ts` |
| Rename | `agents/summarizer.ts` | `agents/discovery-summarizer.ts` |
| Delete | `agents/discoverer.ts` | (inline into discovery-agent) |
| Create | — | `manager.ts` |
| Create | — | `types/handoff.ts` |

---

## Checklist

- [x] Step 1: Rename agents
- [x] Step 2: Add handoff contracts
- [x] Step 3: Fix DiscoveryAnalyzer output (significantChange)
- [x] Step 4: Create Manager
- [x] Step 5: Update Discovery Loop
- [x] Step 6: Update Sub-Agents
- [x] Step 7: Update Exports
- [x] Update doc to match new structure
- [x] Delete old IMPLEMENTATION_COMPARISON.md

## Completed

All refactoring steps completed.

**New files:**
- `manager.ts` — Manager class
- `discovery-loop.ts` — Discovery loop with handoff contracts
- `agents/discovery-agent.ts` — Per-step decision maker
- `agents/discovery-analyzer.ts` — Visual diff with significantChange
- `agents/discovery-summarizer.ts` — Observation consolidation
- `types/handoff.ts` — Handoff contracts

**Deleted files:**
- `orchestrator.ts` — replaced by `discovery-loop.ts`
- `agents/manager.ts` — replaced by `agents/discovery-agent.ts`
- `agents/analyzer.ts` — replaced by `agents/discovery-analyzer.ts`
- `agents/summarizer.ts` — replaced by `agents/discovery-summarizer.ts`
- `agents/discoverer.ts` — inlined into `agents/discovery-agent.ts`

**Updated consumers:**
- `background/discovery.ts` — uses `runDiscoveryLoop` instead of `runOrchestrator`
- `automation-core/index.ts` — exports new structure

