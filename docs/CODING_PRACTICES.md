# Job Applier - Coding Practices

Patterns, conventions, and rules that all code must follow.

---

## React Patterns

### 1. Local State Over Global State

Prefer local component state. Only lift state when siblings need to share it. Avoid global stores (Zustand/Redux) unless absolutely necessary.

```tsx
// ✅ GOOD: Local state
function JobCard({ job }: { job: Job }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (/* ... */);
}

// ✅ GOOD: Lifted to parent when siblings need it
function JobQueue() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  return (
    <>
      <JobList onSelect={setSelectedJobId} />
      <JobDetail jobId={selectedJobId} />
    </>
  );
}

// ❌ AVOID: Global store for UI state
const useStore = create((set) => ({
  selectedJobId: null,  // This should be local
}));
```

### 2. Keys Over useEffect for Reset

Use React's `key` prop to reset component state instead of `useEffect`.

```tsx
// ✅ GOOD: Key forces fresh component instance
function ChatContainer({ conversationId }: { conversationId: string }) {
  return <Chat key={conversationId} />;
}

// ❌ AVOID: useEffect to reset state
function Chat({ conversationId }) {
  const [messages, setMessages] = useState([]);
  
  useEffect(() => {
    setMessages([]);  // Don't do this
  }, [conversationId]);
}
```

### 3. Dumb Components

Components receive data via props, emit events via callbacks. Logic lives in parent or services.

```tsx
// ✅ GOOD: Dumb component - no internal logic
interface JobCardProps {
  job: Job;
  onApply: (jobId: string) => void;
  onSkip: (jobId: string) => void;
}

function JobCard({ job, onApply, onSkip }: JobCardProps) {
  return (
    <div>
      <h3>{job.title}</h3>
      <button onClick={() => onApply(job.id)}>Apply</button>
      <button onClick={() => onSkip(job.id)}>Skip</button>
    </div>
  );
}

// Parent handles all logic
function JobQueue() {
  const handleApply = async (jobId: string) => {
    await startApplication(jobId);
  };
  return <JobCard job={job} onApply={handleApply} onSkip={handleSkip} />;
}
```

### 4. Data Fetching with TanStack Query

Use TanStack Query for data fetching. Components can fetch locally—TanStack handles caching and deduplication.

```tsx
// ✅ GOOD: Component fetches its own data with TanStack Query
function JobCard({ jobId }: { jobId: string }) {
  const { data: job, isLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => storage.get<Job>(`jobs.${jobId}`),
  });

  if (isLoading) return <Skeleton />;
  return <div>{job?.title}</div>;
}

// ✅ GOOD: Multiple components can use the same query key - TanStack deduplicates
function JobQueue() {
  const { data: jobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => storage.get<Job[]>('job_queue'),
  });

  return jobs?.map(job => <JobCard key={job.id} jobId={job.id} />);
}

// ❌ AVOID: Manual loading state with useEffect
function JobCard({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchJob(jobId).then(setJob).finally(() => setLoading(false));
  }, [jobId]);
}
```

### 5. Avoid useEffect for Derived State

Compute derived values directly, don't sync with useEffect.

```tsx
// ✅ GOOD: Computed directly
function JobStats({ jobs }: { jobs: Job[] }) {
  const pendingCount = jobs.filter(j => j.status === 'pending').length;
  const appliedCount = jobs.filter(j => j.status === 'applied').length;
  return <div>{pendingCount} pending, {appliedCount} applied</div>;
}

// ❌ AVOID: Syncing derived state
function JobStats({ jobs }: { jobs: Job[] }) {
  const [pendingCount, setPendingCount] = useState(0);
  
  useEffect(() => {
    setPendingCount(jobs.filter(j => j.status === 'pending').length);
  }, [jobs]);
}
```

---

## TypeScript Conventions

### Strict Types

- Enable strict mode in `tsconfig.json`
- No `any` unless absolutely necessary (and document why)
- Prefer `unknown` over `any` for truly unknown types

### Interface vs Type

- Use `interface` for object shapes that might be extended
- Use `type` for unions, primitives, and computed types

```typescript
// Interface for extendable objects
interface Job {
  id: string;
  title: string;
}

// Type for unions
type JobStatus = 'pending' | 'applied' | 'rejected';

// Type for computed/utility types
type JobWithoutId = Omit<Job, 'id'>;
```

### Naming

- Interfaces/Types: `PascalCase`
- Functions/Variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Files: `camelCase.ts` for utilities, `PascalCase.tsx` for components

---

## Styling Conventions

### Tailwind with cn() Utility

Use the `cn()` utility for conditional classes:

```tsx
import { cn } from '@/lib/utils';

interface ButtonProps {
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  className?: string;
}

function Button({ variant = 'primary', disabled, className }: ButtonProps) {
  return (
    <button
      className={cn(
        // Base styles
        'rounded-lg px-4 py-2 font-medium transition-colors',
        // Variant styles
        variant === 'primary' && 'bg-emerald-500 text-white hover:bg-emerald-600',
        variant === 'secondary' && 'bg-zinc-800 text-white hover:bg-zinc-700',
        // State styles
        disabled && 'opacity-50 cursor-not-allowed',
        // Allow override
        className
      )}
      disabled={disabled}
    />
  );
}
```

