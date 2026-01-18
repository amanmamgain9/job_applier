import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJobs, updateJob } from '@shared/utils/storage';
import type { Job, JobStatus } from '@shared/types';
import type { ExtensionMessage } from '@shared/types/messages';

const JOBS_QUERY_KEY = ['jobs'] as const;

/**
 * Hook for managing job queue state with TanStack Query.
 * 
 * - Initial load: Fetches all jobs from chrome.storage
 * - Real-time updates: Listens for DISCOVERY_JOB_FOUND messages from background
 * - Actions: updateStatus (with optimistic updates)
 */
export function useJobs() {
  const queryClient = useQueryClient();

  // Fetch jobs from storage (initial load + refetch)
  const {
    data: jobs = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: JOBS_QUERY_KEY,
    queryFn: getJobs,
  });

  // Mutation for updating job status with optimistic update
  const updateStatusMutation = useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: JobStatus }) =>
      updateJob(jobId, { status }),
    onMutate: async ({ jobId, status }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: JOBS_QUERY_KEY });

      // Snapshot the previous value
      const previousJobs = queryClient.getQueryData<Job[]>(JOBS_QUERY_KEY);

      // Optimistically update
      queryClient.setQueryData<Job[]>(JOBS_QUERY_KEY, (old) =>
        old?.map((job) => (job.id === jobId ? { ...job, status } : job)) ?? []
      );

      return { previousJobs };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousJobs) {
        queryClient.setQueryData(JOBS_QUERY_KEY, context.previousJobs);
      }
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
    },
  });

  // Listen for new jobs from background (real-time discovery updates)
  useEffect(() => {
    const handleMessage = (message: ExtensionMessage) => {
      if (message.type === 'DISCOVERY_JOB_FOUND') {
        // Add the new job to cache directly
        queryClient.setQueryData<Job[]>(JOBS_QUERY_KEY, (old) => {
          const existingIds = new Set(old?.map((j) => j.id) ?? []);
          // Avoid duplicates (in case of race conditions)
          if (existingIds.has(message.payload.id)) {
            return old;
          }
          return [...(old ?? []), message.payload];
        });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [queryClient]);

  const updateStatus = (jobId: string, status: JobStatus) => {
    updateStatusMutation.mutate({ jobId, status });
  };

  const refreshJobs = () => {
    queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
  };

  return {
    jobs,
    isLoading,
    error: error instanceof Error ? error.message : null,
    updateStatus,
    refreshJobs,
  };
}
