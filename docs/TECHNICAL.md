# Job Applier - Technical Overview

> 📖 **See also:** [SPEC.md](./SPEC.md) for product requirements

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Chrome Extension                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌─────────────┐          ┌─────────────────────────────┐   │
│   │  Popup UI   │◄────────►│    Background Worker        │   │
│   │  (React)    │  chrome   │    (orchestration +        │   │
│   └─────────────┘  messages │     LLM automation)        │   │
│                             └─────────────────────────────┘   │
│   ┌─────────────┐                      │                      │
│   │Content Script│◄────────────────────┘                      │
│   │(tracking)   │                                             │
│   └─────────────┘                                             │
│         │                              │                      │
│         ▼                              ▼                      │
│   ┌─────────────┐          ┌─────────────────────────────┐   │
│   │  Job Sites  │          │        Storage              │   │
│   │  (LinkedIn) │          │                             │   │
│   └─────────────┘          └─────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Core Components

| Component | Responsibility |
|-----------|----------------|
| **Popup UI** | Onboarding, job queue, settings |
| **Background Worker** | Orchestrates LLM automation, manages state |
| **Content Script** | Tracks application progress on job sites |

---

## Data Flow

### Job Discovery
```
User clicks "Scan" → Background navigates LinkedIn via LLM 
→ Extracts jobs → Scores against preferences → Streams to UI
```

### Application
```
User clicks "Apply" → Background opens job, fills form from CV 
→ Pauses for user input → User clicks Submit → Content script detects success
```

### Tracking
```
Content script monitors job sites → Detects apply clicks + form state 
→ Reports status changes → Background updates job record
```

---

## Storage

| Data | Examples |
|------|----------|
| **Settings** | API keys, user preferences |
| **User Data** | Parsed CV, resume |
| **Jobs** | Discovered jobs, applications, status |

---

## Key Dependencies

- **@riruru/automation-core** — LLM-powered browser automation
- **React** — Popup UI
- **Zustand** — State management
- **Vite** — Build tooling

---

## Project Structure

```
src/
├── popup/           # React app (onboarding, job queue, settings)
├── background/      # Service worker (automation, jobs, state)
├── content/         # Content scripts (application monitoring)
└── shared/          # Types, utils, constants
```

---

## Development

```bash
pnpm install     # Install deps
pnpm dev         # Dev mode with HMR
pnpm build       # Production build → dist/
pnpm test        # Run tests
```

Load `dist/` folder in `chrome://extensions` with Developer Mode enabled.
