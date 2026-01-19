/**
 * Offscreen Document for WebLLM
 *
 * Runs in an offscreen document context which has full web API access,
 * including Cache API with proper CORS support for model downloads.
 */

import {
  CreateMLCEngine,
  MLCEngineInterface,
  ChatCompletionMessageParam,
  prebuiltAppConfig,
} from '@mlc-ai/web-llm';
import {
  initializeVLM,
  describeImage,
  analyzePageForAction,
  isVLMReady,
  isVLMInitializing,
} from './vision';

// ============================================================================
// State
// ============================================================================

let engine: MLCEngineInterface | null = null;
let isInitializing = false;

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Offscreen] Received message:', message.type);

  if (message.type === 'INIT_LLM') {
    handleInit(message.modelId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'LLM_CHAT') {
    handleChat(message.messages, message.options)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'LLM_STATUS') {
    sendResponse({
      success: true,
      ready: engine !== null && !isInitializing,
      initializing: isInitializing,
    });
    return true;
  }

  // VLM (Vision) message handlers
  if (message.type === 'INIT_VLM') {
    handleInitVLM(message.modelSize)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'VLM_DESCRIBE') {
    handleVLMDescribe(message.imageData, message.prompt)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'VLM_ANALYZE') {
    handleVLMAnalyze(message.imageData, message.task, message.currentStep)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'VLM_STATUS') {
    sendResponse({
      success: true,
      ready: isVLMReady(),
      initializing: isVLMInitializing(),
    });
    return true;
  }
});

// ============================================================================
// LLM Functions
// ============================================================================

async function handleInit(modelId: string): Promise<{ success: boolean; error?: string }> {
  if (engine) {
    console.log('[Offscreen] Engine already initialized');
    return { success: true };
  }

  if (isInitializing) {
    console.log('[Offscreen] Already initializing');
    return { success: false, error: 'Already initializing' };
  }

  isInitializing = true;
  console.log(`[Offscreen] Initializing model: ${modelId}`);

  try {
    engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        console.log(`[Offscreen] Loading: ${Math.round(report.progress * 100)}% - ${report.text || ''}`);
        // Send progress to service worker
        chrome.runtime.sendMessage({
          type: 'LLM_PROGRESS',
          progress: report.progress,
          text: report.text,
        }).catch(() => {}); // Ignore if no listener
      },
      logLevel: 'INFO',
      appConfig: {
        ...prebuiltAppConfig,
        useIndexedDBCache: true,
      },
    });

    isInitializing = false;
    console.log('[Offscreen] Engine initialized successfully');
    return { success: true };
  } catch (error) {
    isInitializing = false;
    console.error('[Offscreen] Failed to initialize:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleChat(
  messages: ChatCompletionMessageParam[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ success: boolean; content?: string; error?: string }> {
  if (!engine) {
    return { success: false, error: 'Engine not initialized' };
  }

  try {
    const response = await engine.chat.completions.create({
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { success: false, error: 'Empty response from LLM' };
    }

    return { success: true, content };
  } catch (error) {
    console.error('[Offscreen] Chat error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================================
// VLM Functions
// ============================================================================

async function handleInitVLM(
  modelSize: 'tiny' | 'small' | 'base' = 'tiny'
): Promise<{ success: boolean; error?: string }> {
  console.log(`[Offscreen] Initializing VLM with size: ${modelSize}`);

  try {
    const success = await initializeVLM(modelSize, (progress) => {
      chrome.runtime.sendMessage({
        type: 'VLM_PROGRESS',
        progress,
      }).catch(() => {}); // Ignore if no listener
    });

    return { success };
  } catch (error) {
    console.error('[Offscreen] VLM initialization failed:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleVLMDescribe(
  imageData: string,
  prompt?: string
): Promise<{ success: boolean; description?: string; error?: string }> {
  if (!isVLMReady()) {
    return { success: false, error: 'VLM not initialized' };
  }

  try {
    const description = await describeImage(imageData, prompt);
    return { success: true, description };
  } catch (error) {
    console.error('[Offscreen] VLM describe error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleVLMAnalyze(
  imageData: string,
  task: string,
  currentStep: string
): Promise<{ success: boolean; analysis?: string; error?: string }> {
  if (!isVLMReady()) {
    return { success: false, error: 'VLM not initialized' };
  }

  try {
    const analysis = await analyzePageForAction(imageData, task, currentStep);
    return { success: true, analysis };
  } catch (error) {
    console.error('[Offscreen] VLM analyze error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

console.log('[Offscreen] Script loaded');
