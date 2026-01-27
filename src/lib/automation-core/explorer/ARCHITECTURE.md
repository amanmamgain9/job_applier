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
| Multi-agent orchestration | ✅ Done | Orchestrator manages Explorer, ChangeAnalyzer, Consolidator, Summarizer |
| Explorer Agent | ✅ Done | click, scroll, type_text, observe, done tools |
| ChangeAnalyzer Agent | ✅ Done | Unified agent: classifies DOM changes, element types, AND page types |
| Consolidator Agent | ✅ Done | LLM-based pattern recognition and consolidation |
| Summarizer Agent | ✅ Done | Compresses observations into concise summaries |
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
| `done` | `understanding`, `page_type`, `key_findings`, `key_elements?` | — | **HANDOFF: Signals exploration complete** |

**Handoff Triggers:**
- `done()` called → Orchestrator runs final consolidation, summarizes pages, returns result
- After ANY action → Orchestrator calls **ChangeAnalyzer** to analyze what changed

---

### 2. ChangeAnalyzer Agent

**Purpose:** Unified agent that analyzes ALL DOM changes after actions. Handles:
- URL change classification (is this a new page type?)
- Same-page change classification (modal opened? content loaded?)
- Element type classification (what was clicked?)

**Tools Available:**

| Tool | Args | Returns | Side Effects |
|------|------|---------|--------------|
| `analyze_change` | `description`, `element_type`, `change_type`, `page_type`, `is_new_page_type`, `page_understanding` | — | Returns analysis to Orchestrator |

**When Invoked:** 
- After EVERY action (click, scroll, type_text)
- Receives: before/after DOM, before/after URL, action description

**Key Design Decision:**
- Single agent handles both URL-change and same-page change analysis
- Classifies elements by their EFFECT (filter modal appeared → "filter button")
- Hard override: cannot claim "navigation" if URL didn't actually change

**Output:**
- `changeType`: navigation, modal_opened, modal_closed, content_loaded, content_removed, selection_changed, no_change, minor_change
- `elementType`: "job listing", "filter button", "apply button", "close button", etc.
- `isNewPageType`: true only if URL changed AND fundamentally different page

---

### 3. Consolidator Agent

**Purpose:** LLM-based pattern recognition. Groups similar behaviors and determines confidence levels.

**Tools Available:**

| Tool | Args | Returns | Side Effects |
|------|------|---------|--------------|
| `consolidate_patterns` | `patterns[]`, `uncategorized[]` | — | Returns consolidated patterns |

**When Invoked:**
- After every 3 observations (batch processing)
- If 30+ seconds since last consolidation
- Before final output (final consolidation)

**Key Design Decision:**
- Uses LLM (not code) to recognize patterns semantically
- Groups "click #ember200 → details" and "click #ember210 → details" as same pattern
- Tracks confidence: "testing" (seen once) vs "confirmed" (seen 2+ times)

**Handoff:**
- After consolidation → Orchestrator updates memory patterns → Continues exploration

---

### 4. Summarizer Agent

**Purpose:** Compress observations into concise understanding.

**Tools Available:**

| Tool | Args | Returns | Side Effects |
|------|------|---------|--------------|
| `summarize` | `page_id`, `summary` | — | **HANDOFF: Returns to caller** |

**When Invoked:**
- Before leaving a page (when URL changes to new page type)
- When exploration completes (final summaries for all pages)

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
        Execute action          │          ┌──────────────┐
              │                 │          │CONSOLIDATOR  │
              ▼                 │          │(final)       │
      ┌───────────────┐         │          └──────────────┘
      │CHANGE ANALYZER│         │                 │
      │(analyze_change)│        │                 ▼
      └───────────────┘         │          ┌──────────────┐
              │                 │          │SUMMARIZER    │
              ▼                 │          │(each page)   │
        Add observation         │          └──────────────┘
              │                 │                 │
              ▼                 │                 ▼
        New page type?          │              FINISH
         /        \             │
        NO        YES           │
        │          │            │
        │          ▼            │
        │   ┌─────────────┐     │
        │   │ SUMMARIZER  │     │
        │   │ (old page)  │     │
        │   └─────────────┘     │
        │          │            │
        │          ▼            │
        │   Update Memory       │
        │          │            │
        └──────────┴────────────┘
                   │
                   ▼
        Should consolidate?
         /        \
        NO        YES
        │          │
        │          ▼
        │   ┌─────────────┐
        │   │CONSOLIDATOR │
        │   │   AGENT     │
        │   └─────────────┘
        │          │
        └──────────┤
                   │
                   ▼
            Back to EXPLORER
            (with fresh context)
