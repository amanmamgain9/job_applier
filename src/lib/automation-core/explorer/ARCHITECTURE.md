# Page Explorer Architecture

## Overview

The explorer uses a **Discovery loop** with automatic visual analysis, guided by explicit goals:
- **Discovery Agent (step decider)** decides what action to take (click, scroll, done)
- **Discovery loop** executes the action and **automatically** analyzes what changed
- **Analyzer** compares before/after screenshots using vision LLM + PageMatch
- **DiscoverEventLog** stores the event log and current page key
- **Goals** (from the discovery request) act as a checklist and shape the final output

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                 DISCOVERY AGENT (DECIDER)                      │
│  Sees: task, goals, event-log summary, recent events, DOM      │
│  Tools: explore(action, target, reason), done()                │
│  Output: goal-by-goal understanding                            │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│                   DISCOVERY LOOP (EXECUTION)                   │
│  1. Step decider picks action                                   │
│  2. Capture BEFORE screenshot                                   │
│  3. Execute action (click/scroll)                               │
│  4. Capture AFTER screenshot                                    │
│  5. Run Analyzer + PageMatch                                    │
│  6. Record analyzer/page-change event in log                    │
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

### 1. Discovery Agent Only Picks Actions

The Discovery Agent has just TWO tools:
- `explore(action, target, reason)` - Click or scroll
- `done(understanding)` - Finish exploration

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

The Analyzer returns:
```typescript
interface DiscoveryAnalyzerResult {
  summary: string;           // "Details panel appeared with job info"
  urlChanged: boolean;
  significantChange: boolean;
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

### 1. Discovery Agent (Step Decider)

**Purpose:** Decide what action to take next.

**Tools:**

| Tool | Description |
|------|-------------|
| `explore(action, target?, reason)` | Take action: click, scroll_down, scroll_up |
| `done(understanding)` | Finish exploration |

**Prompt Context:**
- Task description
- Event-log summary
- Recent event log entries (with analyzer/page-change events)
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
- `significantChange`: Boolean

### 3. Page Match Agent

**Purpose:** Decide if two page states are the same page key.

**Input:**
- Before/after URLs
- Before/after screenshots (base64 JPEG)

**Output:**
- `isSamePage`: Boolean
- `reason`: short explanation

### 4. Summarizer Agent

**Purpose:** Compress observations into concise understanding.

**When Called:**
- At the end of exploration (before `done()`)

---

## Discovery State

### Data Structure

```typescript
interface DiscoverEventLog {
  events: DiscoveryEvent[];          // event log
  currentPageKey: string | null;
}

type DiscoveryEvent =
  | { kind: 'decision'; pageKey: string; timestamp: number; output: HandoffOutput<DiscoveryDecision> }
  | { kind: 'analyzer'; pageKey: string; timestamp: number; output: HandoffOutput<DiscoveryAnalyzerResult>; meta: { beforeUrl: string; afterUrl: string; beforeScreenshot: string | null; afterScreenshot: string | null } }
  | { kind: 'page_change'; pageKey: string; timestamp: number; output: HandoffOutput<PageChangeResult>; meta: { beforeUrl: string; afterUrl: string; beforeScreenshot: string | null; afterScreenshot: string | null; fromPageKey?: string; toPageKey?: string } }
  | { kind: 'summarizer'; pageKey: string; timestamp: number; output: HandoffOutput<DiscoverySummarizerResult> };
```

---

## Workflow Example

```
Step 1: Decider → explore(click, "#ember244", "see job details")
        Discovery Loop → takes BEFORE screenshot
        Discovery Loop → clicks element
        Discovery Loop → takes AFTER screenshot
        Analyzer → sends both to vision LLM
        LLM → "Job details panel appeared on the right with title and Apply button"
        PageMatch → decide if this is an existing page key
        EventLog: page_change → Job details panel appeared on the right...

Step 2: Decider (sees event log) → explore(click, ".apply-btn", "try applying")
        ...

Step N: Decider → done(understanding)
```

---

## Output Format

```typescript
interface ExplorationResult {
  success: boolean;
  pageKeys: string[];
  events: DiscoveryEvent[];
  finalUnderstanding: string; // goal-by-goal summary
  error?: string;
}
```

---

## Phases

### Phase 1 (current): Goal-Driven Discovery
- Accept task + explicit goals from the discovery request
- Explore the page to satisfy each goal
- Output a goal-by-goal understanding

### Phase 2 (next): Goal Execution
- Use the discovered selectors and understanding to execute the goals
- Example: apply filters, open listings, capture apply links

---

## File Structure

```
src/lib/automation-core/
├── explorer/
│   ├── ARCHITECTURE.md          # This document
│   ├── GOALS_AND_MEMORY.md      # Architecture + memory contract
│   ├── manager.ts               # Manager (Phase coordinator)
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
