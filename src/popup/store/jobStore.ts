import { create } from 'zustand';
import { getJobs, setJobs as saveJobs } from '@shared/utils/storage';
import type { Job, JobStatus } from '@shared/types';

interface JobState {
  jobs: Job[];
  filter: 'all' | 'pending' | 'approved' | 'applied';
  isLoading: boolean;
  error: string | null;
  
  // Computed
  filteredJobs: () => Job[];
  counts: () => { pending: number; approved: number; applied: number };
  
  // Actions
  setJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJobStatus: (id: string, status: JobStatus) => void;
  removeJob: (id: string) => void;
  setFilter: (filter: JobState['filter']) => void;
  fetchJobs: () => Promise<void>;
  syncToStorage: () => Promise<void>;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: [],
  filter: 'all',
  isLoading: false,
  error: null,
  
  filteredJobs: () => {
    const { jobs, filter } = get();
    if (filter === 'all') return jobs;
    if (filter === 'applied') return jobs.filter(j => j.status === 'applied' || j.status === 'failed');
    return jobs.filter(j => j.status === filter);
  },
  
  counts: () => {
    const { jobs } = get();
    return {
      pending: jobs.filter(j => j.status === 'pending').length,
      approved: jobs.filter(j => j.status === 'approved').length,
      applied: jobs.filter(j => j.status === 'applied' || j.status === 'failed').length,
    };
  },
  
  setJobs: (jobs) => set({ jobs }),
  
  addJob: (job) => set((state) => {
    const exists = state.jobs.some(j => j.sourceJobId === job.sourceJobId);
    if (exists) return state;
    return { jobs: [job, ...state.jobs] };
  }),
  
  updateJobStatus: (id, status) => set((state) => ({
    jobs: state.jobs.map(job =>
      job.id === id ? { ...job, status } : job
    )
  })),
  
  removeJob: (id) => set((state) => ({
    jobs: state.jobs.filter(job => job.id !== id)
  })),
  
  setFilter: (filter) => set({ filter }),
  
  fetchJobs: async () => {
    set({ isLoading: true, error: null });
    try {
      const jobs = await getJobs();
      set({ jobs, isLoading: false });
    } catch (err) {
      set({ 
        error: err instanceof Error ? err.message : 'Failed to fetch jobs',
        isLoading: false 
      });
    }
  },
  
  syncToStorage: async () => {
    const { jobs } = get();
    await saveJobs(jobs);
  },
}));