### Color Palette

```css
/* Dark theme - defined in tailwind.config.js */
--background: #0f0f10;     /* Main background */
--surface: #1a1a1b;        /* Cards, panels */
--border: #2a2a2b;         /* Borders */
--foreground: #ffffff;     /* Primary text */
--muted: #a1a1aa;          /* Secondary text */
--primary: #10b981;        /* Emerald accent */
--primary-hover: #059669;  /* Emerald hover */
```

### No Inline Styles

Always use Tailwind classes, never inline `style={}` props.

---

## File Organization

### One Component Per File

Each component gets its own file. Exception: small helper components used only by the parent.

```
// ✅ GOOD
components/
├── JobCard.tsx
├── JobList.tsx
└── JobQueue.tsx

// ❌ AVOID: Multiple unrelated components in one file
components/
└── Jobs.tsx  // Contains JobCard, JobList, JobQueue, etc.
```

### Colocate Related Files

Keep related files together:

```
components/
└── JobCard/
    ├── JobCard.tsx
    ├── JobCard.test.tsx    // If we have tests
    └── index.ts            // Re-export
```

### Import Aliases

Use `@/` alias for clean imports:

```typescript
// ✅ GOOD
import { Button } from '@/components/ui/Button';
import { storage } from '@/services/storage';
import type { Job } from '@/types';

// ❌ AVOID
import { Button } from '../../../components/ui/Button';
```

---

## Error Handling

### Try-Catch at Boundaries

Handle errors at component/page boundaries, not deep in the tree:

```tsx
// ✅ GOOD: Error boundary at page level
function JobQueuePage() {
  const [error, setError] = useState<string | null>(null);
  
  const loadJobs = async () => {
    try {
      const jobs = await storage.get<Job[]>('job_queue');
      setJobs(jobs ?? []);
    } catch (e) {
      setError('Failed to load jobs');
    }
  };

  if (error) return <ErrorMessage message={error} />;
  return <JobQueue jobs={jobs} />;
}
```

### Service Layer Errors

Services throw typed errors, UI catches and displays:

```typescript
// Service throws
class LLMError extends Error {
  constructor(message: string, public code: 'INVALID_KEY' | 'RATE_LIMITED') {
    super(message);
  }
}

// UI catches
try {
  await llm.chat(messages);
} catch (e) {
  if (e instanceof LLMError && e.code === 'INVALID_KEY') {
    setError('Please check your API key in settings');
  }
}
```

---

## Async Patterns

### Async/Await Over Promises

```typescript
// ✅ GOOD
async function loadData() {
  const jobs = await storage.get<Job[]>('jobs');
  const profile = await storage.get<UserProfile>('profile');
  return { jobs, profile };
}

// ❌ AVOID: Promise chains
function loadData() {
  return storage.get('jobs')
    .then(jobs => storage.get('profile')
      .then(profile => ({ jobs, profile })));
}
```

### Parallel When Possible

```typescript
// ✅ GOOD: Parallel fetches
const [jobs, profile, settings] = await Promise.all([
  storage.get<Job[]>('jobs'),
  storage.get<UserProfile>('profile'),
  storage.get<AppSettings>('settings'),
]);

// ❌ AVOID: Sequential when not needed
const jobs = await storage.get('jobs');
const profile = await storage.get('profile');
const settings = await storage.get('settings');
```

---

## Comments

### When to Comment

- Complex business logic
- Non-obvious workarounds
- "Why" not "what"

```typescript
// ✅ GOOD: Explains why
// LinkedIn rate limits after 30 requests/minute, add delay to avoid ban
await sleep(2000);

// ❌ AVOID: Explains what (code already shows this)
// Add 2 second delay
await sleep(2000);
```

### JSDoc for Public APIs

```typescript
/**
 * Stores a value in the storage layer.
 * @param key - Storage key from STORAGE_KEYS
 * @param value - Value to store (will be JSON serialized)
 * @throws StorageError if quota exceeded
 */
async function set<T>(key: string, value: T): Promise<void> {
  // ...
}
```

---

## Testing (When Added)

### Test File Location

Colocate with source:

```
components/
└── JobCard/
    ├── JobCard.tsx
    └── JobCard.test.tsx
```

### Test Naming

```typescript
describe('JobCard', () => {
  it('displays job title and company', () => {});
  it('calls onApply when Apply button clicked', () => {});
  it('shows salary range when available', () => {});
});
```

---

## Summary Checklist

Before submitting code, verify:

- [ ] No global state when local state works
- [ ] Using `key` for reset, not `useEffect`
- [ ] Components are dumb (props in, callbacks out)
- [ ] Data fetching uses TanStack Query
- [ ] No `any` types
- [ ] Using `cn()` for conditional classes
- [ ] Errors handled at boundaries
- [ ] Async/await, not promise chains
- [ ] Comments explain "why" not "what"

