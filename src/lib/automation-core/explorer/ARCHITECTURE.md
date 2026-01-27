# Page Explorer Architecture

## Overview

The explorer is a **multi-agent system** where:
- **LLM agents** communicate via **tool calls**
- **Code (Orchestrator)** handles execution, routing, and handoffs
- **Memory** persists understanding across agent calls

---

## Development Phases

The system is being built in two phases:

### Phase 1: Page Understanding (Current Phase)
**Goal:** Explore and understand any job search page structure.

**Output:** A structured understanding including:
- Page type classification
- Key UI element behaviors (what happens when you click)
- Important selectors for key elements (filter button, apply button, job listings)
- Navigation patterns

### Phase 2: Job Collection (Upcoming)
**Goal:** Use Phase 1 understanding to systematically collect job data.

**Input:** Phase 1 output (page understanding with key selectors)
**Output:** List of jobs with apply links

---

## Current Progress (Phase 1)

### ✅ Completed

| Component | Status | Notes |
|-----------|--------|-------|
| Multi-agent orchestration | ✅ Done | Orchestrator manages Explorer, ChangeAnalyzer |
| Explorer Agent | ✅ Done | click, scroll, type_text, observe, done tools |
| ChangeAnalyzer Agent | ✅ Done | Classifies DOM changes, provides elementType |
| Memory Store | ✅ Done | Pattern consolidation, page graph |
| DOM Serialization | ✅ Done | Clickable elements with selectors |
| Loop Detection | ✅ Done | Pattern-based + circuit breakers |
| Report Streaming | ✅ Done | Real-time logging to UI |

### ⚠️ Issues Identified (Fixed)

| Issue | Impact | Status |
|-------|--------|--------|
| Filter button classified as "unknown element" | Phase 2 won't know how to open filters | ✅ **Fixed** |
| Key selectors not in final output | Phase 2 lacks concrete starting points | ✅ **Fixed** |
| Shallow filter exploration | Phase 2 won't know filter options | ⚠️ **Partial** (Optional FilterAnalyzer) |

### ✅ Fixes Implemented

#### 1. ChangeAnalyzer Element Classification (Fixed)

**Before:**
```
click #ember150 → "Opened modal" → elementType: "unknown element"
```

**After:**
ChangeAnalyzer now classifies elements based on the EFFECT of the action:
- If filter modal opens → `elementType: "filter button"`
- If application modal opens → `elementType: "apply button"`
- If job details update → `elementType: "job listing"`
- If something closes → `elementType: "close button"`

**Implementation:** Updated `change-analyzer.ts` prompt with explicit classification guidance.

#### 2. Key Selectors in Output (Fixed)

**New Output Format:**
```json
{
  "understanding": "...",
  "keyFindings": ["..."],
  "keyElements": {
    "filter_button": "#ember150",
    "apply_button": "#jobs-apply-button-id",
    "job_listings": ["#ember224", "#ember214"],
    "search_input": "#jobs-search-box-keyword-id-ember100"
  }
}
```

**Implementation:**
- Added `key_elements` to `done()` tool parameters
- Added `KeyElements` interface to types
- Added `getDiscoveredSelectors()` to MemoryStore
- Orchestrator merges LLM-provided and memory-discovered selectors

#### 3. FilterAnalyzer Agent (Optional - Future Enhancement)

**Purpose:** Deep-dive into filter modals when discovered.

**Flow:**
```
Explorer clicks filter button
  → Modal opens
  → Orchestrator detects "filter modal" via ChangeAnalyzer
  → Handoff to FilterAnalyzer
  → FilterAnalyzer maps all filter options
  → Returns to Explorer
```

This remains a nice-to-have for deeper filter understanding.

---

## Phase 1 → Phase 2 Handoff Contract

Phase 2 expects this output from Phase 1:

```typescript
interface Phase1Output {
  pageType: string;              // "job_search", "job_board", etc.
  
  keyElements: {
    filterButton?: string;       // Selector to open filters
    applyButton?: string;        // Selector for apply action
    jobListings: string[];       // Selectors for job items
    searchInput?: string;        // Search box selector
    pagination?: string;         // Next page selector
  };
  
  behaviors: {
    [elementType: string]: {
      action: string;            // "click", "type"
      effect: string;            // "opens modal", "updates panel"
      confirmed: boolean;        // Observed 2+ times
    };
  };
  
  filterOptions?: {
    [filterName: string]: string[];  // e.g., "experience": ["Entry", "Mid", "Senior"]
  };
  
  understanding: string;         // Human-readable summary
}
```

---

## LLM-First Design Principles

1. **Tool calls are the interface** - Agents express intent through tools, code executes
2. **Each agent has specific tools** - Not all tools available to all agents
3. **Handoffs are explicit** - One agent completes, orchestrator decides next agent
4. **Returns flow through orchestrator** - Agent returns → code processes → next agent called

---

## Tool Call Flow

```
┌─────────────┐     tool_call      ┌──────────────┐     execute      ┌─────────────┐
│   AGENT     │ ─────────────────► │ ORCHESTRATOR │ ───────────────► │   BROWSER   │
│   (LLM)     │                    │    (Code)    │                  │   / MEMORY  │
│             │ ◄───────────────── │              │ ◄─────────────── │             │
└─────────────┘   tool_result      └──────────────┘     result       └─────────────┘
                                          │
                                          │ handoff decision
                                          ▼
                                   ┌──────────────┐
                                   │  NEXT AGENT  │
                                   │   (or done)  │
                                   └──────────────┘
```

---

## Agents & Their Tools

### 1. Explorer Agent

**Purpose:** Navigate and understand the page.

**Tools Available:**

| Tool | Args | Returns | Side Effects |
|------|------|---------|--------------|
| `click` | `selector`, `reason` | `{ success, new_url?, error? }` | Executes click, may change page |
| `scroll` | `direction`, `reason` | `{ success, new_content_loaded }` | Scrolls viewport |
| `type_text` | `selector`, `text`, `reason` | `{ success, error? }` | Types into input |
| `observe` | `what` | `{ dom, url, title }` | Gets fresh page state |
| `done` | `understanding`, `page_type`, `findings` | — | **HANDOFF: Signals exploration complete** |

**Handoff Triggers:**
- `done()` called → Orchestrator finalizes, returns result
- URL changed after `click()` → Orchestrator calls **Classifier Agent**

---

### 2. Classifier Agent

**Purpose:** Determine if URL change means new page type or same page with different data.

**Tools Available:**

| Tool | Args | Returns | Side Effects |
|------|------|---------|--------------|
| `classify` | `page_id`, `is_new_page`, `understanding`, `came_from?`, `via_action?` | — | **HANDOFF: Returns to Explorer** |

**When Invoked:** 
- Orchestrator detects ANY URL change
- Orchestrator calls Classifier with: old URL, new URL, **old DOM, new DOM**, known pages

**Key Design Decision:**
- Classifier receives BOTH old and new DOMs to compare structure
- LLM-powered classification decides if same page type or different
- No code-level exceptions - let the LLM decide based on DOM comparison

**Handoff:**
- After `classify()` → Orchestrator updates memory → **Returns to Explorer Agent**

---

### 3. Summarizer Agent

**Purpose:** Compress observations into concise understanding.

**Tools Available:**

| Tool | Args | Returns | Side Effects |
|------|------|---------|--------------|
| `summarize` | `page_id`, `summary` | — | **HANDOFF: Returns to caller** |

**When Invoked:**
- Before leaving a page (Explorer navigating away)
- When exploration completes (final summaries)
- Periodically if page has many observations

**Handoff:**
- After `summarize()` → Orchestrator stores summary → Returns to previous agent or finishes

---

## Handoff Flow Diagram