```

---

## Orchestrator Responsibilities

The orchestrator (code) handles:

### 1. Action Execution with DOM Capture
```typescript
async function executeAction(page: Page, action: ExplorerAction): Promise<ActionResult> {
  const oldUrl = (await page.getState()).url;

  switch (action.type) {
    case 'click':
      // Capture DOM before click
      const beforeState = await page.getState();
      const beforeDom = domTreeToString(beforeState.elementTree);
      
      await page.clickSelector(action.selector);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for updates
      
      // Capture DOM after click
      const newState = await page.getState();
      const afterDom = domTreeToString(newState.elementTree);
      
      return { 
        success: true, 
        urlChanged: newState.url !== oldUrl,
        newUrl: newState.url,
        oldUrl,
        beforeDom,
        afterDom
      };
    // ... scroll, type_text, observe
  }
}
```

### 2. Loop Detection & Circuit Breakers
```typescript
// Detect action loops
const isClickLoop = lastActions.every(a => a === lastActions[0] && a.startsWith('Clicked'));
const isScrollLoop = last5Actions.every(a => a.startsWith('Scrolled'));

// Circuit breakers
if (sameClickCount >= 4) {
  action = { type: 'observe', what: 'page after blocked repeated click' };
}
if (confirmedPattern.count >= 4 && confirmedCount >= 2) {
  action = { type: 'done', understanding: '...', keyFindings: memory.getAllPatternDescriptions() };
}
if (observeCount >= 4) {
  action = { type: 'done', ... }; // Force finish if stuck observing
}
```

### 3. Agent Coordination
```typescript
// After EVERY action: call ChangeAnalyzer
const changeAnalysis = await runChangeAnalyzer({
  llm, action: describeAction(action),
  beforeUrl, afterUrl, beforeDom, afterDom,
  knownPageTypes: memory.getPageIds(),
  currentPageType: memory.getCurrentPageId(),
});

// Periodically: call Consolidator
if (memory.shouldConsolidate()) {
  const result = await runConsolidator({ llm, input: memory.getConsolidationInput() });
  memory.updatePatternsFromConsolidation(consolidatorOutputToPatterns(result));
}

// On new page type: call Summarizer for old page
if (changeAnalysis.isNewPageType) {
  const summary = await runSummarizer({ llm, pageId: oldPageId, ... });
  memory.updatePageSummary(oldPageId, summary.summary);
  memory.updateFromClassification({ ... });
}

// On done(): call Consolidator (final) + Summarizer (each page)
```

### 4. Context Building per Agent

```typescript
// Explorer: gets DOM, memory summary, task, last action result
runExplorer({
  llm, dom: currentDom, memorySummary: memory.getSummary(),
  task, currentPageId: memory.getCurrentPageId(),
  lastActionResult,                     // Prominent: what just happened
  discoveryCount: confirmedPatternCount, // Encourage synthesis
  loopWarning: isLooping ? lastAction : undefined,
});

// ChangeAnalyzer: gets before/after DOM, before/after URL
runChangeAnalyzer({
  llm, action, beforeUrl, afterUrl, beforeDom, afterDom,
  knownPageTypes, currentPageType,
});

// Consolidator: gets raw observations, existing patterns
runConsolidator({
  llm, input: { rawObservations, existingPatterns, truncatedDom },
});

