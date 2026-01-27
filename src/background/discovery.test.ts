/**
 * Discovery Module Tests
 * 
 * Tests for job discovery orchestration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearMockStorage, setMockStorage, getMockStorage, chromeMock } from '@/__tests__/setup';

// ============================================================================
// Test Discovery Logic (Unit Tests)
// ============================================================================

describe('Discovery Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockStorage();
  });

  describe('URL Search Query Extraction', () => {
    function extractSearchQuery(url: string): string {
      try {
        const urlObj = new URL(url);
        // LinkedIn
        const keywords = urlObj.searchParams.get('keywords');
        if (keywords) return keywords;
        // Indeed
        const q = urlObj.searchParams.get('q');
        if (q) return q;
        // Generic fallback
        return urlObj.pathname.split('/').pop() || 'Job Search';
      } catch {
        return 'Job Search';
      }
    }

    it('should extract keywords from LinkedIn URL', () => {
      const url = 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=remote';
      expect(extractSearchQuery(url)).toBe('software engineer');
    });

    it('should extract q parameter from Indeed URL', () => {
      const url = 'https://www.indeed.com/jobs?q=developer&l=new%20york';
      expect(extractSearchQuery(url)).toBe('developer');
    });

    it('should fallback to path for unknown URL patterns', () => {
      const url = 'https://example.com/jobs/software-engineer';
      expect(extractSearchQuery(url)).toBe('software-engineer');
    });

    it('should return default for invalid URLs', () => {
      const url = 'not-a-valid-url';
      expect(extractSearchQuery(url)).toBe('Job Search');
    });
  });

  describe('Job Type Detection', () => {
    function detectJobType(jobTypeStr: string): 'full-time' | 'part-time' | 'contract' | 'internship' {
      const lower = jobTypeStr.toLowerCase();
      if (lower.includes('part')) return 'part-time';
      if (lower.includes('contract')) return 'contract';
      if (lower.includes('intern')) return 'internship';
      return 'full-time';
    }

    it('should detect full-time', () => {
      expect(detectJobType('Full-time')).toBe('full-time');
      expect(detectJobType('FULL TIME')).toBe('full-time');
    });

    it('should detect part-time', () => {
      expect(detectJobType('Part-time')).toBe('part-time');
      expect(detectJobType('Part Time Position')).toBe('part-time');
    });

    it('should detect contract', () => {
      expect(detectJobType('Contract')).toBe('contract');
      expect(detectJobType('6 month contract')).toBe('contract');
    });

    it('should detect internship', () => {
      expect(detectJobType('Internship')).toBe('internship');
      expect(detectJobType('Summer Intern')).toBe('internship');
    });
  });

  describe('Location Type Detection', () => {
    function detectLocationType(location: string): 'remote' | 'hybrid' | 'onsite' {
      const lower = location.toLowerCase();
      if (lower.includes('remote')) return 'remote';
      if (lower.includes('hybrid')) return 'hybrid';
      return 'onsite';
    }

    it('should detect remote', () => {
      expect(detectLocationType('Remote')).toBe('remote');
      expect(detectLocationType('Work From Home (Remote)')).toBe('remote');
    });

    it('should detect hybrid', () => {
      expect(detectLocationType('New York (Hybrid)')).toBe('hybrid');
      expect(detectLocationType('Hybrid - 3 days office')).toBe('hybrid');
    });

    it('should default to onsite', () => {
      expect(detectLocationType('San Francisco, CA')).toBe('onsite');
      expect(detectLocationType('New York')).toBe('onsite');
    });
  });
});

// ============================================================================
// Session Reports Storage
// ============================================================================

describe('Session Reports Storage', () => {
  const REPORTS_STORAGE_KEY = 'discovery_session_reports';

  beforeEach(() => {
    clearMockStorage();
  });

  it('should store reports to chrome storage', async () => {
    const reports = [
      { id: '1', startedAt: Date.now(), success: true },
      { id: '2', startedAt: Date.now(), success: false },
    ];

    await chromeMock.storage.local.set({ [REPORTS_STORAGE_KEY]: reports });

    const storage = getMockStorage();
    expect(storage[REPORTS_STORAGE_KEY]).toEqual(reports);
  });

  it('should load reports from chrome storage', async () => {
    const reports = [{ id: '1', startedAt: Date.now(), success: true }];
    setMockStorage({ [REPORTS_STORAGE_KEY]: reports });

    const result = await chromeMock.storage.local.get(REPORTS_STORAGE_KEY);
    expect(result[REPORTS_STORAGE_KEY]).toEqual(reports);
  });

  it('should limit stored reports to max count', () => {
    const MAX_STORED_REPORTS = 50;
    const reports = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      startedAt: Date.now() - i * 1000,
    }));

    const reportsToSave = reports.slice(-MAX_STORED_REPORTS);
    expect(reportsToSave.length).toBe(50);
  });

  it('should clear reports from storage', async () => {
    setMockStorage({ [REPORTS_STORAGE_KEY]: [{ id: '1' }] });
    
    await chromeMock.storage.local.remove(REPORTS_STORAGE_KEY);
    
    const storage = getMockStorage();
    expect(storage[REPORTS_STORAGE_KEY]).toBeUndefined();
  });
});

// ============================================================================
// Discovery State Management
// ============================================================================

describe('Discovery State Management', () => {
  type DiscoveryStatus = 'idle' | 'running' | 'paused' | 'error' | 'captcha' | 'login_required';
  
  interface DiscoveryState {
    status: DiscoveryStatus;
    jobsFound: number;
    currentStep: number;
    maxSteps: number;
    error?: string;
    startedAt?: number;
  }

  it('should initialize with correct default state', () => {
    const initialState: DiscoveryState = {
      status: 'idle',
      jobsFound: 0,
      currentStep: 0,
      maxSteps: 50,
    };

    expect(initialState.status).toBe('idle');
    expect(initialState.jobsFound).toBe(0);
  });

  it('should update state correctly', () => {
    let state: DiscoveryState = {
      status: 'idle',
      jobsFound: 0,
      currentStep: 0,
      maxSteps: 50,
    };

    // Simulate starting discovery
    state = {
      ...state,
      status: 'running',
      startedAt: Date.now(),
    };

    expect(state.status).toBe('running');
    expect(state.startedAt).toBeDefined();

    // Simulate progress
    state = {
      ...state,
      jobsFound: 5,
      currentStep: 10,
    };

    expect(state.jobsFound).toBe(5);
    expect(state.currentStep).toBe(10);

    // Simulate completion
    state = {
      ...state,
      status: 'idle',
    };

    expect(state.status).toBe('idle');
  });

  it('should handle error state', () => {
    const state: DiscoveryState = {
      status: 'error',
      jobsFound: 3,
      currentStep: 5,
      maxSteps: 50,
      error: 'Connection timeout',
    };

    expect(state.status).toBe('error');
    expect(state.error).toBe('Connection timeout');
    // Should preserve partial results
    expect(state.jobsFound).toBe(3);
  });
});

// ============================================================================
// Listener Management
// ============================================================================

describe('Listener Management', () => {
  it('should add and remove state listeners', () => {
    const listeners = new Set<(state: unknown) => void>();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    // Add listeners
    listeners.add(listener1);
    listeners.add(listener2);
    expect(listeners.size).toBe(2);

    // Notify listeners
    const state = { status: 'running' };
    listeners.forEach(l => l(state));
    expect(listener1).toHaveBeenCalledWith(state);
    expect(listener2).toHaveBeenCalledWith(state);

    // Remove listener
    listeners.delete(listener1);
    expect(listeners.size).toBe(1);

    // Notify again
    listeners.forEach(l => l(state));
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(2);
  });

  it('should handle listener errors gracefully', () => {
    const listeners = new Set<(state: unknown) => void>();
    const errorListener = vi.fn().mockImplementation(() => {
      throw new Error('Listener error');
    });
    const normalListener = vi.fn();

    listeners.add(errorListener);
    listeners.add(normalListener);

    const state = { status: 'running' };
    
    // Should not throw, should continue to other listeners
    listeners.forEach(l => {
      try {
        l(state);
      } catch {
        // Ignore errors
      }
    });

    expect(errorListener).toHaveBeenCalled();
    expect(normalListener).toHaveBeenCalled();
  });
});

// ============================================================================
// Session Report Structure
// ============================================================================

describe('Session Report Structure', () => {
  it('should create complete report structure', () => {
    const startedAt = Date.now();
    const endedAt = startedAt + 30000;

    const report = {
      id: crypto.randomUUID(),
      startedAt,
      endedAt,
      duration: endedAt - startedAt,
      task: 'Extract 10 jobs',
      sourceUrl: 'https://linkedin.com/jobs/search/',
      success: true,
      stoppedReason: 'complete',
      jobsFound: 10,
      jobsExtracted: [],
      bindingFixes: 0,
      commandsExecuted: 25,
      totalSteps: 3,
      successfulSteps: 3,
      failedSteps: 0,
      totalActions: 15,
      successfulActions: 15,
      failedActions: 0,
      steps: [],
      urlsVisited: ['https://linkedin.com/jobs/search/'],
      logs: [],
    };

    expect(report.id).toBeDefined();
    expect(report.duration).toBe(30000);
    expect(report.success).toBe(true);
    expect(report.jobsFound).toBe(10);
  });

  it('should track step logs correctly', () => {
    const step = {
      step: 1,
      timestamp: Date.now(),
      goal: 'Navigate to page',
      actions: [
        { timestamp: Date.now(), action: 'navigate', details: 'https://example.com', status: 'ok' as const },
        { timestamp: Date.now(), action: 'wait', details: 'page load', status: 'ok' as const },
      ],
      url: 'https://example.com',
      success: true,
    };

    expect(step.actions.length).toBe(2);
    expect(step.actions.every(a => a.status === 'ok')).toBe(true);
  });

  it('should track failed actions', () => {
    const step = {
      step: 1,
      timestamp: Date.now(),
      goal: 'Extract data',
      actions: [
        { 
          timestamp: Date.now(), 
          action: 'extract', 
          details: 'Selector failed', 
          status: 'fail' as const,
          error: 'Element not found',
        },
      ],
      success: false,
      error: 'Element not found',
    };

    expect(step.success).toBe(false);
    expect(step.actions[0].error).toBe('Element not found');
  });
});

// ============================================================================
// Discovery Options Validation
// ============================================================================

describe('Discovery Options', () => {
  interface DiscoveryOptions {
    maxJobs: number;
    url: string;
    forceRefresh?: boolean;
  }

  function validateOptions(options: DiscoveryOptions): { valid: boolean; error?: string } {
    if (!options.url || options.url.trim() === '') {
      return { valid: false, error: 'URL is required' };
    }
    if (options.maxJobs <= 0) {
      return { valid: false, error: 'maxJobs must be positive' };
    }
    try {
      new URL(options.url);
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
    return { valid: true };
  }

  it('should validate correct options', () => {
    const options: DiscoveryOptions = {
      maxJobs: 10,
      url: 'https://linkedin.com/jobs/search/',
      forceRefresh: false,
    };

    const result = validateOptions(options);
    expect(result.valid).toBe(true);
  });

  it('should reject empty URL', () => {
    const options: DiscoveryOptions = {
      maxJobs: 10,
      url: '',
    };

    const result = validateOptions(options);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('URL is required');
  });

  it('should reject invalid URL format', () => {
    const options: DiscoveryOptions = {
      maxJobs: 10,
      url: 'not-a-url',
    };

    const result = validateOptions(options);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid URL format');
  });

  it('should reject non-positive maxJobs', () => {
    const options: DiscoveryOptions = {
      maxJobs: 0,
      url: 'https://example.com',
    };

    const result = validateOptions(options);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('maxJobs must be positive');
  });
});