```
                              START
                                │
                                ▼
                    ┌───────────────────────┐
                    │   EXPLORER AGENT      │
                    │   (has full toolset)  │
                    └───────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
        click/scroll      observe()           done()
              │                 │                 │
              ▼                 │                 ▼
        Execute action          │            ┌────────┐
              │                 │            │SUMMARIZE│
              ▼                 │            │all pages│
        URL changed?            │            └────────┘
         /        \             │                 │
        NO        YES           │                 ▼
        │          │            │              FINISH
        │          ▼            │
        │   ┌─────────────┐     │
        │   │ CLASSIFIER  │     │
        │   │   AGENT     │     │
        │   └─────────────┘     │
        │          │            │
        │          ▼            │
        │    classify()         │
        │          │            │
        │          ▼            │
        │   Update Memory       │
        │          │            │
        └──────────┴────────────┘
                   │
                   ▼
            Back to EXPLORER
            (with fresh context)
```

---

## Orchestrator Responsibilities

The orchestrator (code) handles:

### 1. Tool Execution
```typescript
async function executeTool(agent: Agent, toolCall: ToolCall): Promise<ToolResult> {
  switch (toolCall.name) {
    case 'click':
      const oldUrl = browser.getUrl();
      const result = await browser.click(toolCall.args.selector);
      const newUrl = browser.getUrl();
      return { 
        success: result.success, 
        url_changed: oldUrl !== newUrl,
        new_url: newUrl 
      };
    case 'observe':
      return { dom: await browser.getDom(), url: browser.getUrl() };
    // ... etc
  }
}
```

### 2. Handoff Decisions
```typescript
async function handleToolResult(agent: Agent, toolCall: ToolCall, result: ToolResult) {
  // Check for handoff triggers
  if (toolCall.name === 'click' && result.url_changed) {
    // HANDOFF to Classifier
    await runClassifierAgent(result.old_url, result.new_url);
    // Then return to Explorer with fresh context
  }
  
  if (toolCall.name === 'done') {
    // HANDOFF to Summarizer for each page
    for (const pageId of memory.getPageIds()) {
      await runSummarizerAgent(pageId);
    }
    // Then FINISH
    return { finished: true };
  }
  
  // No handoff - continue with same agent
  return { finished: false, continueAgent: agent };
}
```

### 3. Context Building per Agent

Each agent gets different context:

```typescript
function buildContext(agent: AgentType): Context {
  switch (agent) {
    case 'explorer':
      return {
        systemPrompt: EXPLORER_SYSTEM_PROMPT,
        tools: [clickTool, scrollTool, typeTool, observeTool, doneTool],
        userMessage: buildExplorerMessage(memory.getSummary(), currentDom, task)
      };
    case 'classifier':
      return {
        systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
        tools: [classifyTool],
        userMessage: buildClassifierMessage(oldUrl, newUrl, newDom, memory.getPageIds())
      };
    case 'summarizer':
      return {
        systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
        tools: [summarizeTool],
        userMessage: buildSummarizerMessage(pageId, memory.getObservations(pageId))
      };
  }
}
```

---

## Memory Updates from Tool Returns

| Tool Call | Memory Update |
|-----------|---------------|
| `click(selector, reason)` | Record action in navigation log |
| `observe(what)` | (no update, just returns data) |
| `classify(page_id, ...)` | Create/update PageNode, add edges |
| `summarize(page_id, summary)` | Store summary in PageNode |
| `done(...)` | Mark exploration complete |

---

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                           │
│  - Executes tool calls from agents                          │
│  - Decides handoffs based on tool results                   │
│  - Builds context for each agent                           │
│  - Manages the main loop                                    │
└─────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│    EXPLORER      │  │   CLASSIFIER     │  │   SUMMARIZER     │
│  Tools: click,   │  │  Tools: classify │  │  Tools: summarize│
│  scroll, type,   │  │                  │  │                  │
│  observe, done   │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
           │                    │                    │
           └────────────────────┼────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                       MEMORY STORE                          │
