# Recipe Composer Types

export type RecipeActionType = 'click' | 'type' | 'scroll';

export interface RecipeAction {
  type: RecipeActionType;
  selector: string;
  text?: string;
}

export interface RecipeWait {
  type: 'delay' | 'until';
  ms?: number;
  selector?: string;
}

export interface RecipeExtract {
  key: string;
  selector: string;
  attr?: 'href' | 'text';
}

export interface RecipeLoop {
  type: 'forEach' | 'until';
  over: string;
  maxIterations?: number;
  steps: RecipeStep[];
}

export interface RecipeExpect {
  selector: string;
  containsText?: string;
}

export interface RecipeStep {
  action?: RecipeAction;
  wait?: RecipeWait;
  extract?: RecipeExtract;
  loop?: RecipeLoop;
  expect?: RecipeExpect;
  note?: string;
}

export interface Recipe {
  goal: string;
  steps: RecipeStep[];
}

