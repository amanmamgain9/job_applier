# Agent Flow Architecture

## Overview

A multi-phase LLM agent system that explores, understands, and automates web pages. The key principle: **English carries understanding between phases**, with structured output only at the final generation step.

---

## Phase 1: StrategyPlanner

**Purpose:** Interactively explore the page, understand its structure, and plan the automation approach.

```
StrategyPlanner
├── Input: DOM snapshot + Task description
├── Tools: 
│   ├── probeClick(selector) → English
│   ├── describeElement(selector) → English  
│   ├── scrollAndObserve(target) → English
├── Output: English understanding + strategy + which generators are needed
```

### Exploration Tools

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `probeClick(selector)` | CSS selector | English description | "What happens when I click this?" |
| `describeElement(selector)` | CSS selector | English description | "What does this element contain?" |
| `scrollAndObserve(target)` | "page" or selector | English description | "What happens when I scroll?" |

### Example Session

```
LLM: I see job cards. Let me probe what happens when I click one.

→ probeClick(".job-card:first-child")

← "Clicked the first job card. A detail panel appeared on the right 
   showing job title, company, full description. The job list remains 
   visible on the left. URL updated to include jobId=12345."

LLM: Panel-based design. Let me check scroll behavior.

→ scrollAndObserve(".jobs-list")

← "Scrolled the jobs list container. 10 more job cards loaded at the 
   bottom. Total now 35 cards visible. No pagination buttons appeared."

LLM OUTPUT:
"PAGE UNDERSTANDING:
This is a job search page with a list-detail layout. The left side 
has a scrollable list of job cards (~25 visible initially). Clicking 
a card opens a detail panel on the right without navigating away. 
The list uses infinite scroll.

STRATEGY:
1. SCROLL STRATEGY: Infinite scroll on .jobs-list container. 
   Scroll until we have 50+ items or hit the end.

2. EXTRACTION STRATEGY: For each job card, click to open detail 
   panel, extract fields from panel, then click next card.

3. NEEDED GENERATORS: FilterGenerator (to apply job type filter)

4. LOOP STRUCTURE: 
   - Checkpoint item count
   - Scroll list
   - Wait for new items
   - Repeat until 50 items
   - For each item: click → extract → next"
```

---

## Phase 2: Generators

**Purpose:** Generate structured recipe fragments for filter, sort, and search interactions.

```
Generators (called as needed)
├── Input: DOM + English context from StrategyPlanner
├── Tools: testSelector(selector) → count (optional validation)
├── Output: STRUCTURED (selectors + recipe fragments)
```

### Generator Types

| Generator | Produces |
|-----------|----------|
| `FilterGenerator` | Filter interaction recipe fragment |
| `SortGenerator` | Sort dropdown/toggle recipe fragment |
| `SearchGenerator` | Search input recipe fragment |

### Example: FilterGenerator Output

```json
{
  "filterTarget": ".filter-dropdown",
  "filterOption": "[data-value='full-time']",
  "fragment": [
    { "type": "CLICK", "selector": ".filter-dropdown" },
    { "type": "WAIT_FOR", "condition": { "exists": ".filter-options" } },
    { "type": "CLICK", "selector": "[data-value='full-time']" },
    { "type": "WAIT_FOR", "condition": { "absent": ".loading-spinner" } }
  ]
}
```

### Example: SearchGenerator Output

```json
{
  "searchInput": "input[name='search']",
  "submitButton": "button[type='submit']",
  "fragment": [
    { "type": "CLICK", "selector": "input[name='search']" },
    { "type": "TYPE", "selector": "input[name='search']", "text": "{{searchQuery}}" },
    { "type": "CLICK", "selector": "button[type='submit']" },
    { "type": "WAIT_FOR", "condition": { "absent": ".loading-spinner" } }
  ]
}
```

---

## Phase 3: RecipeGenerator

**Purpose:** Assemble fragments into final executable recipe.

```
RecipeGenerator
├── Input: English strategy + structured fragments + primitives reference
├── Output: Complete Recipe (structured)
```

### Output: Final Recipe

```json
{
  "id": "job_extraction",
  "name": "Extract 50 Jobs",
  "bindings": {
    "LIST": ".jobs-list",
    "LIST_ITEM": ".job-card",
    "DETAILS_PANEL": ".job-details-panel",
    "NEXT_ITEM": null
  },
  "commands": [
    { "type": "WAIT_FOR", "condition": { "exists": ".jobs-list" } },
    { "type": "LOOP", "commands": [
      { "type": "CHECKPOINT_COUNT", "selector": ".job-card" },
      { "type": "SCROLL", "target": ".jobs-list" },
      { "type": "IF", "condition": { "countChanged": false }, "then": [
        { "type": "BREAK" }
      ]}
    ], "maxIterations": 20 },
    { "type": "FOR_EACH", "selector": ".job-card", "limit": 50, "commands": [
      { "type": "CLICK", "selector": "$current" },
      { "type": "WAIT_FOR", "condition": { "exists": ".job-details-panel" } },
      { "type": "EXTRACT", "from": ".job-details-panel" }
    ]}
  ]
}
```

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                            │
│                "Extract 50 software engineer jobs"              │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STRATEGY PLANNER                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Tools: probeClick, describeElement, scrollAndObserve    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Output: "This page has a list-detail layout. Clicking cards    │
│           opens a panel. List uses infinite scroll.             │
│           Strategy: scroll to load, click each for details.    │
│           Need: FilterGenerator for job type filter"           │
└─────────────────────────┬───────────────────────────────────────┘
                          │ English + Generator list
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      GENERATORS                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ FilterGen    │  │ SortGen      │  │ SearchGen    │          │
│  │ (if needed)  │  │ (if needed)  │  │ (if needed)  │          │
│  └──────┬───────┘  └──────────────┘  └──────────────┘          │
│         │                                                       │
│         ▼                                                       │
│     Fragment(s)                                                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Structured fragments
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RECIPE GENERATOR                             │
│                                                                 │
│  Output: Complete executable recipe with bindings + commands    │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RECIPE EXECUTOR                              │
│                                                                 │
│  Runs the recipe against the browser                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Principles