│  - Map<page_id, PageNode>                                   │
│  - Updated by orchestrator after tool calls                 │
│  - Serialized for agent context                            │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER INTERFACE                        │
│  - Execute actions (click, scroll, type)                   │
│  - Get DOM state                                            │
│  - Track URL                                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Tool Definitions

### Explorer Agent Tools

```typescript
const explorerTools = [
  {
    name: 'click',
    description: 'Click an element on the page',
    parameters: {
      selector: { type: 'string', description: 'CSS selector - copy exactly from [CLICK: "..."]' },
      reason: { type: 'string', description: 'Why clicking this element' }
    },
    returns: '{ success: boolean, url_changed: boolean, new_url?: string, error?: string }'
  },
  {
    name: 'scroll',
    description: 'Scroll the page to see more content',
    parameters: {
      direction: { type: 'string', enum: ['down', 'up'] },
      reason: { type: 'string' }
    },
    returns: '{ success: boolean, new_content_loaded: boolean }'
  },
  {
    name: 'type_text',
    description: 'Type text into an input field',
    parameters: {
      selector: { type: 'string' },
      text: { type: 'string' },
      reason: { type: 'string' }
    },
    returns: '{ success: boolean, error?: string }'
  },
  {
    name: 'observe',
    description: 'Get fresh DOM state of current page',
    parameters: {
      what: { type: 'string', description: 'What to observe (e.g., "page", "modal")' }
    },
    returns: '{ dom: string, url: string, title: string }'
  },
  {
    name: 'done',
    description: 'Signal exploration is complete. HANDOFF: Triggers summarization and finish.',
    parameters: {
      understanding: { type: 'string', description: 'Overall understanding of the site' },
      page_type: { type: 'string', description: 'Type of current page' },
      key_findings: { type: 'array', items: { type: 'string' } }
    },
    returns: 'void (triggers handoff)'
  }
];
```

### Classifier Agent Tools

```typescript
const classifierTools = [
  {
    name: 'classify',
    description: 'Classify whether this is a new page or same page with different data. HANDOFF: Returns control to Explorer.',
    parameters: {
      page_id: { type: 'string', description: 'Semantic name for this page type' },
      is_new_page: { type: 'boolean', description: 'True if this is a new page type' },
      understanding: { type: 'string', description: 'What this page is about' },
      came_from: { type: 'string', description: 'If new page, which page_id we came from' },
      via_action: { type: 'string', description: 'What action led to this page' }
    },
    returns: 'void (triggers handoff back to Explorer)'
  }
];
```

### Summarizer Agent Tools

```typescript
const summarizerTools = [
  {
    name: 'summarize',
    description: 'Provide condensed summary of a page. HANDOFF: Returns to orchestrator.',
    parameters: {
      page_id: { type: 'string', description: 'Which page this summary is for' },
      summary: { type: 'string', description: 'Condensed understanding of the page' }
    },
    returns: 'void (summary stored, handoff complete)'
  }
];
```

---

## Example: Full Exploration Session

### Turn 1: Explorer starts
```
[Orchestrator] → Explorer Agent
Context: { dom: "...", memory: "(empty)", task: "Find jobs" }
Tools: [click, scroll, type_text, observe, done]

[Explorer] calls: click({ selector: "#jobs-nav", reason: "Navigate to jobs section" })

[Orchestrator] executes click
Result: { success: true, url_changed: true, new_url: "linkedin.com/jobs" }

[Orchestrator] detects URL change → HANDOFF to Classifier
```

