import type { OnboardingStep, Preferences } from '../types';

const STORAGE_KEY = 'onboarding';

interface StoredOnboarding {
  step: OnboardingStep;
  preferences: {
    rawChat: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
    }>;
    summary?: string;
    extracted?: Preferences['extracted'];
  };
}

// Check if running in Chrome extension context
const isChromeExtension = typeof chrome !== 'undefined' && chrome.storage?.sync;

// Fallback to localStorage for dev mode
const localStorageFallback = {
  async get(key: string): Promise<Record<string, unknown>> {
    const item = localStorage.getItem(key);
    return item ? { [key]: JSON.parse(item) } : {};
  },
  async set(data: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },
  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};

const storage = isChromeExtension
  ? chrome.storage.sync
  : localStorageFallback;

export async function loadOnboardingState(): Promise<{
  step: OnboardingStep;
  preferences: Preferences;
} | null> {
  const result = await storage.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as StoredOnboarding | undefined;

  if (!stored) return null;

  return {
    step: stored.step,
    preferences: {
      rawChat: stored.preferences.rawChat.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
      summary: stored.preferences.summary,
      extracted: stored.preferences.extracted,
    },
  };
}

export async function saveOnboardingState(
  step: OnboardingStep,
  preferences: Preferences
): Promise<void> {
  const toStore: StoredOnboarding = {
    step,
    preferences: {
      rawChat: preferences.rawChat.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
      summary: preferences.summary,
      extracted: preferences.extracted,
    },
  };

  await storage.set({ [STORAGE_KEY]: toStore });
}

export async function clearOnboardingState(): Promise<void> {
  await storage.remove(STORAGE_KEY);
}
