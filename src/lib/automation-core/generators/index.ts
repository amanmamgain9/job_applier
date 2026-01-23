/**
 * Generators - Phase 2 & 3 of the agent flow
 * 
 * Phase 2 Generators create structured recipe fragments for specific interactions:
 * - FilterGenerator: Apply filters to narrow results
 * - SortGenerator: Change sort order
 * - SearchGenerator: Perform searches
 * 
 * Phase 3 RecipeGenerator assembles everything into a complete recipe.
 */

export { FilterGenerator } from './filter-generator';
export { SortGenerator } from './sort-generator';
export { SearchGenerator } from './search-generator';
export { RecipeGenerator, type RecipeGeneratorContext, type RecipeGeneratorResult } from './recipe-generator';

export type {
  GeneratorContext,
  GeneratorResult,
  GeneratorFragment,
  Generator,
} from './types';

