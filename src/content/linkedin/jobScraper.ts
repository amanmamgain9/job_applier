/**
 * LinkedIn Job Scraping Utilities
 */

import { SELECTORS } from './selectors';
import type { LocationType, JobType, Salary } from '@shared/types/job';

interface ScrapedJob {
  linkedinJobId: string;
  title: string;
  company: string;
  companyLogo?: string;
  location: string;
  locationType: LocationType;
  salary?: Salary;
  jobType: JobType;
  postedAt: string;
  url: string;
  description?: string;
  easyApply: boolean;
}

/**
 * Scrape job details from the current job detail page
 */
export function scrapeJobFromPage(): Partial<ScrapedJob> | null {
  try {
    // Extract job ID from URL
    const urlMatch = window.location.href.match(/\/jobs\/view\/(\d+)/);
    const linkedinJobId = urlMatch?.[1];

    if (!linkedinJobId) {
      return null;
    }

    // Title
    const titleEl = document.querySelector(SELECTORS.jobTitle);
    const title = titleEl?.textContent?.trim();

    // Company
    const companyEl = document.querySelector(SELECTORS.companyName);
    const company = companyEl?.textContent?.trim();

    // Location
    const locationEl = document.querySelector(SELECTORS.location);
    const location = locationEl?.textContent?.trim() || '';

    // Easy Apply badge
    const easyApplyEl = document.querySelector(SELECTORS.easyApply);
    const easyApply = !!easyApplyEl;

    // Company logo
    const logoEl = document.querySelector(SELECTORS.companyLogo) as HTMLImageElement;
    const companyLogo = logoEl?.src;

    // Description
    const descriptionEl = document.querySelector(SELECTORS.jobDescription);
    const description = descriptionEl?.textContent?.trim();

    // Determine location type
    const locationType = inferLocationType(location);

    return {
      linkedinJobId,
      title: title || 'Unknown Title',
      company: company || 'Unknown Company',
      companyLogo,
      location,
      locationType,
      jobType: 'full-time',
      postedAt: new Date().toISOString(),
      url: window.location.href,
      description,
      easyApply,
    };
  } catch (error) {
    console.error('Failed to scrape job from page:', error);
    return null;
  }
}

/**
 * Scrape job data from a job card element
 */
export function scrapeJobCards(card: HTMLElement): Partial<ScrapedJob> | null {
  try {
    // Job ID from data attribute or link
    const jobIdAttr = card.getAttribute('data-job-id');
    const linkEl = card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement;
    const linkMatch = linkEl?.href?.match(/\/jobs\/view\/(\d+)/);
    const linkedinJobId = jobIdAttr || linkMatch?.[1];

    if (!linkedinJobId) {
      return null;
    }

    // Title
    const titleEl = card.querySelector(SELECTORS.cardTitle);
    const title = titleEl?.textContent?.trim();

    // Company
    const companyEl = card.querySelector(SELECTORS.cardCompany);
    const company = companyEl?.textContent?.trim();

    // Location
    const locationEl = card.querySelector(SELECTORS.cardLocation);
    const location = locationEl?.textContent?.trim() || '';

    // Easy Apply
    const easyApplyEl = card.querySelector(SELECTORS.cardEasyApply);
    const easyApply = !!easyApplyEl;

    // Company logo
    const logoEl = card.querySelector('img') as HTMLImageElement;
    const companyLogo = logoEl?.src;

    // Job URL
    const url = linkEl?.href || `https://www.linkedin.com/jobs/view/${linkedinJobId}`;

    return {
      linkedinJobId,
      title: title || 'Unknown Title',
      company: company || 'Unknown Company',
      companyLogo,
      location,
      locationType: inferLocationType(location),
      jobType: 'full-time',
      postedAt: new Date().toISOString(),
      url,
      easyApply,
    };
  } catch (error) {
    console.error('Failed to scrape job card:', error);
    return null;
  }
}

/**
 * Infer location type from location string
 */
function inferLocationType(location: string): LocationType {
  const lower = location.toLowerCase();
  if (lower.includes('remote')) return 'remote';
  if (lower.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

/**
 * Parse salary string to Salary object
 */
export function parseSalary(salaryText: string): Salary | undefined {
  if (!salaryText) return undefined;

  // Match patterns like "$100K - $150K", "100,000 - 150,000", etc.
  const match = salaryText.match(/[\$£€]?\s*([\d,]+)[Kk]?\s*[-–]\s*[\$£€]?\s*([\d,]+)[Kk]?/);
  
  if (!match) return undefined;

  let min = parseInt(match[1].replace(/,/g, ''), 10);
  let max = parseInt(match[2].replace(/,/g, ''), 10);

  // Handle K notation
  if (salaryText.toLowerCase().includes('k')) {
    if (min < 1000) min *= 1000;
    if (max < 1000) max *= 1000;
  }

  // Determine currency
  let currency = 'USD';
  if (salaryText.includes('£')) currency = 'GBP';
  else if (salaryText.includes('€')) currency = 'EUR';
  else if (salaryText.includes('₹')) currency = 'INR';

  return { min, max, currency };
}

