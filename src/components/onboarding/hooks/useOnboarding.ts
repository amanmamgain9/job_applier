import { useState, useEffect, useCallback } from 'react';
import type { CVData, ChatMessage, Preferences, OnboardingStep } from '../types';
import { saveCV, loadCV, deleteCV } from '../services/cvStorage';
import { getFileContent } from '../services/pdfParser';
import {
  getAIResponse,
  extractPreferences,
  getFallbackResponse,
  parseCV,
  LLMError,
} from '../services/preferenceChat';
import {
  loadOnboardingState,
  saveOnboardingState,
  clearOnboardingState,
} from '../services/storage';

interface OnboardingHookState {
  step: OnboardingStep;
  cv: CVData | null;
  preferences: Preferences;
  isLoading: boolean;
  error: string | null;
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingHookState>({
    step: 'cv',
    cv: null,
    preferences: { rawChat: [] },
    isLoading: true,
    error: null,
  });

  // Hydrate from storage on mount
  useEffect(() => {
    async function hydrate() {
      try {
        const [cv, stored] = await Promise.all([
          loadCV(),
          loadOnboardingState(),
        ]);

        setState({
          step: stored?.step ?? (cv ? 'preferences' : 'cv'),
          cv,
          preferences: stored?.preferences ?? { rawChat: [] },
          isLoading: false,
          error: null,
        });
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    }
    hydrate();
  }, []);

  const uploadCV = useCallback(async (file: File) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // Get file content (text or base64 for PDF)
      const fileContent = await getFileContent(file);

      // Parse CV with LLM - sends PDF directly to AI
      const parsed = await parseCV(fileContent);

      const cvData: CVData = {
        fileName: file.name,
        fileSize: file.size,
        blob: file,
        textContent: fileContent.type === 'text' ? fileContent.content : '[PDF]',
        uploadedAt: new Date(),
        parsed,
      };

      await saveCV(cvData);

      // Stay on CV step to show parsed results, don't auto-advance
      setState((s) => ({
        ...s,
        cv: cvData,
        isLoading: false,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to process file',
      }));
    }
  }, []);

  const confirmCV = useCallback(async () => {
    await saveOnboardingState('preferences', { rawChat: [] });
    setState((s) => ({
      ...s,
      step: 'preferences',
      preferences: { rawChat: [] },
    }));
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
      };

      const newMessages = [...state.preferences.rawChat, userMessage];
      setState((s) => ({
        ...s,
        preferences: { ...s.preferences, rawChat: newMessages },
        isLoading: true,
        error: null,
      }));

      try {
        const response = await getAIResponse(
          newMessages,
          state.cv?.textContent ?? ''
        );
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response,
          timestamp: new Date(),
        };

        const updatedMessages = [...newMessages, assistantMessage];
        await saveOnboardingState(state.step, {
          ...state.preferences,
          rawChat: updatedMessages,
        });

        setState((s) => ({
          ...s,
          preferences: { ...s.preferences, rawChat: updatedMessages },
          isLoading: false,
        }));
      } catch (err) {
        // Fallback response if LLM fails
        const fallback = getFallbackResponse(newMessages.length);
        const fallbackMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fallback,
          timestamp: new Date(),
        };

        const updatedMessages = [...newMessages, fallbackMessage];
        await saveOnboardingState(state.step, {
          ...state.preferences,
          rawChat: updatedMessages,
        });

        setState((s) => ({
          ...s,
          preferences: { ...s.preferences, rawChat: updatedMessages },
          isLoading: false,
          error:
            err instanceof LLMError && err.code === 'NO_API_KEY'
              ? null
              : 'Chat error',
        }));
      }
    },
    [state.preferences, state.cv, state.step]
  );

  const completeOnboarding = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }));

    try {
      const extracted = await extractPreferences(state.preferences.rawChat);
      const updatedPrefs = { ...state.preferences, extracted };
      await saveOnboardingState('complete', updatedPrefs);
      setState((s) => ({
        ...s,
        step: 'complete',
        preferences: updatedPrefs,
        isLoading: false,
      }));
    } catch {
      await saveOnboardingState('complete', state.preferences);
      setState((s) => ({ ...s, step: 'complete', isLoading: false }));
    }
  }, [state.preferences]);

  const reset = useCallback(async () => {
    await Promise.all([deleteCV(), clearOnboardingState()]);
    setState({
      step: 'cv',
      cv: null,
      preferences: { rawChat: [] },
      isLoading: false,
      error: null,
    });
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    uploadCV,
    confirmCV,
    sendMessage,
    completeOnboarding,
    reset,
    clearError,
  };
}