### Turn 2: Classifier classifies new page
```
[Orchestrator] → Classifier Agent
Context: { 
  old_url: "linkedin.com", 
  new_url: "linkedin.com/jobs",
  dom: "...",
  known_pages: ["homepage"]
}
Tools: [classify]

[Classifier] calls: classify({
  page_id: "job_search",
  is_new_page: true,
  understanding: "Job search page with filters and listings",
  came_from: "homepage",
  via_action: "clicked Jobs nav"
})

[Orchestrator] updates memory:
  - Creates PageNode "job_search"
  - Adds edge: homepage → job_search via "clicked Jobs nav"

[Orchestrator] → HANDOFF back to Explorer
```

### Turn 3: Explorer continues
```
[Orchestrator] → Explorer Agent
Context: { 
  dom: "...(job search page)...", 
  memory: "PAGES: [homepage, job_search]. YOU ARE ON: job_search",
  task: "Find jobs"
}
Tools: [click, scroll, type_text, observe, done]

[Explorer] calls: click({ selector: ".job-card:first", reason: "See job details" })

[Orchestrator] executes click
Result: { success: true, url_changed: false }  // Panel opened, no navigation

[Orchestrator] no URL change → Continue with Explorer
```

### Turn 4: Explorer observes panel
```
[Explorer] calls: observe({ what: "details panel" })

[Orchestrator] returns: { dom: "...(includes panel)...", url: "..." }

[Explorer] calls: done({
  understanding: "LinkedIn jobs: search with filters, click job opens details panel",
  page_type: "job_search",
  key_findings: ["Filters: date, experience, location", "Click job → panel, not new page"]
})

[Orchestrator] → HANDOFF to Summarizer for each page
```

### Turn 5: Summarizer finalizes
```
[Orchestrator] → Summarizer Agent (for "homepage")
Context: { page_id: "homepage", observations: [...] }
Tools: [summarize]

[Summarizer] calls: summarize({
  page_id: "homepage",
  summary: "LinkedIn landing page. Nav links to Jobs, People, Posts."
})

[Orchestrator] stores summary → Next page

[Orchestrator] → Summarizer Agent (for "job_search")
...

[Orchestrator] → FINISH, return final result
```

---

## Handoff Rules

| Trigger | From Agent | To Agent | Data Passed |
|---------|------------|----------|-------------|
| `click()` returns `url_changed: true` | Explorer | Classifier | old_url, new_url, new_dom, known_pages |
| `classify()` called | Classifier | Explorer | (memory updated, fresh context) |
| `done()` called | Explorer | Summarizer (loop) | page_id, observations for each page |
| `summarize()` called | Summarizer | Orchestrator/Next | (summary stored) |
| All summaries done | Summarizer | FINISH | Final result returned |

---

## Memory Store

### Data Structure

```typescript
interface MemoryStore {
  pages: Map<string, PageNode>;
  currentPageId: string | null;
  previousPageId: string | null;
  navigationPath: string[];  // breadcrumb trail
}

interface PageNode {
  id: string;                     // "homepage", "job_search"
  understanding: string;          // summarized understanding
  rawObservations: string[];      // collected before summarization
  incomingEdges: Edge[];          // how to reach this page
  outgoingEdges: Edge[];          // where you can go from here
  visitCount: number;             // times visited
  lastVisitedAt: number;          // timestamp
}

interface Edge {
  fromPageId: string;
  toPageId: string;
  action: string;                 // "clicked Jobs nav link"
  selector?: string;              // the actual selector used
}
```

### Operations

```typescript
class MemoryStore {
  // Update from classifier response
  updateFromClassification(result: ClassifierResult, previousUrl: string): void;
  
  // Add pattern observation using LLM-classified element type
  addPatternObservation(data: {
    action: string;
    selector?: string;
    elementType: string;  // LLM-classified
    effect: string;
    changeType: string;
  }): void;
  
  // Add simple string observation (warnings, notes)
  enrichCurrentPage(observation: string): void;
  
  // Get summary for LLM context
  getSummary(): string;
  
  // Get all page IDs (for classifier)
  getPageIds(): string[];
  
  // Get current page
  getCurrentPageId(): string | null;
  
  // Finalize understanding (calls summarizer for each page)
  getFinalUnderstanding(): FinalResult;
}
```

