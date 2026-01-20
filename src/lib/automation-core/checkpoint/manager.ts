/**
 * Checkpoint Manager - Save and restore "happy states" for recovery
 * 
 * Happy states are checkpoints saved after successful actions.
 * When something goes wrong, we can restore to the last happy state
 * instead of restarting from scratch.
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('CheckpointManager');

// ============================================================================
// Types
// ============================================================================

export interface HappyState {
  /** Unique ID */
  id: string;
  /** When saved */
  timestamp: number;
  /** Step number */
  step: number;
  /** Task ID */
  taskId: string;
  /** URL at this state */
  url: string;
  /** Page title */
  title: string;
  /** Scroll position */
  scrollY: number;
  /** Data extracted so far */
  extractedData: unknown[];
  /** Brief summary of what's been done */
  summary: string;
}

// ============================================================================
// Happy State Manager
// ============================================================================

const STORAGE_PREFIX = 'happy_state_';

export class HappyStateManager {
  private taskId: string;
  private states: HappyState[] = [];
  private maxStates: number;

  constructor(taskId: string, maxStates: number = 5) {
    this.taskId = taskId;
    this.maxStates = maxStates;
  }

  /**
   * Save a happy state after successful action
   */
  async save(state: Omit<HappyState, 'id' | 'timestamp' | 'taskId'>): Promise<HappyState> {
    const fullState: HappyState = {
      ...state,
      id: `${this.taskId}_step${state.step}_${Date.now()}`,
      timestamp: Date.now(),
      taskId: this.taskId,
    };

    this.states.push(fullState);

    // Store in chrome.storage
    try {
      await chrome.storage.local.set({ 
        [STORAGE_PREFIX + fullState.id]: fullState 
      });
      logger.info(`Saved happy state at step ${state.step}`);
    } catch (error) {
      logger.warning('Failed to persist happy state:', error);
    }

    // Prune old states
    await this.prune();

    return fullState;
  }

  /**
   * Get the latest happy state for recovery
   */
  async getLatest(): Promise<HappyState | null> {
    // Check in-memory first
    if (this.states.length > 0) {
      return this.states[this.states.length - 1];
    }

    // Check storage
    try {
      const result = await chrome.storage.local.get(null);
      const keys = Object.keys(result)
        .filter(k => k.startsWith(STORAGE_PREFIX + this.taskId))
        .sort()
        .reverse();

      if (keys.length > 0) {
        return result[keys[0]] as HappyState;
      }
    } catch (error) {
      logger.warning('Failed to load happy state:', error);
    }

    return null;
  }

  /**
   * Get state by step number
   */
  getByStep(step: number): HappyState | null {
    for (let i = this.states.length - 1; i >= 0; i--) {
      if (this.states[i].step === step) {
        return this.states[i];
      }
    }
    return null;
  }

  /**
   * Prune old states (keep only last N)
   */
  private async prune(): Promise<void> {
    if (this.states.length <= this.maxStates) {
      return;
    }

    const toRemove = this.states.splice(0, this.states.length - this.maxStates);

    // Remove from storage
    try {
      const keysToRemove = toRemove.map(s => STORAGE_PREFIX + s.id);
      await chrome.storage.local.remove(keysToRemove);
      logger.debug(`Pruned ${toRemove.length} old happy states`);
    } catch (error) {
      logger.warning('Failed to prune happy states:', error);
    }
  }

  /**
   * Clear all states for this task
   */
  async clear(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(result)
        .filter(k => k.startsWith(STORAGE_PREFIX + this.taskId));
      await chrome.storage.local.remove(keysToRemove);
    } catch (error) {
      logger.warning('Failed to clear happy states:', error);
    }
    this.states = [];
    logger.info(`Cleared happy states for task ${this.taskId}`);
  }

  /**
   * Build recovery context for navigator
   */
  buildRecoveryContext(state: HappyState, failureReason: string): string {
    return `
RECOVERY: Resuming from step ${state.step} after failure.
Error was: ${failureReason}
Progress so far: ${state.summary}
Extracted: ${state.extractedData.length} items
Current URL: ${state.url}

Try a different approach.
`.trim();
  }
}