### 1. English First
Understanding travels as natural language. The LLM describes what it sees and learns in its own words. This avoids forcing premature structure.

### 2. Tools for Discovery
The StrategyPlanner has tools to interact with the page. It doesn't guess - it probes and observes.

### 3. Unified Exploration & Planning
A single phase handles both page exploration and strategy formation. The LLM explores until it understands, then outputs both understanding and strategy together.

### 4. Focused Generators
Generators only handle filter, sort, and search interactions. Scroll, pagination, and extraction logic are handled directly by the RecipeGenerator based on the English strategy.

### 5. Primitives Stay Simple
The final recipe uses simple primitives:
- `SCROLL`, `CLICK`, `WAIT_FOR`, `IF`, `LOOP`, `FOR_EACH`, `EXTRACT`, `TYPE`
- No site-specific commands

---

## Primitives Reference

| Primitive | Purpose |
|-----------|---------|
| `WAIT_FOR` | Wait for condition (exists, visible, count) |
| `SCROLL` | Scroll page or element |
| `CLICK` | Click an element |
| `IF` | Conditional execution |
| `LOOP` | Repeat with max iterations |
| `FOR_EACH` | Iterate over matched elements |
| `BREAK` | Exit current loop |
| `CHECKPOINT_COUNT` | Save current item count |
| `EXTRACT` | Extract data from element |
| `GO_TO` | Focus/scroll to element |

---

## Error Handling

When execution fails:

1. **Executor** reports failure with context (what command, what selector, what error)
2. **Debugger agent** receives: original understanding + recipe + failure context
3. **Debugger** can call exploration tools to re-examine the page
4. **Debugger** produces: fix suggestion (new selector, modified fragment)
5. **Executor** retries with fix

This keeps the human-like loop: explore → understand → try → fail → debug → retry.

---

## Implementation

### TypeScript Classes

| Class | File | Purpose |
|-------|------|---------|
| `StrategyPlanner` | `agent/strategy-planner.ts` | Phase 1: Explore & plan |
| `FilterGenerator` | `generators/filter-generator.ts` | Phase 2: Filter fragments |
| `SortGenerator` | `generators/sort-generator.ts` | Phase 2: Sort fragments |
| `SearchGenerator` | `generators/search-generator.ts` | Phase 2: Search fragments |
| `RecipeGenerator` | `generators/recipe-generator.ts` | Phase 3: Final recipe |
| `AgentOrchestrator` | `orchestrator.ts` | Runs the full flow |
| `RecipeExecutor` | `recipe/executor.ts` | Executes recipes |

### Usage Example

```typescript
import { 
  AgentOrchestrator, 
  RecipeExecutor,
  BrowserContext,
  createChatModel 
} from '@/lib/automation-core';

// Create LLM
const llm = createChatModel({ provider: 'google', model: 'gemini-2.0-flash' });

// Create orchestrator
const orchestrator = new AgentOrchestrator({
  plannerLLM: llm,
  maxToolCalls: 5,
});

// Get page from browser context
const context = await BrowserContext.fromTab(tabId);
const page = await context.getCurrentPage();

// Run the full agent flow
const result = await orchestrator.run({
  page,
  task: 'Extract 20 job listings',
  maxItems: 20,
});

if (result.success && result.recipe && result.bindings) {
  // Execute the generated recipe
  const executor = new RecipeExecutor(page, result.bindings, llm);
  const execResult = await executor.execute(result.recipe);
  
  console.log(`Extracted ${execResult.items.length} items`);
}
```

### Phase Outputs

Each phase in the flow captures its output for debugging:

```typescript
interface PhaseOutput {
  phase: 'strategy_planner' | 'filter_generator' | 'sort_generator' | 
         'search_generator' | 'recipe_generator' | 'binding_discovery';
  timestamp: number;
  duration: number;
  success: boolean;
  output?: string;      // English strategy or JSON fragment
  toolCalls?: Array<{   // For StrategyPlanner
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  error?: string;
}
```

Phase outputs are available in `OrchestratorResult.phaseOutputs` and included in the `SessionReport`.