### Memory Summary Format (for LLM)

```
EXPLORED PAGES:
[homepage]: LinkedIn landing page with nav to Jobs, People, Posts. Main search bar at top.
  → leads to: [job_search] via "clicked Jobs nav"

[job_search]: Job search with filters (date, experience, location), job list, details panel.
  ← from: [homepage] via "clicked Jobs nav"
  → leads to: [job_details] via "clicked job listing"

[job_details]: Full job posting with apply button, description, requirements, company info.
  ← from: [job_search] via "clicked job listing"

CURRENT PAGE: [job_search]
PATH: homepage → job_search
```

---

## Main Loop

```typescript
async function explore(task: string, startUrl: string): Promise<ExplorationResult> {
  const memory = new MemoryStore();
  const browser = await BrowserInterface.open(startUrl);
  
  let previousUrl = startUrl;
  
  // Initial classification
  const initialDom = await browser.getDom();
  const initialClassification = await classifyPage({
    fromUrl: null,
    toUrl: startUrl,
    dom: initialDom,
    knownPages: [],
  });
  memory.updateFromClassification(initialClassification, null);
  
  // Main loop
  while (true) {
    const currentUrl = browser.getUrl();
    const dom = await browser.getDom();
    
    // 1. URL changed? → Classify the page
    if (currentUrl !== previousUrl) {
      const classification = await classifyPage({
        fromUrl: previousUrl,
        toUrl: currentUrl,
        dom,
        knownPages: memory.getPageIds(),
      });
      
      // If leaving a page, summarize it first
      if (!classification.is_same_page && memory.getCurrentPageId()) {
        await summarizeAndStore(memory, memory.getCurrentPageId());
      }
      
      memory.updateFromClassification(classification, previousUrl);
    }
    
    // 2. Decide next action
    const context = buildExplorerContext({
      dom,
      memorySummary: memory.getSummary(),
      task,
      currentPageId: memory.getCurrentPageId(),
    });
    
    const decision = await explorer(context);
    
    // 3. Update memory with LLM-classified pattern
    memory.addPatternObservation({
      action: action.type,
      selector: action.selector,
      elementType: changeAnalysis.elementType,  // From ChangeAnalyzer LLM
      effect: changeAnalysis.description,
      changeType: changeAnalysis.changeType,
    });
    
    // 4. Execute action or finish
    if (decision.action === 'done') {
      // Summarize current page before finishing
      await summarizeAndStore(memory, memory.getCurrentPageId());
      return memory.getFinalUnderstanding();
    }
    
    previousUrl = currentUrl;
    await browser.execute(decision.action, decision.params);
  }
}
```

---

## When Each LLM Gets Called

| Event | LLM Call | Purpose |
|-------|----------|---------|
| URL changed | **Classifier** | Is this new page or same page with new data? |
| Every turn | **Explorer** | What to do next? What do you observe? |
| Leaving a page | **Summarizer** | Compress observations before switching context |
| Done exploring | **Summarizer** | Final summary for each page |

---

## URL Change Detection

### Same Page (SPA data change)
```
FROM: linkedin.com/jobs/search?keywords=engineer
TO:   linkedin.com/jobs/search?keywords=developer

Classifier says: is_same_page = true
Memory: Update existing page node, don't create new
```

### New Page (actual navigation)
```
FROM: linkedin.com/jobs/search?...
TO:   linkedin.com/jobs/view/12345

Classifier says: is_same_page = false, page_id = "job_details"
Memory: Create new page node, add edge from previous
```

### No URL Change (modal/panel)
```
URL stays same, but DOM changed (e.g., panel opened)

No classifier call needed
Explorer just observes: "clicking job opens details panel"
Memory: Enrich current page understanding
```

---

## Benefits of This Architecture

