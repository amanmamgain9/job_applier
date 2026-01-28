# Page Explorer Architecture

## Overview

The explorer uses a **simple Manager loop** with automatic visual analysis, guided by explicit goals:
- **Manager Agent** decides what action to take (click, scroll, done)
- **Orchestrator** executes the action and **automatically** analyzes what changed
- **Analyzer** compares before/after screenshots using vision LLM
- **Memory** stores page info and navigation path
- **Goals** (from the discovery request) act as a checklist and shape the final output

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                      MANAGER AGENT                              │
│  Sees: task, goals, memory summary, action history, DOM        │
│  Tools: explore(action, target, reason), done()                │
│  Output: goal-by-goal understanding                            │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                               │
│  1. Manager picks action                                        │
│  2. Capture BEFORE screenshot                                   │
│  3. Execute action (click/scroll)                               │
│  4. Capture AFTER screenshot                                    │
│  5. Run Analyzer (visual comparison)                            │
│  6. Add result to action history                                │
│  7. Repeat                                                      │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│                      ANALYZER (Visual)                          │
│  1. Receive before/after screenshots                            │
│  2. Send both images to vision LLM                             │
│  3. LLM compares and returns 1-2 sentence summary              │
│  4. Simple, reliable, no DOM parsing                           │
└────────────────────────────────────────────────────────────────┘
```

---

## Key Design Principles

### 1. Manager Only Picks Actions

The Manager has just TWO tools:
- `explore(action, target, reason)` - Click or scroll
- `done(understanding, key_elements)` - Finish exploration

**Analysis is automatic** - happens after every explore action.

**Goals drive exploration**:
- Goals come from the discovery request
- Manager treats goals as a checklist
- Final understanding is structured goal-by-goal

### 2. Visual Analysis

Instead of complex DOM diffing, we:
1. Take screenshot BEFORE action
2. Execute action
3. Take screenshot AFTER action
4. Send both to vision LLM: "What changed?"

**Why visual?**
- Handles any page structure
- No brittle selectors or regex parsing
- LLM sees exactly what user sees
- Works with any framework (React, Ember, Vue, etc.)

### 3. Simple Output

The Analyzer returns just:
```typescript
interface AnalyzerOutput {
  summary: string;           // "Details panel appeared with job info"
  urlChanged: boolean;
  hasVisualChanges: boolean;
}
```

No brittle classifications like `elementType` or `pageType`. Just a description.

---

## Visual Analyzer

```
Before Screenshot ──┐
                    ├── Send to Vision LLM
After Screenshot ───┘
                          │
                          ▼
              "Compare these screenshots.
               What changed after the action?"
                          │
                          ▼
              LLM returns visual description:
              "Job details panel updated with new position"
```

**Prompt to LLM:**
- System: "You analyze what changed on a webpage after a user action."
- User: Action taken + URL change info + BEFORE image + AFTER image
- Response: 1-2 sentence description

**Token usage:**
- Each screenshot: ~1000-2000 tokens (compressed JPEG)
- Total per analysis: ~3000-5000 tokens
- Much more reliable than DOM parsing

---

## Agents

### 1. Manager Agent

**Purpose:** Decide what action to take next.

**Tools:**

| Tool | Description |
|------|-------------|
| `explore(action, target?, reason)` | Take action: click, scroll_down, scroll_up |
| `done(understanding, key_elements)` | Finish exploration |

**Prompt Context:**
- Task description
- Memory summary
- Recent action history (with analysis summaries)
- Current DOM (text representation for selector lookup)

### 2. Analyzer

**Purpose:** Understand what changed after an action.

**Input:**
- Action taken
- Before/after URLs
- Before/after screenshots (base64 JPEG)

**Output:**
- `summary`: Human-readable description
- `urlChanged`: Boolean
- `hasVisualChanges`: Boolean

### 3. Summarizer Agent

**Purpose:** Compress observations into concise understanding.

**When Called:**
- At the end of exploration (before `done()`)

---

## Memory Store

### Data Structure

```typescript
interface MemoryStore {
  pages: Map<string, PageNode>;
  currentPageId: string | null;
  navigationPath: string[];
}

interface PageNode {
  id: string;                     // "www_linkedin_com"
  understanding: string;          // Task/purpose
  rawObservations: string[];      // Action history
}
```

### Key Methods

```typescript
class MemoryStore {
  initializePage(pageId, understanding, url): void;
  getSummary(): string;
  getDiscoveredSelectors(): KeyElements;
}
```

---

## Workflow Example

```
Step 1: Manager → explore(click, "#ember244", "see job details")
        Orchestrator → takes BEFORE screenshot
        Orchestrator → clicks element
        Orchestrator → takes AFTER screenshot
        Analyzer → sends both to vision LLM
        LLM → "Job details panel appeared on the right with title and Apply button"
        History: click "#ember244" → Job details panel appeared on the right...

Step 2: Manager (sees history) → explore(click, ".apply-btn", "try applying")
        ...

Step N: Manager → done(understanding, key_elements)
```

---

## Output Format

```typescript
interface ExplorationResult {
  success: boolean;
  pages: Map<string, PageNode>;
  navigationPath: string[];
  finalUnderstanding: string; // goal-by-goal summary
  keyElements?: {
    filter_button?: string;
    apply_button?: string;
    job_listings?: string[];
    search_input?: string;
  };
  error?: string;
}
```

---

## Phases

### Phase 1 (current): Goal-Driven Discovery
- Accept task + explicit goals from the discovery request
- Explore the page to satisfy each goal
- Output a goal-by-goal understanding and key selectors

### Phase 2 (next): Goal Execution
- Use the discovered selectors and understanding to execute the goals
- Example: apply filters, open listings, capture apply links

---

## File Structure

```
src/lib/automation-core/explorer/
├── ARCHITECTURE.md          # This document
├── index.ts                 # Exports
├── orchestrator.ts          # Simple manager loop with visual analysis
├── agents/
│   ├── index.ts             # Agent exports
│   ├── manager.ts           # Decides actions
│   ├── analyzer.ts          # Visual comparison + LLM summary
│   └── summarizer.ts        # Final summarization
└── memory/
    ├── index.ts             # Memory exports
    ├── store.ts             # MemoryStore class
    └── types.ts             # PageNode, etc.
```

---

## Evolution History

| Version | Approach | Issues |
|---------|----------|--------|
| v1 | Single agent with all tools | Too complex, poor decisions |
| v2 | Multiple agents with handoffs | Too many conditionals |
| v3 | Hash-based DOM diffing | Text format mismatch, 0 elements extracted |
| v4 (current) | Visual analysis with screenshots | Simple, reliable |

---

## Known Limitations

1. **Screenshot size:**
   - Each JPEG ~50-100KB base64
   - ~1000-2000 tokens per image
   - Acceptable for per-action analysis

2. **Vision LLM latency:**
   - Each analysis call takes 2-5 seconds
   - Acceptable given the overall exploration flow

3. **No pattern learning:**
   - Removed complex pattern/observation system
   - May revisit if needed for multi-page workflows

4. **Selector lookup:**
   - Manager still needs DOM text to know available selectors
   - Visual analysis doesn't help with "what can I click"
   - DOM text format provides this context
