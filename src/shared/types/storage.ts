import type { Job } from './job';

export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  portfolioUrl?: string;
  coverLetterTemplate?: string;
}

export interface Settings {
  autoCapture: boolean;
  notifications: boolean;
  theme: 'light' | 'dark' | 'system';
  captureDelay: number; // ms between captures to avoid rate limiting
}

export interface SyncStorage {
  settings: Settings;
  profile: UserProfile;
}

export interface LocalStorage {
  jobs: Job[];
  lastSync: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autoCapture: true,
  notifications: true,
  theme: 'system',
  captureDelay: 2000,
};

export const DEFAULT_PROFILE: UserProfile = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  linkedinUrl: '',
};

