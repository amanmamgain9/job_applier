import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMessage,
  type DiscoveryStatePayload,
  type ExtensionMessage,
} from '@shared/types/messages';

type DiscoveryStatus = DiscoveryStatePayload['status'];

interface DiscoveryState {
  status: DiscoveryStatus;
  jobsFound: number;
  currentStep: number;
  maxSteps: number;
  error?: string;
}

const DISCOVERY_QUERY_KEY = ['discovery-state'] as const;

const initialState: DiscoveryState = {
  status: 'idle',
  jobsFound: 0,
  currentStep: 0,
  maxSteps: 50,
};

/**
 * Fetch discovery state from background script.
 */
async function fetchDiscoveryState(): Promise<DiscoveryState> {
  try {
    const response = await chrome.runtime.sendMessage(
      createMessage('DISCOVERY_STATE', null)
    );
    if (response?.status) {
      return response;
    }
  } catch {
    // Background might not be ready yet
  }
  return initialState;
}

/**
 * Hook for managing discovery state.
 * Uses TanStack Query for initial fetch, with real-time updates via chrome.runtime.onMessage.
 */
export function useDiscovery() {
  const queryClient = useQueryClient();

  // Fetch initial state with TanStack Query
  const { data: state = initialState } = useQuery({
    queryKey: DISCOVERY_QUERY_KEY,
    queryFn: fetchDiscoveryState,
    staleTime: Infinity, // State is updated via push messages, not polling
  });

  // Listen for discovery messages from background (real-time push updates)
  useEffect(() => {
    const handleMessage = (message: ExtensionMessage) => {
      if (message.type === 'DISCOVERY_STATE') {
        queryClient.setQueryData<DiscoveryState>(DISCOVERY_QUERY_KEY, {
          status: message.payload.status,
          jobsFound: message.payload.jobsFound,
          currentStep: message.payload.currentStep,
          maxSteps: message.payload.maxSteps,
          error: message.payload.error,
        });
      } else if (message.type === 'DISCOVERY_JOB_FOUND') {
        queryClient.setQueryData<DiscoveryState>(DISCOVERY_QUERY_KEY, (prev) =>
          prev ? { ...prev, jobsFound: prev.jobsFound + 1 } : prev
        );
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [queryClient]);

  const startDiscovery = useCallback(
    async (options?: { maxJobs?: number; searchQuery?: string }) => {
      try {
        // Optimistic update
        queryClient.setQueryData<DiscoveryState>(DISCOVERY_QUERY_KEY, (prev) =>
          prev ? { ...prev, status: 'running', error: undefined, jobsFound: 0 } : prev
        );

        const response = await chrome.runtime.sendMessage(
          createMessage('START_DISCOVERY', {
            maxJobs: options?.maxJobs ?? 20,
            searchQuery: options?.searchQuery,
          })
        );

        if (!response.success) {
          queryClient.setQueryData<DiscoveryState>(DISCOVERY_QUERY_KEY, (prev) =>
            prev ? { ...prev, status: 'error', error: response.error } : prev
          );
        }
      } catch (err) {
        queryClient.setQueryData<DiscoveryState>(DISCOVERY_QUERY_KEY, (prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error: err instanceof Error ? err.message : 'Failed to start discovery',
              }
            : prev
        );
      }
    },
    [queryClient]
  );

  const stopDiscovery = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage(createMessage('STOP_DISCOVERY', null));
      queryClient.setQueryData<DiscoveryState>(DISCOVERY_QUERY_KEY, (prev) =>
        prev ? { ...prev, status: 'idle' } : prev
      );
    } catch (err) {
      console.error('Failed to stop discovery:', err);
    }
  }, [queryClient]);

  // Derived state computed directly (not via useEffect)
  const isRunning = state.status === 'running';

  return {
    ...state,
    isRunning,
    startDiscovery,
    stopDiscovery,
  };
}
