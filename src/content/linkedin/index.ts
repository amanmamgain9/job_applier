import { SELECTORS } from './selectors';
import { scrapeJobFromPage, scrapeJobCards } from './jobScraper';
import { setupObserver } from './observer';
import { createMessage } from '@shared/types/messages';
import { logger, generateId } from '@shared/utils';
import { getSettings } from '@shared/utils/storage';
import type { Job } from '@shared/types/job';

// Content script initialization
logger.info('LinkedIn content script loaded');

// Check if we're on a relevant page
const isJobPage = () => window.location.href.includes('/jobs');

// Initialize based on page type
async function init() {
  const settings = await getSettings();
  
  if (!settings.autoCapture) {
    logger.debug('Auto-capture disabled');
    return;
  }
  
  if (isJobPage()) {
    logger.debug('Job page detected, setting up observers');
    setupObserver(handleJobDetected);
    
    // Initial scan for job cards
    setTimeout(() => {
      scanForJobs();
    }, 1000);
  }
}

// Scan page for job cards
function scanForJobs() {
  const jobCards = document.querySelectorAll(SELECTORS.jobCard);
  logger.debug(`Found ${jobCards.length} job cards`);
  
  jobCards.forEach((card) => {
    const job = scrapeJobCards(card as HTMLElement);
    if (job) {
      handleJobDetected(job);
    }
  });
}

// Handle detected job
async function handleJobDetected(jobData: ReturnType<typeof scrapeJobCards>) {
  if (!jobData || !jobData.linkedinJobId || !jobData.title) {
    return;
  }
  
  const job: Job = {
    id: generateId(),
    sourceJobId: jobData.linkedinJobId,
    title: jobData.title,
    company: jobData.company || 'Unknown Company',
    companyLogo: jobData.companyLogo,
    location: jobData.location || 'Unknown Location',
    locationType: jobData.locationType || 'onsite',
    salary: jobData.salary,
    jobType: jobData.jobType || 'full-time',
    postedAt: jobData.postedAt || new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    url: jobData.url || window.location.href,
    description: jobData.description,
    status: 'pending',
  };
  
  // Send to background
  try {
    await chrome.runtime.sendMessage(createMessage('CAPTURE_JOB', job));
    logger.debug('Job sent to background', { jobId: job.id, title: job.title });
  } catch (error) {
    logger.error('Failed to send job to background', error);
  }
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCRAPE_CURRENT_PAGE') {
    const job = scrapeJobFromPage();
    sendResponse({ job });
    return true;
  }
  
  return false;
});

// Initialize
init();

export {};
