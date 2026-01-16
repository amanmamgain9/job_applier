import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJobs, updateJob, onStorageChange } from '@shared/utils/storage';
import type { Job, JobStatus } from '@shared/types';
import { useEffect } from 'react';

const JOBS_QUERY_KEY = ['jobs'] as const;

/**
 * Hook for managing job queue state with TanStack Query.
 * Handles fetching, caching, and optimistic updates for jobs.
 */
export function useJobs() {
  const queryClient = useQueryClient();

  // Fetch jobs with TanStack Query
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

  // Listen for storage changes from other contexts (background, content scripts)
  useEffect(() => {
    const unsubscribe = onStorageChange((changes) => {
      if (changes.jobs) {
        queryClient.setQueryData(JOBS_QUERY_KEY, changes.jobs.newValue ?? []);
      }
    });

    return unsubscribe;
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
