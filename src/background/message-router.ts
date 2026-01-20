/// <reference types="vite/client" />
/**
 * Chrome Extension Message Router
 * 
 * Handles:
 * - Chrome extension messaging (runtime.onMessage)
 * - Extension lifecycle events (onInstalled, onClicked, tabs.onUpdated)
 * - Broadcasting messages to popup/UI
 * - Badge updates
 */

import { addJob, updateJob, getJobs, getSettings } from '@shared/utils/storage';
import { createMessage, type ExtensionMessage } from '@shared/types/messages';
import { logger } from '@shared/utils';
import {
  startDiscovery,
  stopDiscovery,
  getDiscoveryState,
  getSessionReports,
  getLastSessionReport,
  onStateChange,
  onJobFound,
  hasLLMConfig,
} from './discovery';

// ============================================================================
// Initialization
// ============================================================================

logger.info('Background service worker started');

// Wire up discovery state changes to broadcast messages
onStateChange((state) => {
  broadcastMessage(createMessage('DISCOVERY_STATE', {
    status: state.status,
    jobsFound: state.jobsFound,
    currentStep: state.currentStep,
    maxSteps: state.maxSteps,
    error: state.error,
  }));
});

// Wire up job found events to storage and notifications
onJobFound(async (job) => {
  await addJob(job);
  broadcastMessage(createMessage('DISCOVERY_JOB_FOUND', job));
  
  const settings = await getSettings();
  if (settings.notifications) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  }
});

// ============================================================================
// Message Broadcasting
// ============================================================================

async function broadcastMessage(message: ExtensionMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // Ignore send errors (no receivers)
  }
}

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  logger.debug('Received message', { type: message.type });
  
  switch (message.type) {
    // ---- Job Management ----
    case 'CAPTURE_JOB': {
      await addJob(message.payload);
      logger.info('Job captured', { jobId: message.payload.id });
      
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
      return { success: true };
    }
    
    case 'APPLY_TO_JOB': {
      const { jobId } = message.payload;
      await updateJob(jobId, { status: 'applied' });
      return { success: true, jobId };
    }
    
    case 'SCRAPE_CURRENT_PAGE': {
      if (sender.tab?.id) {
        const response = await chrome.tabs.sendMessage(sender.tab.id, message);
        return response;
      }
      return { error: 'No active tab' };
    }
    
    // ---- Discovery ----
    case 'START_DISCOVERY': {
      if (!hasLLMConfig()) {
        return { 
          success: false, 
          error: 'LLM not configured. Set VITE_GEMINI_API_KEY in .env file.' 
        };
      }
      
      const { maxJobs = 20, url } = message.payload;
      
      if (!url) {
        return { success: false, error: 'URL is required for discovery' };
      }
      
      startDiscovery({ maxJobs, url })
        .then((result) => {
          logger.info('Discovery completed', { 
            success: result.success, 
            jobsFound: result.jobs.length,
            stoppedReason: result.stoppedReason 
          });
        })
        .catch((err) => {
          logger.error('Discovery failed', { error: err.message });
        });
      
      return { success: true, message: 'Discovery started' };
    }
    
    case 'STOP_DISCOVERY': {
      await stopDiscovery();
      return { success: true };
    }
    
    case 'DISCOVERY_STATE': {
      return getDiscoveryState();
    }
    
    case 'GET_SESSION_REPORT': {
      const allReports = await getSessionReports();
      const lastReport = await getLastSessionReport();
      return { 
        lastReport,
        allReports,
        count: allReports.length,
      };
    }
    
    default:
      return { error: 'Unknown message type' };
  }
}

// ============================================================================
// Chrome Extension Lifecycle
// ============================================================================

chrome.action.onClicked.addListener(async () => {
  chrome.action.setBadgeText({ text: '' });
  const url = chrome.runtime.getURL('index.html');
  const tabs = await chrome.tabs.query({ url });
  
  if (tabs.length > 0 && tabs[0].id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId!, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('linkedin.com')) {
    logger.debug('LinkedIn tab loaded', { tabId });
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    logger.info('Extension installed');
  } else if (details.reason === 'update') {
    logger.info('Extension updated', { previousVersion: details.previousVersion });
  }
});

export {};

