/// <reference types="vite/client" />
/**
 * Chrome Extension Message Router
 * 
 * Handles:
 * - Chrome extension messaging (runtime.onMessage)
 * - Extension lifecycle events (onInstalled, onClicked, tabs.onUpdated)
 */

import { addJob, updateJob, getJobs, getSettings } from '@shared/utils/storage';
import type { ExtensionMessage, StartDiscoveryPayload } from '@shared/types/messages';
import { logger } from '@shared/utils';
import { startDiscovery, stopDiscovery, getDiscoveryState, getCurrentReport } from './discovery';

// ============================================================================
// Initialization
// ============================================================================

logger.info('Background service worker started');

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
      const defaultTask = 'Explore this job board to learn how a user searches, refines listings, and reaches the primary action for a listing. Provide a concise, structured understanding suitable for automating how we find and save apply links.';
      const defaultGoals = [
        'Identify where the user enters search criteria (keywords, location, or equivalent).',
        'Identify refinement controls (filters, facets, sort) and the visible options.',
        'Determine how refinements take effect (auto-apply, apply button, or required step).',
        'Determine how to open a listing and reach its primary action (e.g., apply link).',
        'Determine how apply links can be captured or saved.',
      ];
      const { url, task = defaultTask, goals = defaultGoals } = message.payload as StartDiscoveryPayload;
      
      if (!url) {
        return { success: false, error: 'URL is required for discovery' };
      }
      
      // Run discovery
      startDiscovery({ url, task, goals })
        .then((result) => {
          logger.info('Discovery completed', { 
            success: result.success, 
            pagesExplored: result.exploration?.pages?.size ?? 0,
            navigationPath: result.exploration?.navigationPath,
          });
        })
        .catch((err) => {
          logger.error('Discovery failed', { error: err.message });
        });
      
      return { success: true, message: 'Discovery started' };
    }
    
    case 'STOP_DISCOVERY': {
      stopDiscovery();
      return { success: true };
    }
    
    case 'DISCOVERY_STATE': {
      return getDiscoveryState();
    }
    
    case 'GET_SESSION_REPORT': {
      const report = getCurrentReport();
      return { report };
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
