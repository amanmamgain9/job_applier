# Streaming Extraction

## Problem

When extracting data from a list (e.g., job listings, search results, product catalogs), the current automation agent accumulates extracted data in the LLM's "memory" field. This creates growing context bloat:

```
Step 3:  LLM extracts Job 1 → memory: "Job 1: Engineer @ Google, SF, $150K..."
Step 4:  LLM extracts Job 2 → memory: "Job 1: ..., Job 2: PM @ Meta, NYC..."
Step 5:  LLM extracts Job 3 → memory: "Job 1: ..., Job 2: ..., Job 3: ..."
...
Step 12: LLM extracts Job 10 → memory contains ALL 10 jobs as text (~5K tokens)
```

**The problem**: Every step, we re-send all previously extracted data to the LLM, even though it's already captured. This wastes tokens and can hit context limits on large extractions.

## Solution: The `collect` Action

Add a new action that stores extracted data **in code**, not in the LLM's message history. The LLM only needs to track its progress ("Extracted 5/10 jobs"), not the actual data.

```
Step 3:  LLM extracts Job 1 → collect(job1) → stored in code
Step 4:  LLM extracts Job 2 → collect(job2) → stored in code
...
Step 12: LLM extracts Job 10 → collect(job10) → stored in code

LLM memory stays small: "Extracted 10/10 jobs. Calling done."
Actual data lives in: AgentContext.collectedItems
```

## API Design

### Action Schema

```typescript
// src/lib/automation-core/agent/actions/schemas.ts

export const collectActionSchema: ActionSchema = {
  name: 'collect',
  description: 'Store extracted data externally. Use this when extracting items from a list. Data is saved outside your context so you don\'t need to remember it - just track your count.',
  schema: z.object({
    type: z.string().optional().describe('Category/type of the item (e.g., "job", "product")'),
    data: z.record(z.unknown()).describe('The extracted data object'),
  }),
};
```

### Action Implementation

```typescript
// src/lib/automation-core/agent/actions/builder.ts

// In ActionBuilder.buildDefaultActions():

const collect = new Action(async (input: unknown) => {
  const args = input as { type?: string; data: Record<string, unknown> };
  const type = args.type || 'default';
  
  // Store in context (code), not message history
  // Returns false if duplicate
  const wasCollected = this.context.collect(args.data, type);
  
  if (!wasCollected) {
    // Duplicate detected - inform LLM but don't add to count
    return new ActionResult({
      extractedContent: `Duplicate ${type} skipped (already collected)`,
      includeInMemory: false,
    });
  }
  
  const itemCount = this.context.getCollectedCount(type);
  const msg = `Collected ${type} #${itemCount}`;
  
  return new ActionResult({
    extractedContent: msg,      // Brief confirmation
    includeInMemory: false,     // KEY: Don't add to LLM context
  });
}, collectActionSchema);
actions.push(collect);
```

### Context Storage (with Deduplication)

```typescript
// src/lib/automation-core/agent/types.ts

export class AgentContext {
  // ... existing fields ...
  
  // Streaming extraction storage
  private collectedItems: Map<string, unknown[]> = new Map();
  private collectedIds: Map<string, Set<string>> = new Map();  // Track unique IDs
  
  /**
   * Collect an extracted item (stores in code, not LLM memory)
   * Automatically deduplicates based on inferred unique ID
   * 
   * @returns true if collected, false if duplicate
   */
  collect(data: Record<string, unknown>, type: string = 'default'): boolean {
    const uniqueId = this.getUniqueId(data, type);
    
    // Initialize tracking for this type
    if (!this.collectedIds.has(type)) {
      this.collectedIds.set(type, new Set());
    }
    if (!this.collectedItems.has(type)) {
      this.collectedItems.set(type, []);
    }
    
    // Check for duplicate
    if (uniqueId && this.collectedIds.get(type)!.has(uniqueId)) {
      return false;  // Already have this one
    }
    
    // Store
    if (uniqueId) {
      this.collectedIds.get(type)!.add(uniqueId);
    }
    this.collectedItems.get(type)!.push(data);
    return true;
  }
  
