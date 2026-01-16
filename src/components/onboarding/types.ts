export interface CVData {
  fileName: string;
  fileSize: number;
  blob: Blob;
  textContent: string;
  uploadedAt: Date;
  parsed?: ParsedCV;
}

export interface ParsedCV {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  skills: string[];
  experience: Array<{
    title: string;
    company: string;
    duration?: string;
  }>;
  education: Array<{
    degree: string;
    institution: string;
    year?: string;
  }>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ExtractedPreferences {
  roles: string[];
  locations: Array<{ type: 'remote' | 'onsite' | 'hybrid'; location?: string }>;
  salary?: { min: number; currency: string };
  companySize?: ('startup' | 'mid' | 'enterprise')[];
  industries?: string[];
  dealbreakers?: string[];
  mustHaves?: string[];
}

export interface Preferences {
  rawChat: ChatMessage[];
  summary?: string;
  extracted?: ExtractedPreferences;
}

export type OnboardingStep = 'cv' | 'preferences' | 'complete';

export interface OnboardingState {
  step: OnboardingStep;
  cv: CVData | null;
  preferences: Preferences;
}

