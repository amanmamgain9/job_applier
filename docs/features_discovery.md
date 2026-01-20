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
| LinkedIn job discovery test | ✅ (Recipe API working) |
| **Recipe-based automation** | ✅ (Cost-optimized, ~$0.01/run) |
| **Navigator LLM binding discovery** | ✅ |
| **Inline extraction mode** | ✅ |

---

## Architecture: Recipe API vs Agent API

The automation-core library now offers **two APIs**:

### Recipe API (Recommended - Cost Optimized)

```
Cost: ~$0.01-0.02 per run (vs $1-2 for Agent API)
LLM Calls: 2-3 (discovery + extraction)
Speed: ~60 seconds for 20 jobs
```

Uses pre-defined **commands** (like `CLICK_ITEM`, `SCROLL_FOR_MORE`) with **bindings** discovered by an LLM. The Navigator LLM analyzes the page once to find CSS selectors, then commands execute without further LLM calls.

### Agent API (Legacy - Full AI Control)

```
Cost: ~$1-2 per run
LLM Calls: 20-50 (one per step)
Speed: ~5-10 minutes for 20 jobs
```

LLM controls every action. More flexible but expensive.

---

## How the Recipe System Works

### The Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. NAVIGATE TO PAGE                                                         │
│     Open LinkedIn jobs search URL                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. DISCOVER BINDINGS (Navigator LLM - 1 call)                               │
│     ─────────────────────────────────────                                    │
│     • Extract DOM with buildDomTree.js                                       │
│     • Send to Gemini Flash: "Find CSS selectors for job cards"               │
│     • LLM returns: { LIST_ITEM: "li[data-occludable-job-id]", ... }         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. EXECUTE RECIPE (No LLM - just commands)                                  │
│     ─────────────────────────────────────                                    │
│     REPEAT until 20 items collected:                                         │
│       FOR_EACH_ITEM_IN_LIST:                                                 │
│         • CLICK_ITEM (or skip in inline mode)                                │
│         • WAIT_FOR_DETAILS                                                   │
│         • EXTRACT_DETAILS → get text content                                 │
│         • SAVE                                                               │
│         • MARK_DONE                                                          │
│       SCROLL_FOR_MORE                                                        │
│       WAIT_FOR_LIST_UPDATE                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. PARSE CONTENT (Extractor LLM - N calls, cheap)                           │
│     ─────────────────────────────────────                                    │
│     For each extracted item:                                                 │
│       • Send raw text to Gemini Flash-Lite                                   │
│       • Extract: { title, company, location, salary, ... }                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Bindings Discovered by Navigator LLM

The Navigator analyzes the DOM and discovers these CSS selectors:

```typescript
interface PageBindings {
  // Core selectors (required)
  LIST: string;           // Container: "ul.jobs-search-results__list"
  LIST_ITEM: string;      // Each job card: "li[data-occludable-job-id]"
  
  // Content extraction
  DETAILS_CONTENT: string[];  // Where to get text: ["li[data-occludable-job-id]"]
  
  // Conditions (for WAIT commands)
  PAGE_LOADED: { exists: string };
  LIST_LOADED: { exists: string };
  
  // Behavior
  SCROLL_BEHAVIOR: 'infinite' | 'paginated' | 'load_more_button';
  CLICK_BEHAVIOR: 'inline' | 'shows_panel' | 'navigates';
  
  // ID extraction
  ITEM_ID: {
    from: 'data' | 'href';
    attribute?: string;  // "data-occludable-job-id"
    pattern?: string;    // Regex to extract ID
  };
}
```

### CLICK_BEHAVIOR Modes

| Mode | Description | When to Use |
|------|-------------|-------------|
| `inline` | Content already visible in item | LinkedIn job cards (title/company in card) |
| `shows_panel` | Clicking opens side panel | Indeed, Glassdoor |
| `navigates` | Clicking goes to new page | Some job boards |

---

## Commands Available

High-level, English-like commands that the recipe uses:

### Navigation
| Command | Description |
|---------|-------------|
| `OPEN_PAGE` | Navigate to URL |
| `GO_BACK` | Browser back |
| `REFRESH` | Reload page |

