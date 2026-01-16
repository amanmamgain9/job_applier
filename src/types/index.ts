export interface CVData {
  fileName: string;
  fileSize: number;
  blob: Blob;
  textContent: string;
  uploadedAt: Date;
}

export interface Preferences {
  rawChat: ChatMessage[];
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface UserData {
  cv: CVData | null;
  preferences: Preferences | null;
  onboardingComplete: boolean;
}