// Summarizer: gets page observations and current understanding
runSummarizer({
  llm, pageId, observations: page.rawObservations,
  currentUnderstanding: page.understanding,
});
```

---

## Memory Updates from Tool Returns

| Tool Call | Memory Update |
|-----------|---------------|
| `click(selector, reason)` | After ChangeAnalyzer: `addRawObservation()` with element type and effect |
| `observe(what)` | (no update, just returns fresh DOM) |
| `analyze_change(...)` | May call `updateFromClassification()` if new page type |
| `consolidate_patterns(...)` | `updatePatternsFromConsolidation()` replaces patterns array |
| `summarize(page_id, summary)` | `updatePageSummary()` stores summary, clears raw observations |
| `done(...)` | Final consolidation + summarization, then return result |

---

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                           │
│  - Executes tool calls from agents                          │
│  - Calls ChangeAnalyzer after every action                  │
│  - Calls Consolidator periodically (every 3 observations)   │
│  - Calls Summarizer when leaving pages or finishing         │
│  - Manages the main loop with circuit breakers              │
└─────────────────────────────────────────────────────────────┘
           │              │              │              │
           ▼              ▼              ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   EXPLORER   │  │CHANGE        │  │CONSOLIDATOR  │  │ SUMMARIZER   │
│  click,      │  │ANALYZER      │  │consolidate_  │  │ summarize    │
│  scroll,     │  │analyze_change│  │patterns      │  │              │
│  type_text,  │  │              │  │              │  │              │
│  observe,    │  │              │  │              │  │              │
│  done        │  │              │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
           │              │              │              │
           └──────────────┴──────────────┴──────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                       MEMORY STORE                          │
│  - Map<page_id, PageNode>                                   │
│  - patterns: BehaviorPattern[] (from Consolidator)          │
│  - rawObservations: string[] (from ChangeAnalyzer)          │
│  - pendingObservations: queue for consolidation             │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER INTERFACE (Page)                 │
│  - Execute actions (clickSelector, scrollToNextPage, etc.) │
│  - Get DOM state (getState → elementTree)                   │
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
    description: 'Click an element. May open modals, navigate, toggle state, or load content.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector - copy exactly from [CLICK: "..."] in the DOM' },
      reason: { type: 'string', description: 'What you expect to learn or happen' }
    }
  },
  {
    name: 'scroll',
    description: 'Scroll to reveal more content, pagination, or hidden elements.',
    parameters: {
      direction: { type: 'string', enum: ['down', 'up'] },
      reason: { type: 'string', description: 'What you hope to find' }
    }
  },
  {
    name: 'type_text',
    description: 'Type text into an input field',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the input' },
      text: { type: 'string', description: 'Text to type' },
      reason: { type: 'string', description: 'Why you are typing this' }
    }
  },
  {
    name: 'observe',
    description: 'Get a fresh snapshot of the DOM. Use after actions that might have changed content.',
    parameters: {
      what: { type: 'string', description: 'What changed you want to see (e.g., "modal contents", "updated list")' }
    }
  },
  {
    name: 'done',
    description: 'Call when you understand enough to explain how to accomplish the task on this site.',
    parameters: {
      understanding: { type: 'string', description: 'Full explanation of how the site works' },
      page_type: { type: 'string', description: 'What kind of page this is' },
      key_findings: { type: 'array', items: { type: 'string' }, description: 'Specific discoveries' },
      key_elements: { 
        type: 'object', 
        description: 'Important selectors: filter_button, apply_button, job_listings[], search_input, pagination'
      }
    }
  }
];
```

### ChangeAnalyzer Agent Tools

