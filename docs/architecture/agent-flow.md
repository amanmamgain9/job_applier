# Agent Flow Architecture

## Overview

A multi-phase LLM agent system that explores, understands, and automates **any** web page with list-detail patterns. The key principle: **English carries understanding between phases**, with structured output only at the final generation step.

This is NOT a job-specific system. It works on any page that shows:
- A list of items (products, articles, listings, search results, etc.)
- Detail views when items are clicked

---

## The Three Phases

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                            │
│              "Extract 20 items from this page"                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│               PHASE 1: STRATEGY PLANNER                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Tools: probeClick, describeElement, scrollAndObserve    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  The LLM explores the page interactively:                       │
│  - Clicks elements to see what happens                          │
│  - Scrolls to check for infinite scroll / pagination            │
│  - Examines element contents                                    │
│                                                                 │
│  OUTPUT: English understanding + VERIFIED SELECTORS             │
│  - LIST_ITEM: "a[href*='/jobs/view/']"                          │
│  - DETAILS_PANEL: ".jobs-details"                               │
│  - CLICK_BEHAVIOR: "shows_panel" | "navigates" | "inline"       │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              PHASE 2: GENERATORS (Optional)                     │
│                                                                 │
│  Called only if StrategyPlanner says they're needed:            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ FilterGen    │  │ SortGen      │  │ SearchGen    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  OUTPUT: Structured recipe fragments for specific interactions  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              PHASE 3: RECIPE GENERATOR                          │
│                                                                 │
│  Combines:                                                      │
│  - English strategy from Phase 1                                │
│  - Verified selectors from Phase 1                              │
│  - Fragments from Phase 2 (if any)                              │
│                                                                 │
│  OUTPUT: Complete Recipe + Bindings                             │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RECIPE EXECUTOR                              │
│                                                                 │
│  Executes the recipe against the browser:                       │
│  - Uses bindings to resolve abstract targets to CSS selectors   │
│  - Handles scrolling, clicking, waiting, extraction             │
│  - Collects extracted items                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: StrategyPlanner

The StrategyPlanner is an **agentic LLM** that explores the page using tools. It doesn't guess - it probes and observes.

### Input

| Input | Description |
|-------|-------------|
| DOM snapshot | HTML structure of the page |
| Task | What the user wants (e.g., "Extract 20 items") |
| URL | Current page URL |

### Tools

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `probeClick(selector)` | CSS selector | English description | "What happens when I click this?" |
| `describeElement(selector)` | CSS selector | Element content + verified selectors | "What does this element contain?" |
| `scrollAndObserve(target)` | "page" or "list" | Scroll result + item count changes | "Does scrolling load more items?" |

### Example Session

```
LLM: I see items that look like list cards. Let me probe what happens when I click one.

→ probeClick("a[href*='/view/']")

← "Clicked the element. URL did not change. A details panel appeared (.item-details)."

LLM: Panel-based design. Let me check scroll behavior.

→ scrollAndObserve("page")

← "Scrolled page. Item count unchanged: 10 items. Could not scroll further - 
   may be at the end. Pagination controls are present."

LLM: Let me check the details panel contents.

→ describeElement(".item-details")

← "Element contains: 'Product Title...Price: $29.99...Description: A great 
   product for...' Has 5 direct children.
   
   VERIFIED CONTENT SELECTORS:
   - '.item-details h1'
   - '.item-details [class*="price"]'
   - '.item-details [class*="description"]'"

LLM OUTPUT:
## PAGE UNDERSTANDING
- This is a product listing page with list-detail layout
- Clicking an item opens a details panel (no page navigation)
- Scrolling does NOT load more items
- Pagination controls exist

## STRATEGY

### VERIFIED SELECTORS
- LIST_ITEM: `a[href*='/view/']`
- DETAILS_PANEL: `.item-details`
- DETAILS_CONTENT:
  - `.item-details h1`
  - `.item-details [class*="price"]`
- PAGINATION_BUTTON: none found

### AUTOMATION PLAN
1. Iterate through visible list items
2. Click each item to open details panel
3. Extract content from panel
4. NEEDED GENERATORS: None
```

### Output Format

The StrategyPlanner MUST output:

```markdown
## PAGE UNDERSTANDING
[English description of what the page is and how it works]

## STRATEGY

### VERIFIED SELECTORS
- LIST_ITEM: `selector` (ONLY selectors tested with tools)
- DETAILS_PANEL: `selector`
- DETAILS_CONTENT: (optional)
  - `selector1`
  - `selector2`
- PAGINATION_BUTTON: `selector` or none

### AUTOMATION PLAN
1. [Step by step plan]
2. ...
3. NEEDED GENERATORS: None | FilterGenerator | SortGenerator | SearchGenerator
```

