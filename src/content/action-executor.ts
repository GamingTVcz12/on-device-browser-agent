/**
 * Action Executor
 *
 * Executes browser actions in the page context.
 * Supports: click, type, extract, scroll, wait
 * (Navigate is handled by the service worker)
 */

import type { ActionResult, ActionType } from '../shared/types';
import { TYPING_DELAY, DEFAULT_WAIT_TIMEOUT } from '../shared/constants';

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute a browser action and return the result
 */
export async function executeAction(
  actionType: ActionType,
  params: Record<string, string>
): Promise<ActionResult> {
  console.log(`[Content] Executing action: ${actionType}`, params);

  try {
    switch (actionType) {
      case 'click':
        return await executeClick(params.selector);

      case 'type':
        return await executeType(params.selector, params.text);

      case 'extract':
        return await executeExtract(params.selector);

      case 'scroll':
        return await executeScroll(
          params.direction as 'up' | 'down',
          parseInt(params.amount || '500', 10)
        );

      case 'wait':
        return await executeWait(params.selector, parseInt(params.timeout || String(DEFAULT_WAIT_TIMEOUT), 10));

      case 'navigate':
        // Navigation is handled by service worker, but we might receive it here
        return { success: true, data: 'Navigation handled by service worker' };

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Content] Action failed:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

// ============================================================================
// Action Implementations
// ============================================================================

/**
 * Click an element by selector
 */
async function executeClick(selector: string): Promise<ActionResult> {
  const element = document.querySelector(selector);

  if (!element) {
    return { success: false, error: `Element not found: ${selector}` };
  }

  if (!(element instanceof HTMLElement)) {
    return { success: false, error: `Element is not interactive: ${selector}` };
  }

  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(300);

  // Focus the element
  element.focus();

  // Dispatch click events
  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
  });
  element.dispatchEvent(clickEvent);

  // Also try native click for buttons/links
  if (typeof element.click === 'function') {
    element.click();
  }

  // Check if it was a link that should navigate
  if (element instanceof HTMLAnchorElement && element.href) {
    return { success: true, data: `Clicked link to: ${element.href}` };
  }

  // Check if it was a submit button
  if (element instanceof HTMLButtonElement && element.type === 'submit') {
    const form = element.closest('form');
    if (form) {
      return { success: true, data: 'Clicked submit button' };
    }
  }

  return { success: true, data: `Clicked element: ${selector}` };
}

/**
 * Type text into an input element
 */
async function executeType(selector: string, text: string): Promise<ActionResult> {
  const element = document.querySelector(selector);

  if (!element) {
    return { success: false, error: `Element not found: ${selector}` };
  }

  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    // Try to find an input within the element
    const input = element.querySelector('input, textarea');
    if (input && (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return executeType(generateSelectorForElement(input), text);
    }
    return { success: false, error: `Element is not an input: ${selector}` };
  }

  // Scroll into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(200);

  // Focus and clear
  element.focus();
  element.value = '';

  // Dispatch focus event
  element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

  // Type character by character for better compatibility
  for (const char of text) {
    element.value += char;

    // Dispatch input event
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: char,
        inputType: 'insertText',
      })
    );

    await sleep(TYPING_DELAY);
  }

  // Dispatch change event
  element.dispatchEvent(new Event('change', { bubbles: true }));

  // Check if we should submit (e.g., search box)
  const form = element.closest('form');
  if (form && element.type === 'search') {
    // Some search boxes auto-submit, give them a moment
    await sleep(100);
  }

  return { success: true, data: `Typed "${text}" into ${selector}` };
}

/**
 * Extract text content from an element
 */
async function executeExtract(selector: string): Promise<ActionResult> {
  // Handle empty/body selector for full page extraction
  if (!selector || selector === 'body' || selector === 'page') {
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content'];
    let target: Element | null = null;

    for (const sel of mainSelectors) {
      target = document.querySelector(sel);
      if (target) break;
    }

    if (!target) {
      target = document.body;
    }

    const text = (target as HTMLElement).innerText || '';
    return { success: true, data: text.trim().slice(0, 5000) };
  }

  const element = document.querySelector(selector);

  if (!element) {
    return { success: false, error: `Element not found: ${selector}` };
  }

  const text = (element as HTMLElement).innerText || element.textContent || '';
  return { success: true, data: text.trim() };
}

/**
 * Scroll the page
 */
async function executeScroll(
  direction: 'up' | 'down',
  amount: number
): Promise<ActionResult> {
  const scrollAmount = direction === 'down' ? amount : -amount;

  window.scrollBy({
    top: scrollAmount,
    behavior: 'smooth',
  });

  await sleep(500); // Wait for scroll to complete

  return {
    success: true,
    data: `Scrolled ${direction} by ${amount}px. New scroll position: ${window.scrollY}`,
  };
}

/**
 * Wait for an element to appear or a fixed time
 */
async function executeWait(
  selector?: string,
  timeout: number = DEFAULT_WAIT_TIMEOUT
): Promise<ActionResult> {
  if (!selector) {
    await sleep(timeout);
    return { success: true, data: `Waited ${timeout}ms` };
  }

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element) {
      return { success: true, data: `Found element: ${selector}` };
    }
    await sleep(100);
  }

  return { success: false, error: `Timeout waiting for element: ${selector}` };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a selector for an element (simple version)
 */
function generateSelectorForElement(element: HTMLElement): string {
  if (element.id) {
    return `#${element.id}`;
  }

  const name = element.getAttribute('name');
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${name}"]`;
  }

  // Fall back to tag and classes
  const classes = Array.from(element.classList).slice(0, 2).join('.');
  if (classes) {
    return `${element.tagName.toLowerCase()}.${classes}`;
  }

  return element.tagName.toLowerCase();
}
