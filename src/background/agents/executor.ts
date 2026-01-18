/**
 * Executor / Orchestrator
 *
 * Coordinates the Planner and Navigator agents to execute tasks.
 * Manages:
 * - Agent lifecycle and initialization
 * - Task execution loop
 * - Error recovery and replanning
 * - Event emission for UI updates
 */

import { PlannerAgent } from './planner-agent';
import { NavigatorAgent } from './navigator-agent';
import { llmEngine } from '../llm-engine';
import type {
  AgentContext,
  DOMState,
  ActionResult,
  AgentStep,
  ExecutorEvent,
} from '../../shared/types';
import { MAX_STEPS, MAX_REPLANS } from '../../shared/constants';

// ============================================================================
// Types
// ============================================================================

type GetDOMStateFn = () => Promise<DOMState>;
type ExecuteActionFn = (actionType: string, params: Record<string, string>) => Promise<ActionResult>;
type EventListener = (event: ExecutorEvent) => void;

// ============================================================================
// Executor
// ============================================================================

export class Executor {
  private planner = new PlannerAgent();
  private navigator = new NavigatorAgent();
  private context: AgentContext | null = null;
  private eventListeners: Set<EventListener> = new Set();
  private isRunning = false;
  private shouldCancel = false;

  /**
   * Execute a task from start to finish
   * @param task - Natural language task description
   * @param getDOMState - Function to get current DOM state from content script
   * @param executeAction - Function to execute actions in the browser
   */
  async executeTask(
    task: string,
    getDOMState: GetDOMStateFn,
    executeAction: ExecuteActionFn
  ): Promise<string> {
    if (this.isRunning) {
      throw new Error('Executor is already running a task');
    }

    this.isRunning = true;
    this.shouldCancel = false;

    try {
      // Phase 1: Initialize LLM
      this.emit({ type: 'INIT_START' });

      const unsubscribe = llmEngine.onProgress((progress) => {
        this.emit({ type: 'INIT_PROGRESS', progress });
      });

      try {
        await llmEngine.initialize();
        unsubscribe();
        this.emit({ type: 'INIT_COMPLETE' });
      } catch (error) {
        unsubscribe();
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emit({ type: 'TASK_FAILED', error: `LLM initialization failed: ${errorMsg}` });
        throw error;
      }

      // Phase 2: Initialize context and create plan
      this.context = {
        task,
        history: [],
      };

      this.emit({ type: 'PLAN_START' });

      try {
        this.context.plan = await this.planner.createPlan(task);
        this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
        console.log('[Executor] Plan created:', this.context.plan.plan.steps);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emit({ type: 'TASK_FAILED', error: `Planning failed: ${errorMsg}` });
        throw error;
      }

      // Phase 3: Execution loop
      let replans = 0;
      let consecutiveFailures = 0;

      for (let step = 0; step < MAX_STEPS; step++) {
        if (this.shouldCancel) {
          throw new Error('Task cancelled by user');
        }

        this.emit({ type: 'STEP_START', stepNumber: step + 1 });

        // Get current DOM state
        let domState: DOMState;
        try {
          domState = await getDOMState();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Executor] Failed to get DOM state:', errorMsg);
          // Try to continue with minimal state
          domState = {
            url: 'unknown',
            title: 'Error getting page state',
            interactiveElements: [],
            pageText: '',
          };
        }

        // Get next action from navigator
        let action;
        try {
          action = await this.navigator.getNextAction(this.context, domState);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Executor] Navigator error:', errorMsg);

          // Try replanning
          if (replans < MAX_REPLANS) {
            replans++;
            this.emit({ type: 'REPLAN', reason: `Navigator error: ${errorMsg}` });
            this.navigator.reset();
            this.context.plan = await this.planner.replan(this.context, errorMsg);
            this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
            continue;
          }

          this.emit({ type: 'TASK_FAILED', error: `Navigator error: ${errorMsg}` });
          throw error;
        }

        this.emit({
          type: 'STEP_ACTION',
          action: action.action.action_type,
          params: action.action.parameters,
        });

        console.log(
          `[Executor] Step ${step + 1}: ${action.action.action_type}`,
          action.action.parameters
        );

        // Handle terminal actions
        if (action.action.action_type === 'done') {
          const result = action.action.parameters.result || 'Task completed successfully';
          this.emit({ type: 'TASK_COMPLETE', result });
          return result;
        }

        if (action.action.action_type === 'fail') {
          const reason = action.action.parameters.reason || 'Unknown failure';

          // Try replanning
          if (replans < MAX_REPLANS) {
            replans++;
            this.emit({ type: 'REPLAN', reason });
            this.navigator.reset();
            this.context.plan = await this.planner.replan(this.context, reason);
            this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
            consecutiveFailures = 0;
            continue;
          }

          this.emit({ type: 'TASK_FAILED', error: reason });
          throw new Error(reason);
        }

        // Execute the action
        let result: ActionResult;
        try {
          result = await executeAction(action.action.action_type, action.action.parameters);
        } catch (error) {
          result = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        this.emit({
          type: 'STEP_RESULT',
          success: result.success,
          data: result.data,
        });

        console.log(`[Executor] Action result:`, result);

        // Record in history
        const historyEntry: AgentStep = {
          action: action.action,
          result,
          timestamp: Date.now(),
        };
        this.context.history.push(historyEntry);

        // Handle action failure
        if (!result.success) {
          consecutiveFailures++;

          if (consecutiveFailures >= 3 && replans < MAX_REPLANS) {
            // Multiple consecutive failures, try replanning
            replans++;
            this.emit({ type: 'REPLAN', reason: result.error || 'Multiple consecutive failures' });
            this.navigator.reset();
            this.context.plan = await this.planner.replan(
              this.context,
              result.error || 'Multiple action failures'
            );
            this.emit({ type: 'PLAN_COMPLETE', plan: this.context.plan.plan.steps });
            consecutiveFailures = 0;
          }
          // Otherwise let navigator adapt on its own
        } else {
          consecutiveFailures = 0;
        }
      }

      // Max steps exceeded
      const error = `Maximum steps (${MAX_STEPS}) exceeded without completing task`;
      this.emit({ type: 'TASK_FAILED', error });
      throw new Error(error);
    } finally {
      this.isRunning = false;
      this.reset();
    }
  }

  /**
   * Cancel the currently running task
   */
  cancel(): void {
    this.shouldCancel = true;
  }

  /**
   * Subscribe to executor events
   * Returns unsubscribe function
   */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: ExecutorEvent): void {
    console.log('[Executor] Event:', event.type);
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        console.error('[Executor] Event listener error:', e);
      }
    });
  }

  /**
   * Reset executor state
   */
  reset(): void {
    this.planner.reset();
    this.navigator.reset();
    this.context = null;
  }
}

// Export singleton instance
export const executor = new Executor();