---

## Phase 2: Generators (Optional)

Generators are called only when the StrategyPlanner says they're needed. They handle complex UI interactions like filters, sorts, and search boxes.

### FilterGenerator

Generates recipe fragments for applying filters (dropdowns, checkboxes, etc.)

```json
{
  "filterTarget": ".filter-dropdown",
  "filterOption": "[data-value='full-time']",
  "fragment": [
    { "type": "CLICK", "selector": ".filter-dropdown" },
    { "type": "WAIT_FOR", "condition": { "exists": ".filter-options" } },
    { "type": "CLICK", "selector": "[data-value='full-time']" },
    { "type": "WAIT_FOR", "condition": { "gone": ".loading-spinner" } }
  ]
}
```

### SortGenerator

Generates recipe fragments for sorting.

### SearchGenerator

Generates recipe fragments for search input.

---

## Phase 3: RecipeGenerator

Takes the English strategy and produces a complete, executable recipe.

### Input

| Input | Description |
|-------|-------------|
| Strategy | English output from StrategyPlanner |
| Fragments | Structured fragments from Generators (if any) |
| Task | User's original task |
| maxItems | How many items to extract |

### Output

Two parts combined in one JSON response:

```json
{
  "bindings": {
    "LIST": "body",
    "LIST_ITEM": "a[href*='/view/']",
    "DETAILS_PANEL": ".item-details",
    "DETAILS_CONTENT": [".item-details h1", ".item-details p"],
    "CLICK_BEHAVIOR": "shows_panel",
    "PAGE_LOADED": { "exists": "body" },
    "LIST_LOADED": { "exists": "a[href*='/view/']" },
    "DETAILS_LOADED": { "exists": ".item-details" }
  },
  "recipe": {
    "id": "unique-recipe-id",
    "name": "Extract Items",
    "commands": [
      { "type": "WAIT_FOR", "target": "page" },
      { "type": "WAIT_FOR", "target": "list" },
      { "type": "FOR_EACH_ITEM_IN_LIST", "body": [
        { "type": "CLICK" },
        { "type": "WAIT_FOR", "target": "details" },
        { "type": "EXTRACT_DETAILS" },
        { "type": "SAVE", "as": "item" },
        { "type": "MARK_DONE" }
      ]},
      { "type": "END" }
    ],
    "config": { "maxItems": 20 }
  }
}
```

### Command Types

| Command | Description |
|---------|-------------|
| `WAIT_FOR` | Wait for page/list/details to load |
| `FOR_EACH_ITEM_IN_LIST` | Iterate through list items |
| `CLICK` | Click current item |
| `EXTRACT_DETAILS` | Extract all text from details panel |
| `SAVE` | Save extracted content |
| `MARK_DONE` | Mark current item as processed |
| `SCROLL` | Scroll list or page |
| `REPEAT` | Loop until condition met |
| `CLICK_IF_EXISTS` | Click pagination/load-more buttons |
| `END` | End recipe |

### Bindings

Bindings map abstract targets to CSS selectors:

| Binding | Purpose |
|---------|---------|
| `LIST` | Container for list items (usually "body") |
| `LIST_ITEM` | Selector for each item in the list |
| `DETAILS_PANEL` | Where details appear after clicking |
| `DETAILS_CONTENT` | Selectors for extracting content |
| `CLICK_BEHAVIOR` | "shows_panel", "navigates", or "inline" |
| `PAGE_LOADED` | Condition for page ready |
| `LIST_LOADED` | Condition for list visible |
| `DETAILS_LOADED` | Condition for details visible |
| `NEXT_PAGE_BUTTON` | Pagination button (optional) |

---

## Recipe Executor

The executor runs recipes against the browser.

### How It Works

1. **Resolve bindings**: Abstract targets like `"target": "list"` are resolved using bindings
2. **Execute commands**: Each command is executed sequentially
3. **Handle loops**: `FOR_EACH_ITEM_IN_LIST` iterates through matched elements
4. **Extract content**: `EXTRACT_DETAILS` grabs all text from the details panel
5. **Collect items**: Extracted content is saved as items

### Extraction Flow

```
FOR_EACH_ITEM_IN_LIST
├── Select first unprocessed item matching LIST_ITEM
├── CLICK the item
├── WAIT_FOR DETAILS_LOADED condition
├── EXTRACT_DETAILS
│   └── Get all text content from DETAILS_PANEL
│   └── (Optional) Use LLM to parse into structured fields
├── SAVE the extracted content
├── MARK_DONE (add item ID to processed set)
└── Loop to next item
```

### Error Handling

When a selector fails:
1. Executor logs the error with context
2. Execution continues to next item (soft failure)
3. Hard failures (no items found) stop execution