```typescript
const changeAnalyzerTools = [
  {
    name: 'analyze_change',
    description: 'Report what changed after the action',
    parameters: {
      description: { type: 'string', description: 'Human-readable description of what changed' },
      element_type: { 
        type: 'string', 
        description: 'Classify element by EFFECT: "filter button", "apply button", "job listing", "close button", "navigation link", "dropdown button", "save button", "pagination control"'
      },
      change_type: { 
        type: 'string', 
        enum: ['navigation', 'modal_opened', 'modal_closed', 'content_loaded', 'content_removed', 'selection_changed', 'no_change', 'minor_change']
      },
      page_type: { type: 'string', description: 'Semantic name for this page type' },
      is_new_page_type: { type: 'boolean', description: 'True only if URL changed AND fundamentally different page' },
      page_understanding: { type: 'string', description: 'What this page/state offers' }
    }
  }
];
```

### Consolidator Agent Tools

```typescript
const consolidatorTools = [
  {
    name: 'consolidate_patterns',
    description: 'Report consolidated behavioral patterns from observations',
    parameters: {
      patterns: {
        type: 'array',
        items: {
          id: { type: 'string', description: 'Unique pattern ID' },
          element_type: { type: 'string', description: 'Type of element' },
          action: { type: 'string', description: 'Action type: click, scroll, type_text' },
          effect: { type: 'string', description: 'DETAILED description of what happens' },
          change_type: { type: 'string', enum: ['navigation', 'modal_opened', ...] },
          confidence: { type: 'string', enum: ['testing', 'confirmed'] },
          count: { type: 'number', description: 'Times observed' },
          example_selectors: { type: 'array', items: { type: 'string' } }
        }
      },
      uncategorized: { type: 'array', items: { type: 'string' } }
    }
  }
];
```

### Summarizer Agent Tools

```typescript
const summarizerTools = [
  {
    name: 'summarize',
    description: 'Provide condensed summary of a page.',
    parameters: {
      page_id: { type: 'string', description: 'Which page this summary is for' },
      summary: { type: 'string', description: 'Condensed understanding of the page' }
    }
  }
];
```

---

## Example: Full Exploration Session

### Turn 1: Explorer starts, clicks
```
[Orchestrator] Initial page analysis via ChangeAnalyzer
  → pageType: "homepage", understanding: "LinkedIn landing page"
  → memory.updateFromClassification()

[Orchestrator] → Explorer Agent
Context: { dom: "...", memory: "PAGES: [homepage]. YOU ARE ON: homepage", task: "Find jobs" }
Tools: [click, scroll, type_text, observe, done]

[Explorer] calls: click({ selector: "#jobs-nav", reason: "Navigate to jobs section" })

[Orchestrator] executes click (captures beforeDom)
  → wait 1s
  → captures afterDom
Result: { success: true, urlChanged: true, newUrl: "linkedin.com/jobs" }

[Orchestrator] → ChangeAnalyzer (after action)
  beforeUrl: "linkedin.com", afterUrl: "linkedin.com/jobs"
  
[ChangeAnalyzer] calls: analyze_change({
  description: "Navigated to jobs search page",
  element_type: "navigation link",
  change_type: "navigation",
  page_type: "job_search",
  is_new_page_type: true,
  page_understanding: "Job search with filters and listings"
})

[Orchestrator] New page detected!
  → Summarize old page (homepage)
  → memory.updateFromClassification() for job_search
  → memory.addRawObservation()
```

### Turn 2: Explorer clicks job listing
```
[Orchestrator] → Explorer Agent
Context: { 
  dom: "...(job search page)...", 
  memory: "PAGES: [homepage, job_search]. CURRENT: job_search. LEARNED: [testing] click navigation link → navigation",
  lastActionResult: "Clicked #jobs-nav → Navigated to jobs search page"
}

[Explorer] calls: click({ selector: "#ember200", reason: "See job details" })

[Orchestrator] executes click → captures before/after DOM

[Orchestrator] → ChangeAnalyzer
  beforeUrl: "linkedin.com/jobs", afterUrl: "linkedin.com/jobs" (unchanged)

[ChangeAnalyzer] calls: analyze_change({
  description: "Job details panel updated with title, company, description",
  element_type: "job listing",
  change_type: "content_loaded",
  page_type: "job_search",
  is_new_page_type: false,
  page_understanding: "..."
})

[Orchestrator] memory.addRawObservation()
  → pendingObservations.length = 2
```

