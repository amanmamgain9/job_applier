# Job Applier - Product Specification

## What Is This?

A Chrome extension that helps you apply to jobs smarter. Upload your CV, tell it what you want, and it helps you find, review, and apply—while **you stay in control**.

---

## Core Philosophy

> **"AI does everything monotonous, nothing unique."**

- **Human in the loop** — You click every Submit button
- **Assist, don't replace** — Better applications, not more
- **Automate the boring** — Forms automated, decisions stay human
- **Quality over quantity** — 5 thoughtful beats 50 spray-and-pray

---

## The Flow

```
1. ONBOARDING
   Upload CV (PDF) → CV parsed → Chat about preferences → Ready

2. DISCOVERY  
   Click "Scan Jobs" → AI navigates in new tab → Jobs stream in

3. REVIEW
   See job cards with match scores → Approve ✓ or Skip ✗

4. APPLY
   Click Apply → AI fills form → You review → You click Submit

5. TRACK
   See all applications → Status updates → Export
```

---

## 1. Onboarding

### CV Upload & Processing (PDF only)

User uploads PDF CV. We parse and extract structured data:

```
Extracted from CV:
├── Personal: name, email, phone, location
├── Work Experience: company, title, dates, description
├── Education: school, degree, dates
├── Skills: languages, frameworks, tools
└── Links: LinkedIn, GitHub, portfolio
```

This structured data is used for:
- Auto-filling application forms
- Better job matching
- Generating personalized responses

### Preferences Chat

> "Remote Python roles, $150k+, startups preferred, no crypto"

AI extracts: role types, location, salary, company preferences, dealbreakers.

After chat → **"Start Finding Jobs"** button → proceeds to job list.

---

## 2. Job Discovery

### Trigger

**Manual only.** User clicks "Scan Jobs" → New tab opens → AI navigates.

(No automatic background scanning or notification spying.)

### How It Works

- AI searches based on **your preferences**
- Jobs **stream in real-time** as found
- Each job **scored immediately** against preferences

### Match Scores

| Score | Meaning |
|-------|---------|
| ✅ 90-100% | Strong match |
| ⚠️ 70-89% | Partial match |
| ❌ Filtered | Dealbreaker hit |

### Errors & CAPTCHA

| Situation | What Happens |
|-----------|--------------|
| CAPTCHA | Notification → You solve it → Resumes |
| Login needed | Notification → You log in → Retry |
| Rate limited | Auto-pause → Auto-resume |

---

## 3. Review

```
┌─────────────────────────────────────────────────────────────┐
│  Queue (47)  │  Saved (5)  │  Applied (3)  │  Skipped (12) │
├─────────────────────────────────────────────────────────────┤
│  🏢 Senior Software Engineer                        ✅ 95%  │
│     Stripe · Remote · $180k-$220k · Easy Apply             │
│     Python, TypeScript, distributed systems                │
│     [Skip]  [Save]  [🔍 Research]  [Apply →]               │
├─────────────────────────────────────────────────────────────┤
│  🏢 Backend Engineer                                ⚠️ 78%  │
│     Vercel · Hybrid (SF) · $150k-$200k                     │
│     ⚠️ Hybrid role (you prefer remote)                     │
│     [Skip]  [Save]  [🔍 Research]  [Apply →]               │
└─────────────────────────────────────────────────────────────┘
```

| Button | Action |
|--------|--------|
| Skip | Remove from queue |
| Save | Keep for later |
| Research | AI researches company |
| Apply → | Start application |

---

## 4. Assisted Application

### What AI Fills (v1)

- Standard fields: name, email, phone, location
- Work experience (from parsed CV)
- Education (from parsed CV)
- Resume upload
- Skills/checkboxes that match CV

### What AI Does NOT Fill (v1)

- Cover letters (user writes or skips)
- Custom essay questions (user writes)
- Salary expectations (user inputs)
- Anything requiring judgment

### The Flow

```
User clicks "Apply →" on a job
        ↓
AI opens job page, clicks Apply button
        ↓
AI fills standard fields from parsed CV data
        ↓
AI pauses at: cover letter, custom questions, salary
        ↓
User completes remaining fields manually
        ↓
User clicks Submit on the platform
        ↓
We detect submission → Mark as Applied
```

---

## 5. Tracking Applications

### Monitored Sites

**Base list** (always monitored):
- `linkedin.com/jobs/*`
- `wellfound.com/*`
- `greenhouse.io/*`
- `lever.co/*`
- `ashbyhq.com/*`

