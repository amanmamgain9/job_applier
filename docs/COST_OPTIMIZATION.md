# Cost Optimization: From $10/5 Runs to $5/60 Runs

## The New Recipe System

We've replaced the expensive LLM-per-step agent with a **command-based recipe system**.

### Before: Agent API (~$2/run)
- LLM decides every action
- 15+ LLM calls per session
- Full DOM sent each time
- ~200-400K tokens per run

### After: Recipe API (~$0.01-0.02/run)
- Commands describe WHAT to do (OPEN_PAGE, CLICK_ITEM, etc.)
- Navigator LLM discovers page selectors ONCE
- Executor runs commands with NO LLM
- Extractor LLM parses content (cheap model, ~500 tokens each)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  RECIPE (Commands that read like English)                           │
│  ─────────────────────────────────────────                          │
│  OPEN_PAGE → WAIT_FOR_LIST → FOR_EACH_ITEM: CLICK → EXTRACT → SAVE │
│  SCROLL_FOR_MORE → UNTIL: COLLECTED 20 OR NO_MORE_ITEMS            │
├─────────────────────────────────────────────────────────────────────┤
│  BINDINGS (Discovered by Navigator LLM - ONCE)                      │
│  ─────────────────────────────────────────────                      │
│  LIST_ITEM = ".jobs-search-results__list-item"                      │
│  DETAILS_LOADED = { exists: ".jobs-description-content" }           │
│  SCROLL_BEHAVIOR = "infinite"                                       │
├─────────────────────────────────────────────────────────────────────┤
│  EXECUTOR (Runs commands using bindings - NO LLM)                   │
│  ────────────────────────────────────────────────                   │
│  FOR_EACH_ITEM_IN_LIST → loops through LIST_ITEM elements          │
│  CLICK_ITEM → clicks current item                                   │
│  WAIT_FOR_DETAILS → waits for DETAILS_LOADED condition              │
├─────────────────────────────────────────────────────────────────────┤
│  EXTRACTOR (Cheap LLM - per item)                                   │
│  ─────────────────────────────────                                  │
│  Text content → Structured job data                                 │
│  ~500 tokens per extraction, uses Flash-Lite                        │
├─────────────────────────────────────────────────────────────────────┤
│  HAPPY STATE (Saved progress)                                       │
│  ─────────────────────────────                                      │
│  Working bindings + processed IDs + collected data                  │
│  Recovers from failures without restart                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Usage

```typescript
import { 
  RecipeRunner, 
  recipeTemplates, 
  BrowserContext,
  createDualModelConfig,
  createChatModel 
} from '@/lib/automation-core';

// Setup models
const config = createDualModelConfig(process.env.VITE_GEMINI_API_KEY);

// Get page
const context = await BrowserContext.fromActiveTab();
const page = await context.getCurrentPage();

// Create runner
const runner = new RecipeRunner({
  navigatorLLM: createChatModel(config.navigator),  // Gemini Flash
  extractorLLM: createChatModel(config.extractor),  // Gemini Flash-Lite
  maxItems: 20,
});

// Run recipe
const recipe = recipeTemplates.jobListingExtraction(url, 20);
const result = await runner.run(page, recipe);

console.log(result.items);  // Array of extracted jobs
console.log(result.stats);  // { duration, commandsExecuted, bindingFixes, ... }
```

---

## Command Reference

```typescript
// Navigation
OPEN_PAGE(url)
GO_BACK
REFRESH

// Waiting
WAIT_FOR_PAGE
WAIT_FOR_LIST
WAIT_FOR_DETAILS
WAIT(seconds)

// Focus
GO_TO_SEARCH_BOX
GO_TO_FILTER(name)
GO_TO_LIST
GO_TO_ITEM('next' | 'first' | 'unprocessed')

// Actions
TYPE(text)
SUBMIT
CLICK
CLICK_ITEM
SELECT(option)

// Scrolling
SCROLL_DOWN
SCROLL_FOR_MORE
SCROLL_TO_BOTTOM

// Data
EXTRACT_DETAILS
SAVE(as)
MARK_DONE

// Flow Control
FOR_EACH_ITEM_IN_LIST(body)
REPEAT(body, until)
END
```

---

## Cost Breakdown

| Component | LLM Calls | Tokens | Cost |
|-----------|-----------|--------|------|
| Navigator (discover bindings) | 1 | ~10K | ~$0.001 |
| Navigator (fix bindings) | 0-2 | ~5K each | ~$0.001 |
| Extractor (per item) | 20 | ~500 each | ~$0.0002 |
| **Total** | **~23** | **~20K** | **~$0.01** |

Compare to Agent API: ~15 calls, ~300K tokens, ~$1.50

---

## File Structure

```
src/lib/automation-core/
├── recipe/
│   ├── commands.ts     # Command types and builders
│   ├── bindings.ts     # PageBindings type and storage
│   ├── executor.ts     # Runs commands
│   ├── navigator.ts    # Discovers/fixes bindings
│   ├── runner.ts       # High-level API
│   └── index.ts        # Exports
├── llm/
│   ├── factory.ts      # Single model factory
│   └── tiered-factory.ts  # DualModelManager
├── checkpoint/
│   └── manager.ts      # HappyStateManager
└── extraction/
    └── job-extractor.ts  # Cheap content parser
```

---

## Configuration

```bash
# .env
VITE_GEMINI_API_KEY=your-gemini-key

# Models are auto-configured:
# Navigator: gemini-1.5-flash
# Extractor: gemini-2.0-flash-lite
```

---

## Binding Discovery

When you first visit a page type, Navigator analyzes the DOM:

```
Navigator: "I see a job listing page. Let me find the selectors..."

Output:
{
  "LIST": ".jobs-search-results-list",
  "LIST_ITEM": ".jobs-search-results__list-item",
  "DETAILS_CONTENT": [".jobs-description-content"],
  "ITEM_ID": { "from": "href", "pattern": "/jobs/view/(\\d+)" },
  "SCROLL_BEHAVIOR": "infinite",
  "DETAILS_LOADED": { "exists": ".jobs-description-content" }
}
```

Bindings are saved and reused. If a command fails, Navigator fixes just that binding.

---

## Recovery Flow

```
Start Recipe
    │
    ▼
┌─────────────────────────────────────┐
│ Navigator discovers bindings (1x)    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Executor runs: FOR_EACH_ITEM        │
│   CLICK_ITEM                         │
│   WAIT_FOR_DETAILS                   │
│   EXTRACT_DETAILS → Extractor LLM    │
│   SAVE                               │
│   MARK_DONE                          │
└─────────────────────────────────────┘
    │
    ├── All OK → Continue
    │
    └── WAIT_FOR_DETAILS failed!
            │
            ▼
    ┌─────────────────────────────────────┐
    │ Navigator fixes DETAILS_LOADED      │
    │ binding based on current DOM        │
    └─────────────────────────────────────┘
            │
            ▼
    Retry with fixed binding → Success
```

---

## Migration from Agent API

**Before:**
```typescript
const agent = new AutomationAgent({ context, llm: config });
const result = await agent.execute("Extract 20 jobs");
```

**After:**
```typescript
const runner = new RecipeRunner({ navigatorLLM, extractorLLM });
const recipe = recipeTemplates.jobListingExtraction(url, 20);
const result = await runner.run(page, recipe);
```

Both APIs are available. Agent API still works for complex tasks that need full LLM control.