### Turn 3: Explorer clicks another job, Consolidator runs
```
[Explorer] calls: click({ selector: "#ember210", reason: "Try another job" })
...
[ChangeAnalyzer] → element_type: "job listing", effect: "panel updated"

[Orchestrator] memory.addRawObservation()
  → pendingObservations.length = 3
  → shouldConsolidate() = true!

[Orchestrator] → Consolidator Agent
Context: { 
  rawObservations: [...],
  existingPatterns: [...]
}

[Consolidator] calls: consolidate_patterns({
  patterns: [{
    id: "pattern_joblist_1",
    element_type: "job listing",
    action: "click",
    effect: "Updates job details panel with title, company, description, apply button",
    change_type: "content_loaded",
    confidence: "confirmed",  // seen 2x!
    count: 2,
    example_selectors: ["#ember200", "#ember210"]
  }],
  uncategorized: []
})

[Orchestrator] memory.updatePatternsFromConsolidation()
  → Pattern "job listing" now confirmed!
```

### Turn 4: Explorer finishes
```
[Explorer] (sees confirmed patterns in memory)
  → Calls done() with understanding

[Orchestrator] Final consolidation → Summarizer for each page

[Orchestrator] Merge keyElements:
  - From memory.getDiscoveredSelectors()
  - From action.keyElements (LLM-provided)

[Orchestrator] → FINISH, return ExplorationResult {
  success: true,
  pages: Map<...>,
  keyElements: { job_listings: ["#ember200", "#ember210"], ... }
}
```

---

## Handoff Rules

| Trigger | From Agent | To Agent | Data Passed |
|---------|------------|----------|-------------|
| After ANY action | Explorer (via Orch) | ChangeAnalyzer | before/after DOM, before/after URL, action |
| After ChangeAnalyzer | ChangeAnalyzer | (back to loop) | elementType, changeType, isNewPageType |
| shouldConsolidate() = true | Orchestrator | Consolidator | rawObservations, existingPatterns |
| New page type detected | Orchestrator | Summarizer | old page observations |
| `done()` called | Explorer | Consolidator (final) | all observations |
| After final consolidation | Consolidator | Summarizer (loop) | for each page |
| All summaries done | Summarizer | FINISH | Final result with keyElements |

---

## Memory Store

### Data Structure