1. **Focused LLM calls** - Each agent has one job, less confusion
2. **Bounded context** - Summarizer compresses, no DOM accumulation
3. **Code controls flow** - Routing, state, storage handled by code
4. **Memory is structured** - Graph stored in Map, easy to query
5. **Semantic page identity** - LLM decides what's "same page", not brittle URL matching
6. **Resilient to SPAs** - Handles URL changes that don't mean new page

---

## File Structure

```
src/lib/automation-core/explorer/
├── ARCHITECTURE.md          # This document
├── index.ts                 # Exports
├── orchestrator.ts          # Main loop
├── agents/
│   ├── change-analyzer.ts   # DOM change classifier LLM
│   ├── explorer.ts          # Action decider LLM
│   └── summarizer.ts        # Observation compressor LLM (future)
├── memory/
│   ├── store.ts             # MemoryStore class
│   └── types.ts             # PageNode, Edge, BehaviorPattern interfaces
└── types.ts                 # Shared types
```

---

## Phase 2: Job Collection (Design Preview)

### Overview

Phase 2 takes the output from Phase 1 and systematically collects job data.

```
┌─────────────────────┐     Phase 1 Output     ┌─────────────────────┐
│   PHASE 1           │ ─────────────────────► │   PHASE 2           │
│   (Exploration)     │   keyElements,         │   (Collection)      │
│                     │   behaviors,           │                     │
│                     │   understanding        │                     │
└─────────────────────┘                        └─────────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────────┐
                                               │   JOB DATA          │
                                               │   - title           │
                                               │   - company         │
                                               │   - apply_link      │
                                               │   - location        │
                                               └─────────────────────┘
```

### Phase 2 Agents

#### 1. Collector Agent

**Purpose:** Iterate through job listings and extract data.

**Tools:**
| Tool | Args | Returns |
|------|------|---------|
| `select_job` | `selector` | `{ job_details_dom }` |
| `extract_data` | — | `{ title, company, location, apply_url }` |
| `next_page` | — | `{ success, has_more }` |
| `apply_filters` | `filter_settings` | `{ success, job_count }` |
| `finish` | `jobs[]` | — |

**Flow:**
```
1. Apply filters if needed (using Phase 1's filterButton selector)
2. For each job listing (using Phase 1's jobListings selectors):
   a. Click to select
   b. Extract data from details panel
   c. Find apply link
3. Check pagination
4. Repeat until done
```

#### 2. Extractor Agent

**Purpose:** Parse job details from DOM into structured data.

**Input:** Raw DOM of job details panel
**Output:** Structured job object

```typescript
interface JobData {
  title: string;
  company: string;
  location: string;
  salary?: string;
  applyUrl: string;
  applyType: 'easy_apply' | 'external' | 'unknown';
  postedDate?: string;
  description?: string;
}
```

### Phase 2 Memory

Separate from Phase 1 memory. Tracks:
- Jobs collected so far
- Pages visited (for deduplication)
- Filter state applied
- Errors/retries

### Phase 2 Circuit Breakers

- Max jobs per session (e.g., 100)
- Max pages (e.g., 10)
- Consecutive errors threshold
- Duplicate detection

---

## Development Roadmap

```
Phase 1 (COMPLETE ✅)
├── [x] Multi-agent orchestration
├── [x] Explorer Agent
├── [x] ChangeAnalyzer Agent
├── [x] Memory Store with patterns
├── [x] Loop detection
├── [x] Better element classification
├── [x] Key selector tracking in output
└── [ ] (Optional) FilterAnalyzer Agent for deep filter mapping

Phase 2 (READY TO START ← YOU ARE HERE)
├── [ ] Collector Agent
├── [ ] Extractor Agent
├── [ ] Pagination handling
├── [ ] Filter application
└── [ ] Job deduplication

Phase 3 (Future)
├── [ ] Apply automation
├── [ ] Resume/cover letter customization
└── [ ] Application tracking
```

