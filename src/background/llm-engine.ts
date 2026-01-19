/**
 * WebLLM Engine Manager
 *
 * Manages the lifecycle of the WebLLM engine via an offscreen document.
 * The offscreen document has full web API access for model downloads.
 */

import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { DEFAULT_MODEL, FALLBACK_MODELS } from '../shared/constants';

// ============================================================================
// Types
// ============================================================================

interface LLMEngineState {
  isLoading: boolean;
  loadProgress: number;
  currentModel: string | null;
  error: string | null;
  ready: boolean;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

type ProgressCallback = (progress: number) => void;

// ============================================================================
// Offscreen Document Management
// ============================================================================

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');

  // Check if already exists
  // @ts-expect-error - getContexts is available in Chrome 116+
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create if not exists
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'WebLLM requires web APIs for model loading and inference',
  });

  await creatingOffscreen;
  creatingOffscreen = null;
  console.log('[LLM Engine] Offscreen document created');
}

// ============================================================================
// LLM Engine Manager (Singleton)
// ============================================================================

class LLMEngineManager {
  private state: LLMEngineState = {
    isLoading: false,
    loadProgress: 0,
    currentModel: null,
    error: null,
    ready: false,
  };

  private progressCallbacks: Set<ProgressCallback> = new Set();
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // Listen for progress updates from offscreen document
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'LLM_PROGRESS') {
        this.state.loadProgress = message.progress;
        this.notifyProgress(message.progress);
      }
    });
  }

  /**
   * Initialize the WebLLM engine with the specified model
   */
  async initialize(modelId: string = DEFAULT_MODEL): Promise<void> {
    if (this.initializationPromise && this.state.currentModel === modelId) {
      return this.initializationPromise;
    }

    if (this.state.ready && this.state.currentModel === modelId) {
      return;
    }

    this.initializationPromise = this.doInitialize(modelId);
    return this.initializationPromise;
  }

  private async doInitialize(modelId: string): Promise<void> {
    this.state.isLoading = true;
    this.state.error = null;
    this.state.loadProgress = 0;
    this.state.ready = false;

    const modelsToTry = [modelId, ...FALLBACK_MODELS.filter((m) => m !== modelId)];

    for (const model of modelsToTry) {
      try {
        console.log(`[LLM Engine] Initializing model: ${model}`);

        // Ensure offscreen document exists
        await ensureOffscreenDocument();
        console.log('[LLM Engine] Offscreen document ready');

        // Send init request to offscreen document
        const response = await chrome.runtime.sendMessage({
          type: 'INIT_LLM',
          modelId: model,
        });

        if (!response.success) {
          throw new Error(response.error || 'Unknown error');
        }

        this.state.currentModel = model;
        this.state.isLoading = false;
        this.state.loadProgress = 1;
        this.state.ready = true;
        this.notifyProgress(1);

        console.log(`[LLM Engine] Successfully loaded: ${model}`);
        return;
      } catch (error) {
        console.error(`[LLM Engine] Failed to load ${model}:`, error);

        if (model === modelsToTry[modelsToTry.length - 1]) {
          this.state.error = error instanceof Error ? error.message : String(error);
          this.state.isLoading = false;
          throw error;
        }
        console.log(`[LLM Engine] Trying fallback model...`);
      }
    }
  }

  /**
   * Send a chat completion request to the LLM
   */
  async chat(
    messages: ChatCompletionMessageParam[],
    options: ChatOptions = {}
  ): Promise<string> {
    if (!this.state.ready) {
      throw new Error('LLM engine not initialized. Call initialize() first.');
    }

    const response = await chrome.runtime.sendMessage({
      type: 'LLM_CHAT',
      messages,
      options,
    });

    if (!response.success) {
      throw new Error(response.error || 'Chat failed');
    }

    return response.content;
  }

  /**
   * Send a streaming chat completion request (falls back to non-streaming)
   */
  async chatStream(
    messages: ChatCompletionMessageParam[],
    onChunk: (chunk: string) => void,
    options: ChatOptions = {}
  ): Promise<string> {
    // For now, use non-streaming and return all at once
    const content = await this.chat(messages, options);
    onChunk(content);
    return content;
  }

  /**
   * Get the current state of the engine
   */
  getState(): Readonly<LLMEngineState> {
    return { ...this.state };
  }

  /**
   * Check if the engine is ready for inference
   */
  isReady(): boolean {
    return this.state.ready && !this.state.isLoading;
  }

  /**
   * Subscribe to progress updates during model loading
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  private notifyProgress(progress: number): void {
    this.progressCallbacks.forEach((cb) => {
      try {
        cb(progress);
      } catch (e) {
        console.error('[LLM Engine] Progress callback error:', e);
      }
    });
  }

  /**
   * Reset the engine state
   */
  async reset(): Promise<void> {
    this.state = {
      isLoading: false,
      loadProgress: 0,
      currentModel: null,
      error: null,
      ready: false,
    };
    this.initializationPromise = null;
  }
}

// Export singleton instance
export const llmEngine = new LLMEngineManager();