```typescript
interface MemoryStore {
  pages: Map<string, PageNode>;
  currentPageId: string | null;
  previousPageId: string | null;
  navigationPath: string[];       // breadcrumb trail
  pendingObservations: RawObs[];  // queue for consolidation
  lastConsolidationAt: number;    // timestamp
}

interface PageNode {
  id: string;                     // "homepage", "job_search"
  understanding: string;          // summarized understanding
  rawObservations: string[];      // string descriptions of observations
  patterns: BehaviorPattern[];    // consolidated by Consolidator agent
  incomingEdges: Edge[];          // how to reach this page
  outgoingEdges: Edge[];          // where you can go from here
  visitCount: number;             // times visited
  lastVisitedAt: number;          // timestamp
  lastUrl: string;                // last URL seen for this page type
}

interface BehaviorPattern {
  id: string;                     // unique pattern id
  action: string;                 // "click", "scroll", etc.
  targetDescription: string;      // "job listing", "filter button"
  effect: string;                 // "updates details panel", "opens modal"
  changeType: string;             // from ChangeAnalyzer
  selectors: string[];            // example selectors (max 3)
  count: number;                  // how many times observed
  confirmed: boolean;             // true if count >= 2
  firstSeen: number;              // timestamp
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
  // Update from ChangeAnalyzer when new page detected
  updateFromClassification(result: ClassifierResult, previousUrl: string | null): void;
  
  // Add raw observation (before consolidation)
  addRawObservation(data: {
    action: string;
    selector?: string;
    elementType: string;  // from ChangeAnalyzer
    effect: string;
    changeType: string;
  }): void;
  
  // Replace patterns with consolidated patterns from Consolidator
  updatePatternsFromConsolidation(patterns: BehaviorPattern[]): void;
  
  // Get data needed for Consolidator agent
  getConsolidationInput(): { rawObservations, existingPatterns, pendingObservations };
  
  // Check if consolidation should run (every 3 obs or 30s timeout)
  shouldConsolidate(): boolean;
  
  // Add simple string observation (warnings, notes)
  enrichCurrentPage(observation: string): void;
  
  // Get matching confirmed pattern (for loop detection)
  getMatchingPattern(action: string, elementType?: string): BehaviorPattern | null;
  
  // Get discovered selectors organized by element type
  getDiscoveredSelectors(): KeyElements;
  
  // Get summary for LLM context
  getSummary(): string;
  
  // Update page summary from Summarizer
  updatePageSummary(pageId: string, summary: string): void;
  
  // Get all page IDs
  getPageIds(): string[];
  
  // Get final understanding for all pages
  getFinalUnderstanding(): string;
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
async function runOrchestrator(options: OrchestratorOptions): Promise<ExplorationResult> {
  const { page, task, llm, report, maxSteps = 20 } = options;
  const memory = new MemoryStore();
  let previousUrl = '';
  let stepCount = 0;
  const recentActions: string[] = [];
  let lastActionResult: string | null = null;

  // Get initial state
  const initialState = await page.getState();
  const initialDom = domTreeToString(initialState.elementTree, { includeSelectors: true });
  previousUrl = initialState.url;

  // Initial page analysis via ChangeAnalyzer
  const initialAnalysis = await runChangeAnalyzer({
    llm,
    action: 'Page loaded',
    beforeUrl: '',
    afterUrl: initialState.url,
    beforeDom: '',
    afterDom: initialDom,
    knownPageTypes: [],
  });
  memory.updateFromClassification({
    pageId: initialAnalysis.pageType,
    isNewPage: true,
    isSamePage: false,
    understanding: initialAnalysis.pageUnderstanding,
  }, null);

  // Main exploration loop
  while (stepCount < maxSteps) {
    stepCount++;
    const currentState = await page.getState();
    let currentDom = domTreeToString(currentState.elementTree, { includeSelectors: true });

    // Loop detection (click loops, scroll loops)
    const isLooping = detectLoops(recentActions);
    if (isLooping) {
      memory.enrichCurrentPage(`WARNING: Loop detected - try different actions`);
    }

    // Run Consolidator if needed (every 3 observations or 30s timeout)
    if (memory.shouldConsolidate()) {
      const consolidationInput = memory.getConsolidationInput();
      const consolidationResult = await runConsolidator({ llm, input: consolidationInput });
      memory.updatePatternsFromConsolidation(consolidatorOutputToPatterns(consolidationResult));
    }

    // Ask Explorer for next action
    const decision = await runExplorer({
      llm, dom: currentDom, memorySummary: memory.getSummary(),
      task, currentPageId: memory.getCurrentPageId(),
      lastActionResult, discoveryCount: memory.getConfirmedPatternCount(),
      loopWarning: isLooping ? recentActions.slice(-1)[0] : undefined,
    });

    let action = decision.action;
    
    // Circuit breakers (force observe/done if stuck)
    action = applyCircuitBreakers(action, recentActions, memory);

    // Handle done() action
    if (action.type === 'done') {
      // Final consolidation
      await runFinalConsolidation(llm, memory, currentDom);
      
      // Summarize all pages
      for (const pageId of memory.getPageIds()) {
        const pageNode = memory.getPage(pageId);
        if (pageNode?.rawObservations.length > 0) {
          const summary = await runSummarizer({ llm, pageId, ... });
          memory.updatePageSummary(pageId, summary.summary);
        }
      }

      // Merge key elements from LLM + discovered selectors
      const mergedKeyElements = {
        ...memory.getDiscoveredSelectors(),
        ...action.keyElements,
      };

      return {
        success: true,
        pages: memory.getAllPages(),
        navigationPath: memory.getNavigationPath(),
        finalUnderstanding: memory.getFinalUnderstanding(),
        keyElements: mergedKeyElements,
      };
    }

    // Execute the action
    const result = await executeAction(page, action);
    
    // Analyze what changed via ChangeAnalyzer
    if (result.success && result.beforeDom && result.afterDom) {
      const changeAnalysis = await runChangeAnalyzer({
        llm, action: describeAction(action),
        beforeUrl: result.oldUrl, afterUrl: result.newUrl,
        beforeDom: result.beforeDom, afterDom: result.afterDom,
        knownPageTypes: memory.getPageIds(),
        currentPageType: memory.getCurrentPageId(),
      });

      // Only record meaningful observations
      if (changeAnalysis.changeType !== 'no_change' && changeAnalysis.changeType !== 'minor_change') {
        memory.addRawObservation({
          action: action.type,
          selector: action.selector,
          elementType: changeAnalysis.elementType,
          effect: changeAnalysis.description,
          changeType: changeAnalysis.changeType,
        });
      }

      // If new page type, summarize old page and update memory
      if (changeAnalysis.isNewPageType && changeAnalysis.urlChanged) {
        await summarizeOldPage(llm, memory);
        memory.updateFromClassification({
          pageId: changeAnalysis.pageType,
          isNewPage: true,
          understanding: changeAnalysis.pageUnderstanding,
          cameFrom: changeAnalysis.cameFrom,
          viaAction: changeAnalysis.viaAction,
        }, previousUrl);
      }

      previousUrl = result.newUrl || previousUrl;
      lastActionResult = buildActionResultForLLM(action, changeAnalysis, memory);
    }

    recentActions.push(actionDesc);
  }

  // Max steps reached
  return { success: false, error: 'Max exploration steps reached', ... };
}
```

