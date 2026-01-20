/**
 * Job Extractor - Cheap extraction using Flash-Lite model
 * 
 * Extracts structured job data from visible page content.
 * Uses minimal prompt and cheap model for maximum cost efficiency.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { createLogger } from '../utils/logger';

const logger = createLogger('JobExtractor');

// ============================================================================
// Types
// ============================================================================

export const JobDataSchema = z.object({
  title: z.string().describe('Job title'),
  company: z.string().describe('Company name'),
  location: z.string().nullable().describe('Location or "Remote"'),
  salary: z.string().nullable().describe('Salary if shown'),
  jobType: z.string().nullable().describe('Full-time, Part-time, Contract, etc.'),
  experienceLevel: z.string().nullable().describe('Entry, Mid-Senior, etc.'),
  jobId: z.string().nullable().describe('Unique job ID from URL or page'),
  description: z.string().nullable().describe('First 500 chars of description'),
  postedTime: z.string().nullable().describe('When posted, e.g. "2 days ago"'),
});

export type JobData = z.infer<typeof JobDataSchema>;

// ============================================================================
// Extraction Prompt (minimal for cost efficiency)
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `Extract job details from job card text. Output ONLY valid JSON, no explanation.

IMPORTANT:
- Company name is usually on the second line or after the job title
- Location follows the company name
- Look for patterns like "Company Name · Location · Time ago"
- For LinkedIn: Format is usually "Title\\nCompany\\nLocation · Posted time"`;

const EXTRACTION_USER_TEMPLATE = `Extract job from this text:
---
{content}
---

Output this JSON structure (fill in actual values from the text above):
{"title":"Job Title","company":"Company Name","location":"City, State or Remote","salary":null,"jobType":"Full-time","experienceLevel":null,"jobId":null,"description":null,"postedTime":"2 days ago"}`;

// ============================================================================
// Job Extractor
// ============================================================================

export class JobExtractor {
  private model: BaseChatModel;

  constructor(model: BaseChatModel) {
    this.model = model;
  }

  /**
   * Extract job data from visible page content
   * Uses minimal prompt for cost efficiency
   */
  async extract(visibleContent: string): Promise<JobData | null> {
    // Truncate content to reduce tokens (first 3000 chars usually enough)
    const truncatedContent = visibleContent.substring(0, 3000);

    const messages = [
      new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
      new HumanMessage(EXTRACTION_USER_TEMPLATE.replace('{content}', truncatedContent)),
    ];

    try {
      const response = await this.model.invoke(messages);
      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warning('No JSON found in extractor response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = JobDataSchema.safeParse(parsed);
      
      if (!validated.success) {
        logger.warning('Validation failed:', validated.error.message);
        // Return partial data anyway
        return {
          title: parsed.title || 'Unknown',
          company: parsed.company || 'Unknown',
          location: parsed.location || null,
          salary: parsed.salary || null,
          jobType: parsed.jobType || null,
          experienceLevel: parsed.experienceLevel || null,
          jobId: parsed.jobId || null,
          description: parsed.description || null,
          postedTime: parsed.postedTime || null,
        };
      }

      return validated.data;
    } catch (error) {
      logger.error('Extraction failed:', error);
      return null;
    }
  }

  /**
   * Extract multiple jobs from a list view
   */
  async extractMultiple(visibleContent: string, maxJobs: number = 10): Promise<JobData[]> {
    const truncatedContent = visibleContent.substring(0, 8000);

    const messages = [
      new SystemMessage('Extract job listings. Output JSON array only.'),
      new HumanMessage(
        `Extract up to ${maxJobs} jobs from:\n${truncatedContent}\n\n` +
        `JSON array: [{"title":"...","company":"...","location":"...","salary":null,"jobType":"...","jobId":"..."},...]`
      ),
    ];

    try {
      const response = await this.model.invoke(messages);
      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warning('No JSON array found in response');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(item => ({
        title: item.title || 'Unknown',
        company: item.company || 'Unknown',
        location: item.location || null,
        salary: item.salary || null,
        jobType: item.jobType || null,
        experienceLevel: item.experienceLevel || null,
        jobId: item.jobId || null,
        description: item.description || null,
        postedTime: item.postedTime || null,
      }));
    } catch (error) {
      logger.error('Multi-extraction failed:', error);
      return [];
    }
  }
}

// ============================================================================
// Standalone extraction function (for use without class)
// ============================================================================

export async function extractJobFromContent(
  model: BaseChatModel,
  content: string
): Promise<JobData | null> {
  const extractor = new JobExtractor(model);
  return extractor.extract(content);
}

