// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Default model for agent inference
 * Qwen2.5-1.5B provides a good balance of capability and size
 */
export const DEFAULT_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

/**
 * Fallback models if the default fails to load
 */
export const FALLBACK_MODELS = [
  'Phi-3.5-mini-instruct-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
];

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Maximum steps before giving up on a task
 */
export const MAX_STEPS = 15;

/**
 * Maximum replanning attempts when stuck
 */
export const MAX_REPLANS = 2;

/**
 * LLM temperature for agent inference (lower = more deterministic)
 */
export const AGENT_TEMPERATURE = 0.3;

/**
 * Maximum tokens for agent responses
 */
export const AGENT_MAX_TOKENS = 2048;

// ============================================================================
// DOM Observation Configuration
// ============================================================================

/**
 * CSS selectors for interactive elements
 */
export const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  "[role='button']",
  "[role='link']",
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
];

/**
 * Maximum interactive elements to include in DOM state
 * (prevents token overflow in agent prompts)
 */
export const MAX_INTERACTIVE_ELEMENTS = 30;

/**
 * Maximum page text length in DOM state
 */
export const MAX_PAGE_TEXT_LENGTH = 3000;

// ============================================================================
// Timing Configuration
// ============================================================================

/**
 * Delay after navigation for page to settle
 */
export const POST_NAVIGATION_DELAY = 500;

/**
 * Delay between simulated keystrokes
 */
export const TYPING_DELAY = 30;

/**
 * Default wait timeout for elements
 */
export const DEFAULT_WAIT_TIMEOUT = 3000;

/**
 * Maximum wait time for page load
 */
export const PAGE_LOAD_TIMEOUT = 30000;

// ============================================================================
// Message Port Names
// ============================================================================

export const POPUP_PORT_NAME = 'popup-connection';
