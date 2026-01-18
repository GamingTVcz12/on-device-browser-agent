/**
 * WebLLM Engine Manager
 *
 * Manages the lifecycle of the WebLLM engine for on-device inference.
 * Uses WebGPU for acceleration in Chrome 124+.
 */

import {
  CreateExtensionServiceWorkerMLCEngine,
  MLCEngine,
  ChatCompletionMessageParam,
  InitProgressReport,
} from '@mlc-ai/web-llm';
import { DEFAULT_MODEL, FALLBACK_MODELS } from '../shared/constants';

// ============================================================================
// Types
// ============================================================================

interface LLMEngineState {
  engine: MLCEngine | null;
  isLoading: boolean;
  loadProgress: number;
  currentModel: string | null;
  error: string | null;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

type ProgressCallback = (progress: number) => void;

// ============================================================================
// LLM Engine Manager (Singleton)
// ============================================================================

class LLMEngineManager {
  private state: LLMEngineState = {
    engine: null,
    isLoading: false,
    loadProgress: 0,
    currentModel: null,
    error: null,
  };

  private progressCallbacks: Set<ProgressCallback> = new Set();
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the WebLLM engine with the specified model
   * Uses cached model if available, otherwise downloads
   */
  async initialize(modelId: string = DEFAULT_MODEL): Promise<void> {
    // Return existing promise if already initializing
    if (this.initializationPromise && this.state.currentModel === modelId) {
      return this.initializationPromise;
    }

    // Already loaded with same model
    if (this.state.engine && this.state.currentModel === modelId) {
      return;
    }

    this.initializationPromise = this.doInitialize(modelId);
    return this.initializationPromise;
  }

  private async doInitialize(modelId: string): Promise<void> {
    this.state.isLoading = true;
    this.state.error = null;
    this.state.loadProgress = 0;

    // Check for WebGPU support before attempting to load model
    // WebGPU is required for efficient on-device LLM inference
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      const error = new Error(
        'WebGPU not supported. This extension requires Chrome 124+ with a WebGPU-capable GPU. ' +
        'Check chrome://gpu to verify WebGPU support.'
      );
      this.state.error = error.message;
      this.state.isLoading = false;
      throw error;
    }

    const modelsToTry = [modelId, ...FALLBACK_MODELS.filter(m => m !== modelId)];

    for (const model of modelsToTry) {
      try {
        console.log(`[LLM Engine] Initializing model: ${model}`);

        this.state.engine = await CreateExtensionServiceWorkerMLCEngine(model, {
          initProgressCallback: (report: InitProgressReport) => {
            this.state.loadProgress = report.progress;
            this.notifyProgress(report.progress);
            console.log(`[LLM Engine] Loading: ${Math.round(report.progress * 100)}%`);
          },
        });

        this.state.currentModel = model;
        this.state.isLoading = false;
        this.state.loadProgress = 1;
        this.notifyProgress(1);

        console.log(`[LLM Engine] Successfully loaded: ${model}`);
        return;
      } catch (error) {
        console.error(`[LLM Engine] Failed to load ${model}:`, error);

        if (model === modelsToTry[modelsToTry.length - 1]) {
          // Last model, throw error
          this.state.error = error instanceof Error ? error.message : String(error);
          this.state.isLoading = false;
          throw error;
        }
        // Try next model
        console.log(`[LLM Engine] Trying fallback model...`);
      }
    }
  }

  /**
   * Send a chat completion request to the LLM
   * Returns the complete response as a string
   */
  async chat(
    messages: ChatCompletionMessageParam[],
    options: ChatOptions = {}
  ): Promise<string> {
    if (!this.state.engine) {
      throw new Error('LLM engine not initialized. Call initialize() first.');
    }

    const response = await this.state.engine.chat.completions.create({
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    return content;
  }

  /**
   * Send a streaming chat completion request
   * Calls onChunk for each token, returns full response
   */
  async chatStream(
    messages: ChatCompletionMessageParam[],
    onChunk: (chunk: string) => void,
    options: ChatOptions = {}
  ): Promise<string> {
    if (!this.state.engine) {
      throw new Error('LLM engine not initialized. Call initialize() first.');
    }

    const stream = await this.state.engine.chat.completions.create({
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? '';
      fullResponse += content;
      if (content) {
        onChunk(content);
      }
    }

    return fullResponse;
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
    return this.state.engine !== null && !this.state.isLoading;
  }

  /**
   * Subscribe to progress updates during model loading
   * Returns unsubscribe function
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  private notifyProgress(progress: number): void {
    this.progressCallbacks.forEach(cb => {
      try {
        cb(progress);
      } catch (e) {
        console.error('[LLM Engine] Progress callback error:', e);
      }
    });
  }

  /**
   * Reset the engine state (for testing or error recovery)
   */
  async reset(): Promise<void> {
    if (this.state.engine) {
      // WebLLM doesn't have a dispose method, just clear reference
      this.state.engine = null;
    }
    this.state = {
      engine: null,
      isLoading: false,
      loadProgress: 0,
      currentModel: null,
      error: null,
    };
    this.initializationPromise = null;
  }
}

// Export singleton instance
export const llmEngine = new LLMEngineManager();
