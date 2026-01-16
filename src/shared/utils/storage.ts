import type { Job } from '../types/job';
import type { Settings, UserProfile, DEFAULT_SETTINGS, DEFAULT_PROFILE } from '../types/storage';

// Chrome storage wrapper with type safety

export async function getJobs(): Promise<Job[]> {
  const result = await chrome.storage.local.get('jobs');
  return result.jobs || [];
}

export async function setJobs(jobs: Job[]): Promise<void> {
  await chrome.storage.local.set({ jobs });
}

export async function addJob(job: Job): Promise<void> {
  const jobs = await getJobs();
  const exists = jobs.some(j => j.linkedinJobId === job.linkedinJobId);
  if (!exists) {
    jobs.unshift(job);
    await setJobs(jobs);
  }
}

export async function updateJob(jobId: string, updates: Partial<Job>): Promise<void> {
  const jobs = await getJobs();
  const index = jobs.findIndex(j => j.id === jobId);
  if (index !== -1) {
    jobs[index] = { ...jobs[index], ...updates };
    await setJobs(jobs);
  }
}

export async function removeJob(jobId: string): Promise<void> {
  const jobs = await getJobs();
  const filtered = jobs.filter(j => j.id !== jobId);
  await setJobs(filtered);
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.sync.get('settings');
  return result.settings || {
    autoCapture: true,
    notifications: true,
    theme: 'system',
    captureDelay: 2000,
  };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export async function getProfile(): Promise<UserProfile> {
  const result = await chrome.storage.sync.get('profile');
  return result.profile || {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
  };
}

export async function setProfile(profile: UserProfile): Promise<void> {
  await chrome.storage.sync.set({ profile });
}

// Storage change listener
export function onStorageChange(
  callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (areaName === 'local' || areaName === 'sync') {
      callback(changes);
    }
  };
  
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