  /**
   * Infer unique ID from data based on type and common patterns
   */
  private getUniqueId(data: Record<string, unknown>, type: string): string | null {
    // Type-specific keys
    if (type === 'job') {
      if (data.linkedinJobId) return `linkedin:${data.linkedinJobId}`;
      if (data.jobId) return `job:${data.jobId}`;
    }
    
    // Generic fallbacks
    if (data.id) return String(data.id);
    if (data.url) return String(data.url);
    
    // Create composite key from title+company for jobs without ID
    if (type === 'job' && data.title && data.company) {
      return `${String(data.title).toLowerCase()}@${String(data.company).toLowerCase()}`;
    }
    
    return null;  // Can't dedupe, allow duplicates
  }
  
  /**
   * Check if an item with this ID was already collected
   */
  hasCollected(type: string, uniqueId: string): boolean {
    return this.collectedIds.get(type)?.has(uniqueId) || false;
  }
  
  /**
   * Get count of collected items (for progress tracking)
   */
  getCollectedCount(type?: string): number {
    if (type) {
      return this.collectedItems.get(type)?.length || 0;
    }
    let total = 0;
    for (const items of this.collectedItems.values()) {
      total += items.length;
    }
    return total;
  }
  
  /**
   * Get all collected items
   */
  getCollectedItems(): Map<string, unknown[]> {
    return new Map(this.collectedItems);
  }
  
  /**
   * Get collected items as flat array
   */
  getAllCollected(): unknown[] {
    const all: unknown[] = [];
    for (const items of this.collectedItems.values()) {
      all.push(...items);
    }
    return all;
  }
}
```

### Result Enhancement

```typescript
// src/lib/automation-core/types.ts

export interface TaskResult {
  success: boolean;
  error?: string;
  steps: StepRecord[];
  finalUrl: string;
  finalAnswer?: string;
  collected?: Map<string, unknown[]>;  // NEW: Collected items
  data?: unknown;
}
```

```typescript
// src/lib/automation-core/agent/executor.ts

private buildResult(success: boolean, error?: string, finalAnswer?: string): TaskResult {
  return {
    success,
    error,
    steps: this.context.stepHistory,
    finalUrl: '',
    finalAnswer,
    collected: this.context.getCollectedItems(),  // NEW
  };
}
```

## Updated Prompt Template

```typescript
// src/lib/automation-core/agent/prompts/templates.ts

// Add to the system prompt:

`
13. Streaming Extraction (for lists):

When extracting multiple items (jobs, products, search results, etc.):
- Use the \`collect\` action to save each item as you extract it
- Collected data is stored externally - you don't need to remember it
- Just track your progress in memory: "Collected 5/10 jobs"
- This keeps your context small and prevents memory overflow

Example:
  {"collect": {"type": "job", "data": {"title": "Engineer", "company": "Google", "salary": "$150K"}}}
  
After collecting, your memory should be brief:
  "Collected 3/10 jobs. Next: click job card [45] for job #4."

Do NOT store full extracted data in your memory field - use collect instead.
`
```

## Usage Example

### Task Prompt (Discovery)

```typescript
function buildDiscoveryTask(searchQuery: string, maxJobs: number): string {
  return `
TASK: Extract ${maxJobs} job listings from LinkedIn.

=== NAVIGATION ===
Go to: https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchQuery)}

=== EXTRACTION (for each job) ===
1. Click a job card to open details
2. Extract: title, company, location, salary, jobType, description, linkedinJobId, easyApply
3. Use \`collect\` action to save the job:
   {"collect": {"type": "job", "data": {"title": "...", "company": "...", ...}}}
4. Move to next job

=== PROGRESS TRACKING ===
Track in memory: "Collected X/${maxJobs} jobs"
Do NOT store job details in memory - collect handles storage.

=== COMPLETION ===
When you have ${maxJobs} jobs (or no more available):
  {"done": {"success": true, "text": "Collected ${maxJobs} jobs"}}

=== ERROR HANDLING ===
- Login page: {"done": {"success": false, "text": "login_required"}}
- CAPTCHA: {"done": {"success": false, "text": "captcha"}}
`.trim();
}
```

### Consuming Results

```typescript
// src/background/discovery.ts

