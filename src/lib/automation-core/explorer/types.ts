/**
 * Types for the Page Explorer - LLM with tools to explore pages
 */

// ============================================================================
// Tool Definitions (what the LLM can do)
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

// The tools available to the LLM
export const EXPLORER_TOOLS: ToolDefinition[] = [
  {
    name: 'click',
    description: 'Click on an element. Use this to explore what happens when you interact with buttons, links, list items, etc. After clicking, you will receive the updated page state.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.filters", "a[href*=jobs]", ".job-card:first-child")',
        },
        reason: {
          type: 'string',
          description: 'Why you are clicking this element - what do you expect to learn?',
        },
      },
      required: ['selector', 'reason'],
    },
  },
  {
    name: 'observe',
    description: 'Get the current state of the page or a specific section. Use this to see what changed after an action, or to focus on a specific area.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional CSS selector to focus on a specific part of the page. Leave empty to observe the full page.',
        },
        what: {
          type: 'string',
          description: 'What are you trying to observe or understand?',
        },
      },
      required: ['what'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page or a specific scrollable container to see more content.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: 'Direction to scroll',
          enum: ['up', 'down'],
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector for a scrollable container. Leave empty to scroll the main page.',
        },
        reason: {
          type: 'string',
          description: 'Why you are scrolling - what do you expect to find?',
        },
      },
      required: ['direction', 'reason'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into an input field. Use this to test search boxes, forms, etc.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the input element',
        },
        text: {
          type: 'string',
          description: 'Text to type',
        },
        reason: {
          type: 'string',
          description: 'Why you are typing this - what do you expect to happen?',
        },
      },
      required: ['selector', 'text', 'reason'],
    },
  },
  {
    name: 'done',
    description: 'Call this when you have fully understood the page. Provide your complete analysis.',
    parameters: {
      type: 'object',
      properties: {
        understanding: {
          type: 'string',
          description: 'Your complete understanding of the page - what it is, how it works, what the user can do, how interactions behave.',
        },
        page_type: {
          type: 'string',
          description: 'Type of page (job_listings, search_results, login, form, dashboard, article, etc.)',
        },
        key_findings: {
          type: 'string',
          description: 'Most important things discovered through exploration (e.g., "clicking a job shows details in right panel", "filters open a sidebar")',
        },
      },
      required: ['understanding', 'page_type', 'key_findings'],
    },
  },
];

// ============================================================================
// Tool Call Types (what the LLM sends back)
// ============================================================================

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ClickArgs {
  selector: string;
  reason: string;
}

export interface ObserveArgs {
  selector?: string;
  what: string;
}

export interface ScrollArgs {
  direction: 'up' | 'down';
  selector?: string;
  reason: string;
}

export interface TypeTextArgs {
  selector: string;
  text: string;
  reason: string;
}

export interface DoneArgs {
  understanding: string;
  page_type: string;
  key_findings: string;
}

// ============================================================================
// Tool Result (what we send back to the LLM)
// ============================================================================

export interface ToolResult {
  success: boolean;
  /** Description of what happened */
  observation: string;
  /** Updated DOM state (if relevant) */
  dom?: string;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Explorer Result (final output)
// ============================================================================

export interface ExplorerResult {
  success: boolean;
  understanding: string;
  pageType: string;
  keyFindings: string;
  /** All the steps taken during exploration */
  explorationLog: ExplorationStep[];
  error?: string;
}

export interface ExplorationStep {
  action: string;
  reason: string;
  result: string;
  timestamp: number;
}

