/**
 * Handoff Contracts
 * 
 * Standard interfaces for agent communication.
 * Every agent call must include a goal, every response must indicate completion.
 */

/**
 * Input to any agent/sub-agent
 */
export interface HandoffInput<TContext = unknown> {
  goal: string;                // REQUIRED: what we want to achieve
  context?: TContext;          // optional: additional context
}

/**
 * Output from any agent/sub-agent
 */
export interface HandoffOutput<TResult = unknown> {
  goalCompleted: boolean;      // REQUIRED: did we achieve the goal?
  result?: TResult;            // optional: what we produced
  reason?: string;             // optional: why goal failed (if not completed)
}