**Dynamic monitoring**: When user clicks "Apply →" and gets redirected to company's own career site (e.g., `stripe.com/jobs/apply/123`), we:

1. Track that tab as "application in progress"
2. Monitor that specific tab until closed or success detected
3. Save the domain to `learned_sites` for future reference

```
learned_sites: [
  { pattern: "stripe.com/jobs/*", addedAt: "2026-01-10", expiresAt: "2026-01-20" },
  { pattern: "careers.google.com/*", addedAt: "2026-01-08", expiresAt: "2026-01-18" }
]
```

Learned sites **expire after 10 days**. Keeps the list fresh, avoids monitoring stale domains.

### Two-Part Monitoring

**Click listeners** → Know WHICH job
**DOM mutations** → Know WHAT state

```
1. On page load:
   → AI identifies apply buttons on page
   → Attach click listeners to each
   → Each listener tagged with job info: { title, company, jobId }

2. User clicks Apply on "Senior Engineer @ Stripe":
   → Listener fires: activeJob = { title: "Senior Engineer", company: "Stripe" }
   → Now we know which job

3. DOM mutations track state changes:
   → Form appeared → state: IN_APPLICATION
   → Form step changed → state: IN_APPLICATION (step 2)
   → Success UI appeared → state: APPLIED
   
4. On success:
   → We know it's "Senior Engineer @ Stripe" (from click)
   → Update that job as applied
```

### Setup Flow

```
Page load on monitored site
        ↓
AI: "Find all apply buttons and their associated job info"
        ↓
Returns: [
  { button: <element>, job: { title, company } },
  { button: <element>, job: { title, company } },
  ...
]
        ↓
Attach click listener to each button
        ↓
On click → Set activeJob → Watch DOM for state changes
```

### State Machine

```
BROWSING → (apply click + job captured) → IN_APPLICATION
IN_APPLICATION → (DOM: form step change) → IN_APPLICATION
IN_APPLICATION → (DOM: success UI) → APPLIED
IN_APPLICATION → (DOM: error UI) → ERROR
IN_APPLICATION → (navigated away) → ABANDONED
```

### Cost

| Event | LLM Call |
|-------|----------|
| Page load | 1 call (identify apply buttons + jobs) |
| State change | 1 call (what's current state?) |
| Exit | 1 call (confirm success/error) |

~3 calls per application. Click tells us WHICH. DOM tells us WHAT.

### What We Track

When user clicks "Apply →":

```
{
  jobId: "123",
  applicationUrl: "https://linkedin.com/jobs/view/123/apply",
  status: "in_progress",
  startedAt: timestamp
}
```

### Status Detection

Content script watches for success patterns on monitored sites:

| What We Detect | How |
|----------------|-----|
| Success page | URL contains `/submitted`, `/success`, `/thank-you` |
| Success modal | DOM contains success message patterns |
| Application complete | Form disappeared + confirmation UI |

### Edge Cases

| Situation | What Happens |
|-----------|--------------|
| User closes tab | Status stays "in_progress", URL saved |
| User navigates away | Status stays "in_progress", URL saved |
| Success detected | Status → "applied", timestamp saved |
| Error detected | Status → "error", user notified |
| Unclear | Status stays "in_progress", user can manually mark |

### Manual Override

User can always manually mark a job as:
- ✓ Applied
- ✗ Not applying
- ↻ Try again later

We save the application URL regardless—user can return to it.

---

## 6. Tracking

```
┌─────────────────────────────────────────────────────────────┐
│  Applied Jobs:                                               │
│                                                              │
│  ✓ Senior Software Engineer @ Stripe                        │
│    Applied: Jan 10, 2026 · Status: Submitted                │
│                                                              │
│  ✓ Backend Engineer @ Vercel                                │
│    Applied: Jan 9, 2026 · Status: Submitted                 │
│                                                              │
│                        [📊 Export to CSV]                   │
└─────────────────────────────────────────────────────────────┘
```

---

## What Makes This Different

| Traditional Bots | Job Applier |
|------------------|-------------|
| Spray everywhere | Curated applications |
| Break on UI changes | AI adapts |
| Fill blindly | You review everything |
| Generic responses | CV-aware, personalized |
| No preferences | Learns what you want |

---

> 📖 **See also:** [TECHNICAL.md](./TECHNICAL.md)
