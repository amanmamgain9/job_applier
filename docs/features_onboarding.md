# Feature: Onboarding

The user's first experience. Upload CV, chat about preferences, get ready to search.

---

## Progress

| Task | Status |
|------|--------|
| CV Upload UI | ✅ |
| CV parsing with AI | ✅ |
| CV review/confirmation UI | ✅ |
| Preferences Chat UI | ✅ |
| Dashboard UI | ✅ |
| CV sent to AI directly | ✅ |
| CV persistence (IndexedDB) | ✅ |
| LLM chat integration | ✅ |
| Preference extraction | ✅ |
| State persistence (chrome.storage) | ✅ |

---

## How It Works

### Step 1: CV Upload

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER ACTION                                     │
│                     User drops PDF file onto upload zone                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  CVUpload.tsx                                                                │
│  ────────────                                                                │
│  handleFile(file)                                                            │
│    → validates file type (PDF/TXT) and size (<10MB)                          │
│    → stores file in local state                                              │
│                                                                              │
│  User clicks "Upload & Parse"                                                │
│    → calls onUpload(file) prop                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts                                                            │
│  ────────────────                                                            │
│  uploadCV(file)                                                              │
│    → calls getFileContent(file)                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  services/pdfParser.ts                                                       │
│  ─────────────────────                                                       │
│  getFileContent(file)                                                        │
│    → if PDF: convert to base64 string                                        │
│    → if TXT: read as plain text                                              │
│    → returns { type: 'base64' | 'text', content: string }                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts (continued)                                                │
│  ────────────────                                                            │
│  uploadCV(file)                                                              │
│    → calls parseCV(fileContent)                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  services/preferenceChat.ts                                                  │
│  ──────────────────────────                                                  │
│  parseCV(fileContent)                                                        │
│    → if base64: sends to LLM as image (PDF rendered by AI)                   │
│    → if text: sends as plain text                                            │
│    → LLM prompt: "Extract name, email, skills, experience, education"        │
│    → returns ParsedCV { name, email, skills[], experience[], education[] }   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts (continued)                                                │
│  ────────────────                                                            │
│  uploadCV(file)                                                              │
│    → creates CVData object with blob + parsed data                           │
│    → calls saveCV(cvData) → IndexedDB                                        │
│    → updates state: { cv: cvData }                                           │
│    → stays on 'cv' step to show parsed results                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  CVUpload.tsx (re-renders)                                                   │
│  ────────────                                                                │
│  Now shows parsed CV view:                                                   │
│    → Name, email, location                                                   │
│    → Skills as tags                                                          │
│    → Experience list                                                         │
│    → Education list                                                          │
│    → "Looks Good, Continue" button                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step 2: Confirm CV → Preferences Chat

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER ACTION                                     │
│                     User clicks "Looks Good, Continue"                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  CVUpload.tsx                                                                │
│  ────────────                                                                │
│  → calls onConfirm() prop                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts                                                            │
│  ────────────────                                                            │
│  confirmCV()                                                                 │
│    → calls saveOnboardingState('preferences', { rawChat: [] })               │
│    → updates state: { step: 'preferences' }                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  OnboardingFlow.tsx (re-renders)                                             │
│  ──────────────────                                                          │
│  step === 'preferences'                                                      │
│    → renders PreferencesChat component                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step 3: Preferences Chat

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER ACTION                                     │
│           User types: "Remote Python roles, $150k+, no crypto"               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PreferencesChat.tsx                                                         │
│  ───────────────────                                                         │
│  handleSend()                                                                │
│    → calls onSendMessage(content) prop                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts                                                            │
│  ────────────────                                                            │
│  sendMessage(content)                                                        │
│    → creates userMessage { id, role: 'user', content }                       │
│    → updates state: preferences.rawChat = [...prev, userMessage]             │
│    → calls getAIResponse(messages, cvText)                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  services/preferenceChat.ts                                                  │
│  ──────────────────────────                                                  │
│  getAIResponse(messages, cvText)                                             │
│    → sends chat history + CV text to LLM                                     │
│    → LLM asks follow-up questions about preferences                          │
│    → returns response string                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts (continued)                                                │
│  ────────────────                                                            │
│  sendMessage(content)                                                        │
│    → creates assistantMessage { id, role: 'assistant', content: response }   │
│    → updates state: preferences.rawChat = [...prev, assistantMessage]        │
│    → calls saveOnboardingState(step, preferences) → chrome.storage           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PreferencesChat.tsx (re-renders)                                            │
│  ───────────────────                                                         │
│  Shows chat history with new messages                                        │
│  After 2+ user messages: shows "Ready to Start Searching" button             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step 4: Complete Onboarding

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER ACTION                                     │
│                  User clicks "Ready to Start Searching"                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PreferencesChat.tsx                                                         │
│  ───────────────────                                                         │
│  → calls onComplete() prop                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts                                                            │
│  ────────────────                                                            │
│  completeOnboarding()                                                        │
│    → calls extractPreferences(messages)                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  services/preferenceChat.ts                                                  │
│  ──────────────────────────                                                  │
│  extractPreferences(messages)                                                │
│    → sends chat history to LLM                                               │
│    → LLM prompt: "Extract structured preferences from this conversation"     │
│    → returns ExtractedPreferences {                                          │
│        roles: ["Python Developer", "Backend Engineer"],                      │
│        locations: [{ type: 'remote' }],                                      │
│        salary: { min: 150000, currency: 'USD' },                             │
│        dealbreakers: ["crypto", "blockchain"]                                │
│      }                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useOnboarding.ts (continued)                                                │
│  ────────────────                                                            │
│  completeOnboarding()                                                        │
│    → updates preferences.extracted = result                                  │
│    → calls saveOnboardingState('complete', preferences)                      │
│    → updates state: { step: 'complete' }                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  App.tsx (re-renders)                                                        │
│  ───────                                                                     │
│  step === 'complete'                                                         │
│    → renders Dashboard component instead of OnboardingFlow                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/components/onboarding/
├── OnboardingFlow.tsx       # Step router (cv → preferences → complete)
├── CVUpload.tsx             # Drag-drop upload + parsed CV review
├── PreferencesChat.tsx      # Chat interface
├── types.ts                 # CVData, ParsedCV, ChatMessage, etc.
├── hooks/
│   └── useOnboarding.ts     # All state + actions
└── services/
    ├── pdfParser.ts         # File → base64/text
    ├── preferenceChat.ts    # All LLM calls
    ├── cvStorage.ts         # IndexedDB for CV blob
    └── storage.ts           # chrome.storage wrapper
