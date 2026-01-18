/**
 * JSON repair and manipulation utilities
 */

import { jsonrepair } from 'jsonrepair';
import { createLogger } from './logger';

const logger = createLogger('Utils:JSON');

/**
 * Get the current timestamp as a formatted string
 */
export function getCurrentTimestampStr(): string {
  return new Date()
    .toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(',', '');
}

/**
 * Fix malformed JSON string using the jsonrepair library
 * Only called when initial JSON.parse fails
 */
export function repairJsonString(jsonString: string): string {
  try {
    const repairedJson = jsonrepair(jsonString.trim());
    logger.debug('Successfully repaired JSON string', { original: jsonString, repaired: repairedJson });
    return repairedJson;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warning('jsonrepair failed to fix JSON string', { original: jsonString, error: errorMessage });
    return jsonString.trim();
  }
}

/**
 * Extract JSON from model output that may contain markdown code blocks
 */
export function extractJsonFromText(text: string): unknown {
  // Try to extract JSON from markdown code blocks first
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // Try to repair the JSON
      const repaired = repairJsonString(jsonBlockMatch[1].trim());
      return JSON.parse(repaired);
    }
  }

  // Try to parse the entire text as JSON
  try {
    return JSON.parse(text.trim());
  } catch {
    // Try to repair the JSON
    const repaired = repairJsonString(text.trim());
    return JSON.parse(repaired);
  }
}

/**
 * Cap text length with ellipsis
 */
export function capTextLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

