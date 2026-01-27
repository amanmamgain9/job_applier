/**
 * Consolidator Agent
 * 
 * Uses LLM to intelligently recognize and consolidate behavioral patterns.
 * Replaces brittle code-based pattern matching with semantic understanding.
 * 
 * Key responsibilities:
 * - Analyze raw observations and identify patterns
 * - Group similar behaviors (e.g., clicking different job listings = same pattern)
 * - Determine confidence levels (testing vs confirmed)
 * - Maintain element type distinctions (job listing vs apply button)
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { BehaviorPattern } from '../memory/types';

const SYSTEM_PROMPT = `You analyze user interactions on a web page to identify and consolidate behavioral patterns.

Your job is to group similar actions that produce the same type of effect, while PRESERVING important details.

PATTERN RECOGNITION RULES:
1. Group actions by their EFFECT, not just the selector
   - "Clicked #ember200 → job details panel updated" and "Clicked #ember210 → job details panel updated"
   - These are the SAME pattern: "clicking job listings updates the details panel"

2. Keep DIFFERENT element types STRICTLY separate
   - "apply button" and "job listing" are DIFFERENT patterns
   - "Easy Apply button" and "external Apply button" might be DIFFERENT patterns
   - "close button" and "filter button" are DIFFERENT patterns
   - "filter dropdown" and "main filter button" might be DIFFERENT patterns

3. Confidence levels:
   - "testing": Observed only once - not yet confirmed
   - "confirmed": Observed 2+ times with consistent behavior - reliable pattern

4. Element type classification (be SPECIFIC):
   - "job listing" - items in the job results list
   - "Easy Apply button" - LinkedIn's quick apply button
   - "external apply button" - apply button that goes to external site
   - "filter button" - buttons that open filter options
   - "filter dropdown" - dropdown for specific filter (date, experience, etc.)
   - "close button" - buttons that close modals/dialogs
   - "discard button" - button to discard/cancel an action
   - "navigation link" - links that navigate to different pages
   - "save button" - buttons that save/bookmark items
   - "pagination control" - buttons for next/previous page

CRITICAL - PRESERVE DETAILS:
- Include SPECIFIC information in effect descriptions
- BAD: "Updates the job details panel"
- GOOD: "Updates the job details panel to show job title, company, description, and apply button"
- BAD: "Opens a modal"
- GOOD: "Opens Easy Apply modal with contact info form and progress bar"

DO NOT over-consolidate. If two observations have meaningfully different effects, keep them as separate patterns.

OUTPUT: Call consolidate_patterns() with your analysis.`;

export interface ConsolidatorInput {
  rawObservations: string[];   // All observations so far
  existingPatterns: BehaviorPattern[];  // Current patterns (may be incomplete)
  latestObservation?: {
    action: string;
    selector?: string;
    elementType: string;
    effect: string;
    changeType: string;
  };
  truncatedDom?: string;  // Optional: current DOM for context
}

export interface ConsolidatorOutput {
  patterns: {
    id: string;
    elementType: string;        // "job listing", "apply button", etc.
    action: string;             // "click", "scroll", etc.
    effect: string;             // Human-readable effect description
    changeType: string;         // "content_loaded", "modal_opened", etc.
    confidence: 'testing' | 'confirmed';
    count: number;
    exampleSelectors: string[];
  }[];
  
  // Observations that don't fit any pattern yet
  uncategorized: string[];
}

const consolidateTool = {
  type: 'function' as const,
  function: {
    name: 'consolidate_patterns',
    description: 'Report consolidated behavioral patterns from the observations',
    parameters: {
      type: 'object',
      properties: {
        patterns: {
          type: 'array',
          description: 'List of consolidated behavioral patterns',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique identifier for this pattern (use existing ID if updating, or generate new like "pattern_joblist_1")',
              },
              element_type: {
                type: 'string',
                description: 'Type of element: "job listing", "apply button", "filter button", "close button", "navigation link", "dropdown button", "save button", "pagination control", or other specific type',
              },
              action: {
                type: 'string',
                description: 'Action type: "click", "scroll", "type_text"',
              },
              effect: {
                type: 'string',
                description: 'DETAILED description of what happens. Include specifics like: what content appears, what form fields show, what options become available. E.g., "Updates job details panel showing: job title, company name, location, job description, and Apply/Save buttons" or "Opens Easy Apply modal with contact info form (name, email, phone) and resume upload"',
              },
              change_type: {
                type: 'string',
                enum: ['navigation', 'modal_opened', 'modal_closed', 'content_loaded', 'content_removed', 'selection_changed'],
                description: 'Category of change that occurs',
              },
              confidence: {
                type: 'string',
                enum: ['testing', 'confirmed'],
                description: '"confirmed" if observed 2+ times with consistent behavior, "testing" if only once',
              },
              count: {
                type: 'number',
                description: 'Number of times this pattern has been observed',
              },
              example_selectors: {
                type: 'array',
                items: { type: 'string' },
                description: 'Up to 3 example selectors that trigger this pattern',
              },
            },
            required: ['id', 'element_type', 'action', 'effect', 'change_type', 'confidence', 'count', 'example_selectors'],
          },
        },
        uncategorized: {
          type: 'array',
          items: { type: 'string' },
          description: 'Observations that do not fit any pattern yet',
        },
      },
      required: ['patterns', 'uncategorized'],
    },
  },
};

function buildPrompt(input: ConsolidatorInput): string {
  const { rawObservations, existingPatterns, latestObservation, truncatedDom } = input;
  
  let prompt = '';
  
  // Show existing patterns for context
  if (existingPatterns.length > 0) {
    prompt += 'EXISTING PATTERNS (may need updating):\n';
    for (const p of existingPatterns) {
      const status = p.confirmed ? 'confirmed' : 'testing';
      prompt += `- [${p.id}] ${p.action} ${p.targetDescription} → ${p.effect} (${status}, ${p.count}x, selectors: ${p.selectors.join(', ')})\n`;
    }
    prompt += '\n';
  }
  
  // Show all raw observations
  prompt += 'ALL OBSERVATIONS:\n';
  for (let i = 0; i < rawObservations.length; i++) {
    prompt += `${i + 1}. ${rawObservations[i]}\n`;
  }
  prompt += '\n';
  
  // Highlight the latest observation
  if (latestObservation) {
    prompt += 'LATEST ACTION (just happened):\n';
    prompt += `Action: ${latestObservation.action}\n`;
    if (latestObservation.selector) {
      prompt += `Selector: ${latestObservation.selector}\n`;
    }
    prompt += `Element Type (from ChangeAnalyzer): ${latestObservation.elementType}\n`;
    prompt += `Effect: ${latestObservation.effect}\n`;
    prompt += `Change Type: ${latestObservation.changeType}\n`;
    prompt += '\n';
  }
  
  // Optional DOM context
  if (truncatedDom) {
    prompt += 'CURRENT PAGE CONTEXT (truncated):\n';
    prompt += truncatedDom.slice(0, 2000);
    prompt += '\n...\n\n';
  }
  
  prompt += `Analyze all observations and consolidate them into patterns.
- Group similar behaviors together (same element type + same effect = same pattern)
- Update counts and confidence levels
- Keep different element types separate
- Preserve the most descriptive effect text

Call consolidate_patterns() with your analysis.`;
  
  return prompt;
}

export interface ConsolidatorOptions {
  llm: BaseChatModel;
  input: ConsolidatorInput;
}

export async function runConsolidator(options: ConsolidatorOptions): Promise<ConsolidatorOutput> {
  const { llm, input } = options;
  
  // If no observations, return empty
  if (input.rawObservations.length === 0 && !input.latestObservation) {
    return {
      patterns: [],
      uncategorized: [],
    };
  }
  
  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(buildPrompt(input)),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelWithTools = (llm as any).bindTools([consolidateTool]);
  const response = await modelWithTools.invoke(messages) as AIMessage;

  // Extract tool call
  const toolCall = response.tool_calls?.[0];
  if (!toolCall || toolCall.name !== 'consolidate_patterns') {
    // Fallback: return existing patterns unchanged
    return {
      patterns: input.existingPatterns.map(p => ({
        id: p.id,
        elementType: p.targetDescription,
        action: p.action,
        effect: p.effect,
        changeType: p.changeType,
        confidence: p.confirmed ? 'confirmed' as const : 'testing' as const,
        count: p.count,
        exampleSelectors: p.selectors,
      })),
      uncategorized: [],
    };
  }

  const args = toolCall.args as {
    patterns: Array<{
      id: string;
      element_type: string;
      action: string;
      effect: string;
      change_type: string;
      confidence: 'testing' | 'confirmed';
      count: number;
      example_selectors: string[];
    }>;
    uncategorized: string[];
  };

  return {
    patterns: (args.patterns || []).map(p => ({
      id: p.id,
      elementType: p.element_type,
      action: p.action,
      effect: p.effect,
      changeType: p.change_type,
      confidence: p.confidence,
      count: p.count,
      exampleSelectors: p.example_selectors || [],
    })),
    uncategorized: args.uncategorized || [],
  };
}

/**
 * Determine if consolidation should run based on current state.
 * Consolidation is expensive (LLM call), so we run it strategically.
 */