const result = await agent.execute(task);

if (result.success && result.collected) {
  const jobsData = result.collected.get('job') || [];
  
  for (const jobData of jobsData) {
    const job = createJob(jobData as ParsedJobData);
    jobs.push(job);
    notifyJobFound(job);
  }
}
```

## Deduplication

### The Problem

When extracting from lists, the LLM may encounter the same item multiple times:
- After scrolling, some items remain visible
- LLM may not remember which items it already processed
- Same job appears in different search results

### Solution: Automatic Deduplication

The `collect` action automatically deduplicates based on inferred unique IDs:

```typescript
// First collection - stored
{ "collect": { "type": "job", "data": { "linkedinJobId": "123", "title": "Engineer" } } }
// Result: "Collected job #1"

// Duplicate - skipped automatically  
{ "collect": { "type": "job", "data": { "linkedinJobId": "123", "title": "Engineer" } } }
// Result: "Duplicate job skipped (already collected)"
```

### Unique ID Inference

The system infers unique IDs based on type and data:

| Type | Primary Key | Fallback Keys |
|------|-------------|---------------|
| `job` | `linkedinJobId` | `jobId`, `url`, `title@company` |
| `product` | `id` | `sku`, `url` |
| (any) | `id` | `url` |

If no unique key can be inferred, duplicates are allowed (caller must handle).

### Prompt Guidance

```
When you use \`collect\`, duplicates are automatically detected:
- If you collect the same job twice (same linkedinJobId), it will be skipped
- You'll see "Duplicate skipped" in the result
- This is normal when scrolling - just continue to the next item
- Track your UNIQUE count: "Collected 5/10 unique jobs"
```

## Benefits

| Metric | Before (cache_content) | After (collect) |
|--------|----------------------|-----------------|
| Context growth | O(n) - grows with each item | O(1) - constant |
| Tokens at step 10 | ~40K (5K extracted data) | ~35K (no extracted data) |
| Memory reliability | Fragile (text parsing) | Robust (structured storage) |
| Final result | Parse from `finalAnswer` string | Direct from `result.collected` |
| Duplicates | LLM must remember | Automatic deduplication |

## Implementation Checklist

- [ ] Add `collectActionSchema` to `schemas.ts`
- [ ] Add `collect` action to `ActionBuilder.buildDefaultActions()`
- [ ] Add collection storage to `AgentContext` with deduplication
- [ ] Add `collectedIds` tracking to `AgentContext`
- [ ] Add `getUniqueId()` method with type-specific inference
- [ ] Add `collected` field to `TaskResult`
- [ ] Update `Executor.buildResult()` to include collected items
- [ ] Update system prompt with streaming extraction guidance
- [ ] Update `discovery.ts` to use new `collect` action and consume `result.collected`
- [ ] Add tests for collection functionality
- [ ] Add tests for deduplication behavior

## Future Enhancements

1. **Typed Collection**: Support Zod schemas for collected items
   ```typescript
   context.collect(JobSchema, data);  // Validates on collection
   ```

2. **Collection Events**: Emit events when items are collected
   ```typescript
   agent.on('collected', (item) => {
     // Real-time notification
     notifyJobFound(item);
   });
   ```

3. **Collection Limits**: Auto-stop when collection target reached
   ```typescript
   agent.execute(task, { collectLimit: 10 });
   ```

