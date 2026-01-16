// LinkedIn DOM selectors
// Note: These may change as LinkedIn updates their UI

export const SELECTORS = {
  // Job cards in lists/feed
  jobCard: '.jobs-search-results__list-item, .job-card-container, .jobs-job-board-list__item, [data-job-id]',
  jobCardAlt: '[data-job-id]',
  
  // Job list container (for mutation observer)
  jobListContainer: '.jobs-search-results__list, .scaffold-layout__list, .jobs-search-two-pane__wrapper',
  
  // Job card details (for scraping cards in list)
  cardTitle: '.job-card-list__title, .job-card-container__link strong, .artdeco-entity-lockup__title',
  cardCompany: '.job-card-container__company-name, .job-card-container__primary-description, .artdeco-entity-lockup__subtitle',
  cardLocation: '.job-card-container__metadata-item, .artdeco-entity-lockup__caption',
  cardEasyApply: '.job-card-container__apply-method, [aria-label*="Easy Apply"]',
  
  // Job detail page selectors
  jobTitle: '.jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title, .t-24.t-bold',
  companyName: '.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name',
  location: '.jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__bullet',
  salary: '.job-card-list__salary-info, .jobs-unified-top-card__job-insight',
  companyLogo: '.jobs-unified-top-card__company-logo img, .job-details-jobs-unified-top-card__company-logo img',
  jobDescription: '.jobs-description, .jobs-box__html-content, .jobs-description-content__text',
  jobId: '[data-job-id]',
  
  // Easy Apply
  easyApply: '.jobs-apply-button--top-card, .jobs-apply-button, [aria-label*="Easy Apply"]',
  easyApplyButton: '.jobs-apply-button, [data-control-name="jobdetails_topcard_inapply"]',
  easyApplyBadge: '.jobs-apply-button--top-card, .job-card-container__apply-method',
  easyApplyModal: '.jobs-easy-apply-modal, .jobs-apply-form',
  
  // Application form fields
  formFields: {
    firstName: 'input[name="firstName"], input[id*="firstName"]',
    lastName: 'input[name="lastName"], input[id*="lastName"]',
    email: 'input[name="email"], input[type="email"]',
    phone: 'input[name="phone"], input[type="tel"]',
    resume: 'input[type="file"][accept*="pdf"], input[name*="resume"]',
  },
  
  // Navigation buttons in Easy Apply
  nextButton: 'button[aria-label="Continue to next step"], button[data-easy-apply-next-button]',
  submitButton: 'button[aria-label="Submit application"], button[data-control-name="submit_unify"]',
  reviewButton: 'button[aria-label="Review your application"], button[data-control-name="review_application"]',
  
  // Job metadata
  jobType: '.job-card-container__metadata-item--workplace-type, .jobs-unified-top-card__workplace-type',
  postedDate: '.jobs-unified-top-card__posted-date, time',
  applicants: '.jobs-unified-top-card__applicant-count',
} as const;

// Extract job ID from URL or element
export function extractJobId(urlOrElement: string | HTMLElement): string | null {
  if (typeof urlOrElement === 'string') {
    const match = urlOrElement.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : null;
  }
  
  const jobIdAttr = urlOrElement.getAttribute('data-job-id');
  if (jobIdAttr) return jobIdAttr;
  
  const link = urlOrElement.querySelector('a[href*="/jobs/view/"]');
  if (link) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : null;
  }
  
  return null;
}