export function shouldRunConsolidation(
  observationCount: number,
  lastConsolidationAt: number,
  currentPatternCount: number,
): boolean {
  const now = Date.now();
  const timeSinceLastConsolidation = now - lastConsolidationAt;
  
  // Run consolidation if:
  // 1. First time (no patterns yet) and we have at least 2 observations
  if (currentPatternCount === 0 && observationCount >= 2) {
    return true;
  }
  
  // 2. Every 3 new observations (batch processing)
  if (observationCount > 0 && observationCount % 3 === 0) {
    return true;
  }
  
  // 3. At least 30 seconds since last consolidation and we have new observations
  if (timeSinceLastConsolidation > 30000 && observationCount > currentPatternCount) {
    return true;
  }
  
  return false;
}

/**
 * Convert ConsolidatorOutput back to BehaviorPattern array for storage.
 */
export function consolidatorOutputToPatterns(output: ConsolidatorOutput): BehaviorPattern[] {
  return output.patterns.map(p => ({
    id: p.id,
    action: p.action,
    targetDescription: p.elementType,
    effect: p.effect,
    changeType: p.changeType,
    selectors: p.exampleSelectors,
    count: p.count,
    confirmed: p.confidence === 'confirmed',
    firstSeen: Date.now(), // Will be overwritten if pattern exists
  }));
}