---

## When Each LLM Gets Called

| Event | LLM Call | Purpose |
|-------|----------|---------|
| After EVERY action | **ChangeAnalyzer** | What changed? Element type? New page? |
| Every turn | **Explorer** | What to do next? |
| Every 3 observations OR 30s timeout | **Consolidator** | Group similar behaviors into patterns |
| New page type detected | **Summarizer** | Compress old page before switching |
| Done exploring | **Consolidator** (final) | Final pattern consolidation |
| Done exploring | **Summarizer** (each page) | Final summary for each page |

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
├── index.ts                 # Exports (orchestrator, agents, memory, types)
├── orchestrator.ts          # Main loop with circuit breakers
├── page-explorer.ts         # Legacy explorer (for backwards compatibility)
├── tool-executor.ts         # Legacy tool executor (for backwards compatibility)
├── types.ts                 # Shared types (ToolDefinition, ExplorerResult, etc.)
├── agents/
│   ├── index.ts             # Agent exports
│   ├── change-analyzer.ts   # Unified DOM change + page classification LLM
│   ├── consolidator.ts      # LLM-based pattern recognition and consolidation
│   ├── explorer.ts          # Action decider LLM (click, scroll, type_text, observe, done)
│   └── summarizer.ts        # Observation compressor LLM
└── memory/
    ├── index.ts             # Memory exports
    ├── store.ts             # MemoryStore class
    └── types.ts             # PageNode, Edge, BehaviorPattern, KeyElements, ExplorationResult
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
├── [x] Explorer Agent (click, scroll, type_text, observe, done)
├── [x] ChangeAnalyzer Agent (unified DOM + page classification)
├── [x] Consolidator Agent (LLM-based pattern recognition)
├── [x] Summarizer Agent
├── [x] Memory Store with BehaviorPatterns
├── [x] Loop detection + circuit breakers
├── [x] Better element classification (by effect)
├── [x] Key selector tracking in output (getDiscoveredSelectors)
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