```

---

## State Management

All onboarding state lives in `useOnboarding` hook:

```typescript
{
  step: 'cv' | 'preferences' | 'complete',
  cv: {
    fileName: string,
    fileSize: number,
    blob: Blob,
    textContent: string,
    parsed: { name, email, skills[], experience[], education[] }
  },
  preferences: {
    rawChat: ChatMessage[],
    extracted?: ExtractedPreferences
  },
  isLoading: boolean,
  error: string | null
}
```

### Persistence

| Data | Storage | Why |
|------|---------|-----|
| CV blob + parsed | IndexedDB | Large file, survives refresh |
| Step + preferences | chrome.storage.sync | Syncs across devices |

---

## Key Files Explained

### `OnboardingFlow.tsx`
Simple step router. Renders `CVUpload` or `PreferencesChat` based on current step.

### `CVUpload.tsx`
Two views in one component:
1. **Upload view**: Drag zone, file validation, "Upload & Parse" button
2. **Parsed view**: Shows extracted CV data, "Looks Good, Continue" button

### `PreferencesChat.tsx`
Chat UI with:
- Initial greeting message
- User/assistant message bubbles
- Typing indicator during AI response
- "Ready to Start Searching" button (appears after 2+ messages)

### `useOnboarding.ts`
Central hook with all state and actions:
- `uploadCV(file)` — Parse CV with AI
- `confirmCV()` — Move to preferences step
- `sendMessage(content)` — Chat with AI
- `completeOnboarding()` — Extract structured preferences
- `reset()` — Clear everything, restart

### `services/preferenceChat.ts`
All LLM interactions:
- `parseCV()` — PDF/TXT → structured data
- `getAIResponse()` — Chat responses
- `extractPreferences()` — Chat → structured preferences
- `getFallbackResponse()` — When LLM fails

### `services/cvStorage.ts`
IndexedDB wrapper using `idb` library. Stores CV blob separately from chrome.storage (which has size limits).

---

## Dependencies

- `idb` — IndexedDB wrapper

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-01-16 | Rewrote docs to show complete call flow |
| 2026-01-13 | Removed pdf.js, send PDF directly to AI |
| 2026-01-11 | Initial UI implementation |