### Waiting
| Command | Description |
|---------|-------------|
| `WAIT_FOR_PAGE` | Wait for page load indicator |
| `WAIT_FOR_LIST` | Wait for list items to appear |
| `WAIT_FOR_DETAILS` | Wait for details panel |
| `WAIT` | Wait N seconds |

### Going To
| Command | Description |
|---------|-------------|
| `GO_TO_LIST` | Focus on list container |
| `GO_TO_ITEM` | Focus on specific item |
| `GO_TO_SEARCH_BOX` | Focus on search input |
| `GO_TO_FILTER` | Focus on filter element |

### Actions
| Command | Description |
|---------|-------------|
| `CLICK` | Click focused element |
| `CLICK_ITEM` | Click current item in loop |
| `TYPE` | Type text into focused input |
| `SUBMIT` | Press Enter |
| `SCROLL_FOR_MORE` | Scroll to load more items |

### Data
| Command | Description |
|---------|-------------|
| `EXTRACT_DETAILS` | Get text from current item |
| `SAVE` | Save extracted content |
| `MARK_DONE` | Mark item as processed |

### Flow Control
| Command | Description |
|---------|-------------|
| `FOR_EACH_ITEM_IN_LIST` | Loop through items |
| `REPEAT` | Repeat until condition |
| `END` | Stop execution |

---

## File Structure (Updated)

```
src/
├── background/
│   ├── discovery.ts           # Main entry: discoverJobsWithRecipe()
│   ├── message-router.ts      # Message handling
│   └── index.ts               # Extension setup
│
├── lib/automation-core/
│   ├── recipe/                # 🆕 Recipe-based automation
│   │   ├── commands.ts        # Command types & builders
│   │   ├── bindings.ts        # PageBindings interface
│   │   ├── executor.ts        # Executes commands
│   │   ├── navigator.ts       # LLM-powered binding discovery
│   │   ├── runner.ts          # High-level orchestration
│   │   └── index.ts           # Exports
│   │
│   ├── extraction/
│   │   └── job-extractor.ts   # 🆕 Cheap extraction with Flash-Lite
│   │
│   ├── checkpoint/
│   │   └── manager.ts         # 🆕 Happy state management
│   │
│   ├── llm/
│   │   ├── factory.ts         # Creates LLM instances
│   │   └── tiered-factory.ts  # 🆕 Navigator + Extractor config
│   │
│   ├── browser/
│   │   ├── context.ts         # BrowserContext (CDP connection)
│   │   ├── page.ts            # Page wrapper (DOM, actions)
│   │   └── dom/               # DOM extraction
│   │
│   └── agent/                 # Legacy Agent API
│       ├── executor.ts
│       └── navigator.ts
│
├── popup/
│   ├── hooks/
│   │   ├── useDiscovery.ts
│   │   └── useJobs.ts
│   └── components/
│       ├── ScanJobsButton.tsx
│       ├── JobQueue.tsx
│       ├── Reports.tsx        # 🆕 Session reports display
│       └── ...
│
└── App.tsx
```

---

## Recipe API Usage

### Basic Usage

```typescript
import { 
  RecipeRunner, 
  recipeTemplates, 
  createDualModelConfig,
  createChatModel,
} from '@/lib/automation-core';

// Create models (Navigator = smart, Extractor = cheap)
const config = createDualModelConfig(geminiApiKey);
const navigatorLLM = createChatModel(config.navigator);
const extractorLLM = createChatModel(config.extractor);

// Create runner
const runner = new RecipeRunner({
  navigatorLLM,
  extractorLLM,
  maxItems: 20,
});

// Get page from browser context
const context = await BrowserContext.fromActiveTab();
const page = await context.getCurrentPage();

// Run pre-built recipe
const recipe = recipeTemplates.jobListingExtraction(url, 20);
const result = await runner.run(page, recipe);

console.log(result.items);  // Array of ExtractedJobData
console.log(result.stats);  // { commandsExecuted, scrollsPerformed, ... }
```

### Custom Recipe

