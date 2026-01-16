/**
 * DOM Observer for LinkedIn job pages
 * Watches for new job cards appearing in the feed
 */

import { SELECTORS } from './selectors';
import { scrapeJobCards } from './jobScraper';

type JobCallback = (job: ReturnType<typeof scrapeJobCards>) => void;

let observer: MutationObserver | null = null;
const processedJobIds = new Set<string>();

/**
 * Set up mutation observer to detect new job cards
 */
export function setupObserver(onJobDetected: JobCallback): void {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            // Check if the added node is a job card
            if (isJobCard(node)) {
              processJobCard(node, onJobDetected);
            }
            
            // Check for job cards within the added node
            const cards = node.querySelectorAll(SELECTORS.jobCard);
            cards.forEach((card) => {
              processJobCard(card as HTMLElement, onJobDetected);
            });
          }
        });
      }
    }
  });

  // Observe the job list container or body
  const container = document.querySelector(SELECTORS.jobListContainer) || document.body;
  
  observer.observe(container, {
    childList: true,
    subtree: true,
  });
}

/**
 * Stop observing
 */
export function stopObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

/**
 * Check if an element is a job card
 */
function isJobCard(element: HTMLElement): boolean {
  return (
    element.matches(SELECTORS.jobCard) ||
    element.hasAttribute('data-job-id') ||
    element.classList.contains('job-card-container') ||
    element.classList.contains('jobs-search-results__list-item')
  );
}

/**
 * Process a job card element
 */
function processJobCard(card: HTMLElement, onJobDetected: JobCallback): void {
  const job = scrapeJobCards(card);
  
  if (!job?.linkedinJobId) return;
  
  // Avoid processing the same job twice
  if (processedJobIds.has(job.linkedinJobId)) return;
  
  processedJobIds.add(job.linkedinJobId);
  onJobDetected(job);
}

/**
 * Clear processed job IDs (useful when navigating to new search)
 */
export function clearProcessedJobs(): void {
  processedJobIds.clear();
}

