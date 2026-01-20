/**
 * LLM module exports
 */

export { createChatModel, validateLLMConfig } from './factory';
export type { ChatModelConfig } from './factory';

// Dual-model cost optimization
export { 
  DualModelManager, 
  CostTracker,
  createDualModelConfig,
} from './tiered-factory';
export type { 
  DualModelConfig, 
  ModelRole, 
  UsageRecord,
  CostInfo,
} from './tiered-factory';

