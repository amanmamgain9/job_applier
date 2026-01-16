import { addJob, updateJob, getJobs, getSettings } from '@shared/utils/storage';
import { createMessage, type ExtensionMessage } from '@shared/types/messages';
import { logger } from '@shared/utils';
import { 
  startDiscovery, 
  stopDiscovery, 
  getDiscoveryState, 
  onStateChange, 
  onJobFound,
  hasLLMConfig 
} from '@/services/automation';

// Service Worker initialization
logger.info('Background service worker started');

// Subscribe to discovery events and broadcast to popup
onStateChange((state) => {
  broadcastMessage(createMessage('DISCOVERY_STATE', {
    status: state.status,
    jobsFound: state.jobsFound,
    currentStep: state.currentStep,
    maxSteps: state.maxSteps,
    error: state.error,
  }));
});

onJobFound(async (job) => {
  // Save job to storage
  await addJob(job);
  
  // Broadcast to popup
  broadcastMessage(createMessage('DISCOVERY_JOB_FOUND', job));
  
  // Update badge
  const settings = await getSettings();
  if (settings.notifications) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  }
});

// Broadcast message to all extension views
async function broadcastMessage(message: ExtensionMessage): Promise<void> {
  try {
    // Send to popup (if open)
    await chrome.runtime.sendMessage(message).catch(() => {
      // Popup not open, ignore
    });
  } catch {
    // Ignore send errors
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep message channel open for async response
});

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  logger.debug('Received message', { type: message.type, sender: sender.tab?.id });
  
  switch (message.type) {
    case 'CAPTURE_JOB': {
      await addJob(message.payload);
      logger.info('Job captured', { jobId: message.payload.id });
      
      // Notify popup if settings allow
      const settings = await getSettings();
      if (settings.notifications) {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
      }
      
      return { success: true, jobId: message.payload.id };
    }
    
    case 'GET_JOBS': {
      const jobs = await getJobs();
      return { jobs };
    }
    
    case 'UPDATE_JOB_STATUS': {
      await updateJob(message.payload.jobId, { status: message.payload.status });
      logger.info('Job status updated', message.payload);
      return { success: true };
    }
    
    case 'APPLY_TO_JOB': {
      // TODO: Implement auto-apply logic
      const { jobId } = message.payload;
      logger.info('Apply to job requested', { jobId });
      
      // For now, just mark as applied
      await updateJob(jobId, { status: 'applied' });
      
      return { success: true, jobId };
    }
    
    case 'SCRAPE_CURRENT_PAGE': {
      // Send message to content script to scrape
      if (sender.tab?.id) {
        const response = await chrome.tabs.sendMessage(sender.tab.id, message);
        return response;
      }
      return { error: 'No active tab' };
    }
    
    case 'START_DISCOVERY': {
      console.log('[Background] START_DISCOVERY received');
      
      // Check if LLM is configured
      if (!hasLLMConfig()) {
        console.error('[Background] LLM not configured');
        return { 
          success: false, 
          error: 'LLM not configured. Set VITE_ANTHROPIC_API_KEY in .env file.' 
        };
      }
      
      const { maxJobs = 20, searchQuery } = message.payload;
      
      // Get user preferences from storage
      const preferencesResult = await chrome.storage.sync.get('preferences');
      const preferences = preferencesResult.preferences?.extracted || { roles: [], locations: [] };
      
      console.log('[Background] Starting discovery with:', { maxJobs, searchQuery, preferences });
      logger.info('Starting job discovery', { maxJobs, searchQuery, preferences });
      
      // Start discovery (async, don't await - results come via events)
      startDiscovery({ maxJobs, preferences, searchQuery })
        .then((result) => {
          console.log('[Background] Discovery completed:', result);
          logger.info('Discovery completed', { 
            success: result.success, 
            jobsFound: result.jobs.length,
            stoppedReason: result.stoppedReason 
          });
        })
        .catch((err) => {
          console.error('[Background] Discovery failed:', err);
          logger.error('Discovery failed', { error: err.message });
        });
      
      return { success: true, message: 'Discovery started' };
    }
    
    case 'STOP_DISCOVERY': {
      await stopDiscovery();
      logger.info('Discovery stopped by user');
      return { success: true };
    }
    
    case 'DISCOVERY_STATE': {
      // Request current state
      const state = getDiscoveryState();
      return state;
    }
    
    default:
      logger.debug('Unknown message type', { type: (message as ExtensionMessage).type });
      return { error: 'Unknown message type' };
  }
}

// Open full-page UI when extension icon is clicked
chrome.action.onClicked.addListener(async () => {
  // Clear badge
  chrome.action.setBadgeText({ text: '' });
  
  // Get the extension's main page URL
  const url = chrome.runtime.getURL('index.html');
  
  // Check if the page is already open
  const tabs = await chrome.tabs.query({ url });
  
  if (tabs.length > 0 && tabs[0].id) {
    // Focus existing tab
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId!, { focused: true });
  } else {
    // Open new tab
    await chrome.tabs.create({ url });
  }
});

// Listen for tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === 'complete' &&
    tab.url?.includes('linkedin.com')
  ) {
    logger.debug('LinkedIn tab loaded', { tabId, url: tab.url });
  }
});

// Extension install/update handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    logger.info('Extension installed');
    // Initialize default settings
  } else if (details.reason === 'update') {
    logger.info('Extension updated', { previousVersion: details.previousVersion });
  }
});

export {};