---

## Session Reports

Each discovery session produces a detailed report:

```typescript
interface SessionReport {
  // Metadata
  id: string;
  startedAt: number;
  endedAt: number;
  duration: number;
  
  // Task info
  task: string;
  sourceUrl: string;
  searchQuery?: string;
  
  // Results
  success: boolean;
  jobsFound: number;
  jobsExtracted: ExtractedJob[];
  
  // Phase outputs
  phaseOutputs: PhaseOutput[];
  strategyPlannerOutput: string;
  generatedRecipe: Recipe;
  discoveredBindings: Bindings;
  
  // Execution stats
  commandsExecuted: number;
  steps: StepInfo[];
  logs: string[];
  
  // Error info
  error?: string;
  stoppedReason?: 'complete' | 'max_jobs' | 'error' | 'cancelled';
}

interface PhaseOutput {
  phase: string;
  timestamp: number;
  duration: number;
  success: boolean;
  output?: string;
  toolCalls?: ToolCall[];
  error?: string;
}
```

Reports are saved to storage and can be viewed in the extension.

---

## Implementation Files

| File | Class/Function | Purpose |
|------|----------------|---------|
| `agent/strategy-planner.ts` | `StrategyPlanner` | Phase 1: Explore & plan |
| `generators/filter-generator.ts` | `FilterGenerator` | Phase 2: Filter fragments |
| `generators/sort-generator.ts` | `SortGenerator` | Phase 2: Sort fragments |
| `generators/search-generator.ts` | `SearchGenerator` | Phase 2: Search fragments |
| `generators/recipe-generator.ts` | `RecipeGenerator` | Phase 3: Final recipe |
| `orchestrator.ts` | `AgentOrchestrator` | Runs the full flow |
| `recipe/executor.ts` | `RecipeExecutor` | Executes recipes |
| `recipe/bindings.ts` | `PageBindings` | Binding types |
| `recipe/commands.ts` | `Command` | Command types |

---

## Usage Example

```typescript
import { 
  AgentOrchestrator, 
  RecipeExecutor,
  BrowserContext 
} from '@/lib/automation-core';
import { createChatModel } from './llm';

// Initialize
const llm = createChatModel({ provider: 'google', model: 'gemini-2.0-flash' });
const orchestrator = new AgentOrchestrator({ plannerLLM: llm });

// Get browser page
const context = await BrowserContext.fromTab(tabId);
const page = await context.getCurrentPage();

// Run agent flow
const result = await orchestrator.run({
  page,
  task: 'Extract 20 items',
  maxItems: 20,
});

// Execute generated recipe
if (result.success && result.recipe && result.bindings) {
  const executor = new RecipeExecutor(page, result.bindings, llm);
  const execResult = await executor.execute(result.recipe);
  
  console.log(`Extracted ${execResult.items.length} items`);
  for (const item of execResult.items) {
    console.log(item.content);
  }
}
```

---

## Key Design Principles

### 1. English First
The LLM describes what it sees in natural language. This avoids forcing premature structure and allows the LLM to reason about the page naturally.

### 2. Verified Selectors Only
The StrategyPlanner outputs ONLY selectors that were verified by tool calls. It never invents selectors based on guessing.

### 3. Bindings Separate from Commands
Recipe commands use abstract targets (`"target": "list"`). Bindings provide the mapping to actual CSS selectors. This separation allows:
- Recipes to be more portable
- Bindings to be fixed/updated without changing commands
- Clear debugging of what selector failed

### 4. Simple Primitives
The final recipe uses simple, composable primitives. No site-specific commands. Any page can be automated with the same command vocabulary.

### 5. Streaming Reports
Session reports are saved continuously during execution, not just at the end. This ensures debugging data is available even if execution crashes.

---

## Debugging Tips

### Recipe won't execute (0 commands executed)

1. Check `discoveredBindings` in report - are `LIST_ITEM`, `DETAILS_PANEL` valid?
2. Check `generatedRecipe.commands` - is the structure correct?
3. Look for errors in logs after "Starting recipe execution..."

### Items extracted but empty content

1. Check `DETAILS_CONTENT` bindings - do they match elements in the panel?
2. Try extracting all text from `DETAILS_PANEL` directly
3. Check timing - is there a wait after clicking before extraction?

### Selectors not working

1. Compare `VERIFIED SELECTORS` from StrategyPlanner with actual DOM
2. Check if page has dynamic content that changes selectors
3. Verify selectors in browser DevTools

### StrategyPlanner gives wrong output

1. Check tool call results in `phaseOutputs`
2. Verify the LLM is using tools (not guessing)
3. Try with a different page layout to verify the prompt
