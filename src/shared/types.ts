// ============================================================================
// Agent Output Types
// ============================================================================

/**
 * Output schema for PlannerAgent
 * The planner analyzes tasks and creates high-level strategies
 */
export interface PlannerOutput {
  current_state: {
    analysis: string;      // Analysis of the task requirements
    memory: string[];      // Key facts to remember during execution
  };
  plan: {
    thought: string;       // Strategic reasoning
    steps: string[];       // High-level steps to accomplish task
    success_criteria: string; // How to determine task completion
  };
}

/**
 * Output schema for NavigatorAgent
 * The navigator examines page state and generates concrete actions
 */
export interface NavigatorOutput {
  current_state: {
    page_summary: string;      // What's on the current page
    relevant_elements: string[]; // Important interactive elements found
    progress: string;          // Progress toward the goal
  };
  action: {
    thought: string;           // Tactical reasoning for this action
    action_type: ActionType;
    parameters: Record<string, string>;
  };
}

// ============================================================================
// Browser Action Types
// ============================================================================

/**
 * Supported browser actions
 */
export type ActionType =
  | 'navigate'   // Go to URL
  | 'click'      // Click element by selector
  | 'type'       // Type text into input
  | 'extract'    // Extract text content
  | 'scroll'     // Scroll page
  | 'wait'       // Wait for element/time
  | 'done'       // Task complete
  | 'fail';      // Task failed

/**
 * Result of executing a browser action
 */
export interface ActionResult {
  success: boolean;
  data?: string;
  error?: string;
}

// ============================================================================
// DOM State Types
// ============================================================================

/**
 * Serialized DOM state passed to Navigator agent
 */
export interface DOMState {
  url: string;
  title: string;
  interactiveElements: InteractiveElement[];
  pageText: string; // Truncated visible text content
}

/**
 * An interactive element on the page
 */
export interface InteractiveElement {
  index: number;
  tag: string;
  type?: string;
  text: string;
  selector: string;
  attributes: Record<string, string>;
}

// ============================================================================
// Agent Context Types
// ============================================================================

/**
 * Context maintained during task execution
 */
export interface AgentContext {
  task: string;
  plan?: PlannerOutput;
  history: AgentStep[];
}

/**
 * A single step in the execution history
 */
export interface AgentStep {
  action: NavigatorOutput['action'];
  result: ActionResult;
  timestamp: number;
}

// ============================================================================
// Message Types (for Chrome runtime messaging)
// ============================================================================

export interface StartTaskMessage {
  type: 'START_TASK';
  payload: { task: string };
}

export interface CancelTaskMessage {
  type: 'CANCEL_TASK';
}

export interface GetDOMStateMessage {
  type: 'GET_DOM_STATE';
}

export interface ExecuteActionMessage {
  type: 'EXECUTE_ACTION';
  payload: {
    actionType: ActionType;
    params: Record<string, string>;
  };
}

export type BackgroundMessage =
  | StartTaskMessage
  | CancelTaskMessage;

export type ContentMessage =
  | GetDOMStateMessage
  | ExecuteActionMessage;

// ============================================================================
// Executor Event Types (for UI updates)
// ============================================================================

export type ExecutorEvent =
  | { type: 'INIT_START' }
  | { type: 'INIT_PROGRESS'; progress: number }
  | { type: 'INIT_COMPLETE' }
  | { type: 'PLAN_START' }
  | { type: 'PLAN_COMPLETE'; plan: string[] }
  | { type: 'STEP_START'; stepNumber: number }
  | { type: 'STEP_ACTION'; action: string; params: Record<string, string> }
  | { type: 'STEP_RESULT'; success: boolean; data?: string }
  | { type: 'TASK_COMPLETE'; result: string }
  | { type: 'TASK_FAILED'; error: string }
  | { type: 'REPLAN'; reason: string };