```typescript
import { cmd, until } from '@/lib/automation-core/recipe';

const myRecipe: Recipe = {
  id: 'custom_extraction',
  name: 'Custom Job Extraction',
  commands: [
    cmd.openPage('https://example.com/jobs'),
    cmd.waitForPage(),
    cmd.waitForList(),
    
    cmd.repeat([
      cmd.forEachItemInList([
        cmd.clickItem(),
        cmd.wait(0.5),
        cmd.extractDetails(),
        cmd.save('job'),
        cmd.markDone(),
      ]),
      cmd.scrollForMore(),
    ], until.or(
      until.collected(50),
      until.noMoreItems()
    )),
  ],
};
```

---

## LLM Configuration

### Environment Variables

```env
# For Recipe API (recommended)
VITE_GEMINI_API_KEY=AIzaSy...

# For Agent API (legacy)
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

### Model Selection

```typescript
// tiered-factory.ts creates:
{
  navigator: {
    provider: 'gemini',
    model: 'gemini-2.0-flash',      // Smart, for binding discovery
    temperature: 0.1,
  },
  extractor: {
    provider: 'gemini', 
    model: 'gemini-2.0-flash-lite', // Cheapest, for parsing
    temperature: 0.0,
  }
}
```

---

## Session Reports

Each discovery run generates a detailed report:

```typescript
interface SessionReport {
  id: string;
  startedAt: number;
  endedAt: number;
  duration: number;
  
  task: string;
  sourceUrl: string;
  searchQuery: string;
  
  success: boolean;
  stoppedReason: 'complete' | 'error' | 'stopped' | 'max_reached';
  error?: string;
  
  jobsFound: number;
  jobsExtracted: Job[];
  
  // Recipe stats
  bindingFixes: number;
  commandsExecuted: number;
  
  // Discovery steps
  steps: StepLog[];
  logs: string[];  // Detailed debug logs
  
  // Discovered bindings (for debugging)
  discoveredBindings?: Partial<PageBindings>;
}
```

Reports are saved to `chrome.storage.local` and viewable in the Reports tab.

---

## Cost Comparison

| Aspect | Agent API | Recipe API |
|--------|-----------|------------|
| LLM Calls per run | 20-50 | 2-3 |
| Model | Claude Sonnet | Gemini Flash + Flash-Lite |
| Cost per run | ~$1-2 | ~$0.01-0.02 |
| Cost for 60 runs | ~$60-120 | ~$0.60-1.20 |
| Speed | 5-10 min | ~1 min |
| Flexibility | Any task | Job extraction |

---

## Debugging

### Enable Logging

All key operations are logged. Check the service worker console:

```
[17:25:40.034] Starting discovery for: https://linkedin.com/jobs/...
[17:25:47.252] DOM elements obtained: 8099 chars
[Runner] Navigator SUCCESS: LIST="ul.jobs-search-results__list"
[Runner] FOR_EACH_ITEM_IN_LIST: found 9 items
[Runner] Processed 9/9 items, collected 7
[17:34:48.459] Recipe completed: success=true, items=7
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Failed to get page bindings" | LLM couldn't find selectors | Check DOM preview in logs, page may not be loaded |
| "Timeout waiting for condition" | Selector doesn't exist | Bindings are stale, will auto-retry |
| 0 items extracted | DETAILS_CONTENT empty | Fixed: now uses LIST_ITEM as fallback |
| Company shows "Unknown" | Text parsing issue | Improved extraction prompt |

### Force Fresh Binding Discovery

If cached bindings are stale:

```typescript
import { clearBindingsForUrl } from '@/lib/automation-core';

await clearBindingsForUrl('linkedin.com/jobs');
```

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-01-19 | **Major: Recipe API implemented** - 100x cost reduction |
| 2026-01-19 | Navigator LLM discovers page bindings from DOM |
| 2026-01-19 | Inline click behavior for LinkedIn cards |
| 2026-01-19 | Session reports with detailed logs |
| 2026-01-19 | Automatic retry with fresh bindings on failure |
| 2026-01-17 | Fixed buildDomTree.js |
| 2026-01-16 | Updated docs with complete call flow |
| 2026-01-15 | Initial implementation |
