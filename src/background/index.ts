/**
 * Background Service Worker
 *
 * Main entry point for the extension's background process.
 * Handles:
 * - Communication with popup UI
 * - Task execution orchestration
 * - DOM state retrieval from content scripts
 * - Action execution via content scripts
 */

import { executor } from './agents/executor';
import { visionEngine } from './vision-engine';
import { POPUP_PORT_NAME, POST_NAVIGATION_DELAY, PAGE_LOAD_TIMEOUT } from '../shared/constants';
import type { DOMState, ActionResult, ExecutorEvent, BackgroundMessage } from '../shared/types';

// ============================================================================
// State
// ============================================================================

let activePort: chrome.runtime.Port | null = null;
let currentTabId: number | null = null;

// ============================================================================
// Port Connection Handler
// ============================================================================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== POPUP_PORT_NAME) return;

  console.log('[Background] Popup connected');
  activePort = port;

  port.onMessage.addListener(async (message: BackgroundMessage) => {
    console.log('[Background] Received message:', message.type);

    if (message.type === 'START_TASK') {
      await handleStartTask(message.payload.task, port, message.payload.visionMode);
    } else if (message.type === 'CANCEL_TASK') {
      executor.cancel();
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[Background] Popup disconnected');
    activePort = null;
  });
});

// ============================================================================
// Task Execution
// ============================================================================

async function handleStartTask(
  task: string,
  port: chrome.runtime.Port,
  visionMode: boolean = false
): Promise<void> {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    port.postMessage({ type: 'ERROR', error: 'No active tab found. Please open a web page first.' });
    return;
  }

  currentTabId = tab.id;

  // Set up event forwarding to popup
  const unsubscribe = executor.onEvent((event: ExecutorEvent) => {
    try {
      port.postMessage({ type: 'EXECUTOR_EVENT', event });
    } catch (e) {
      console.error('[Background] Failed to send event to popup:', e);
    }
  });

  try {
    // Vision mode is not yet fully implemented in executor
    // For now, log it and use standard mode
    if (visionMode) {
      console.log('[Background] Vision mode requested - using screenshot-based navigation');
      // TODO: Pass visionMode to executor when VisionExecutor is implemented
    }

    const result = await executor.executeTask(
      task,
      () => getDOMState(currentTabId!),
      (actionType, params) => executeAction(currentTabId!, actionType, params)
    );

    port.postMessage({ type: 'TASK_RESULT', result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Background] Task failed:', errorMsg);
    port.postMessage({ type: 'ERROR', error: errorMsg });
  } finally {
    unsubscribe();
    currentTabId = null;
  }
}

// ============================================================================
// DOM State Retrieval
// ============================================================================

async function getDOMState(tabId: number): Promise<DOMState> {
  try {
    // First, try to inject the content script if it's not already loaded
    await ensureContentScriptLoaded(tabId);

    // Use message passing to get DOM state
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_DOM_STATE' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Failed to get DOM state:', chrome.runtime.lastError.message);
          // Return minimal state on error
          resolve({
            url: 'unknown',
            title: 'Error loading page state',
            interactiveElements: [],
            pageText: '',
          });
          return;
        }

        if (response?.success && response.data) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || 'Failed to get DOM state'));
        }
      });
    });
  } catch (error) {
    console.error('[Background] Error getting DOM state:', error);
    // Return minimal state
    return {
      url: 'unknown',
      title: 'Error loading page state',
      interactiveElements: [],
      pageText: '',
    };
  }
}

// ============================================================================
// Action Execution
// ============================================================================

async function executeAction(
  tabId: number,
  actionType: string,
  params: Record<string, string>
): Promise<ActionResult> {
  console.log('[Background] Executing action:', actionType, params);

  // Handle navigation specially - it changes the page
  if (actionType === 'navigate') {
    return executeNavigation(tabId, params.url);
  }

  // Ensure content script is loaded
  await ensureContentScriptLoaded(tabId);

  // Execute other actions via message passing
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'EXECUTE_ACTION', payload: { actionType, params } },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message || 'Failed to execute action',
          });
          return;
        }

        resolve(response || { success: false, error: 'No response from content script' });
      }
    );
  });
}

async function executeNavigation(tabId: number, url: string): Promise<ActionResult> {
  try {
    // Ensure URL has protocol
    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    await chrome.tabs.update(tabId, { url: targetUrl });
    await waitForTabLoad(tabId);

    return { success: true, data: `Navigated to ${targetUrl}` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function ensureContentScriptLoaded(tabId: number): Promise<void> {
  try {
    // Try to ping the content script
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Content script not loaded'));
        } else if (response?.ok) {
          resolve();
        } else {
          reject(new Error('Invalid response'));
        }
      });

      // Timeout after 500ms
      setTimeout(() => reject(new Error('Timeout')), 500);
    });
  } catch {
    // Content script not loaded - this can happen on restricted pages (chrome://, extension pages)
    // or if the page hasn't finished loading yet. The manifest.json declares content scripts
    // to be injected on all URLs, so if we can't reach it, the page likely doesn't support
    // content script injection.
    console.warn('[Background] Content script not available in tab', tabId);
    console.warn('[Background] This may be a restricted page (chrome://, extension, etc.)');
    // Continue anyway - the caller will handle the error when trying to communicate
  }
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete' && !resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        // Give page time to render
        setTimeout(resolve, POST_NAVIGATION_DELAY);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Timeout after max wait time
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, PAGE_LOAD_TIMEOUT);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Content Script Ready Handler
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONTENT_SCRIPT_READY') {
    console.log('[Background] Content script ready in tab:', sender.tab?.id);
    sendResponse({ ok: true });
  } else if (message.type === 'PING') {
    sendResponse({ ok: true });
  } else if (message.type === 'VLM_PROGRESS') {
    // Forward VLM progress to vision engine
    visionEngine.handleProgressUpdate(message.progress);
    sendResponse({ ok: true });
  }
  return true;
});

// ============================================================================
// Extension Install Handler
// ============================================================================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);
});

console.log('[Background] Service worker started');
