/**
 * Navigator Agent
 *
 * Tactical execution agent that examines page state and generates concrete browser actions.
 * The navigator:
 * - Analyzes the current DOM state
 * - Chooses the best next action
 * - Uses element selectors from the DOM observer
 */

import { BaseAgent } from './base-agent';
import type { NavigatorOutput, DOMState, AgentContext } from '../../shared/types';
import { MAX_INTERACTIVE_ELEMENTS } from '../../shared/constants';

// ============================================================================
// Navigator Agent
// ============================================================================

export class NavigatorAgent extends BaseAgent<NavigatorOutput> {
  protected systemPrompt = `You are a tactical web navigation agent that executes browser actions.

Your role is to:
1. Analyze the current page state and identify relevant elements
2. Choose the next best action to progress toward the goal
3. Use the element selectors provided in the DOM state

AVAILABLE ACTIONS:
- navigate: Go to a URL
  Parameters: {"url": "https://example.com"}

- click: Click an element
  Parameters: {"selector": "#submit-btn"} or {"selector": "button.search-btn"}

- type: Type text into an input field
  Parameters: {"selector": "input[name='q']", "text": "search query"}

- extract: Extract text content from an element
  Parameters: {"selector": ".result-text"} or {"selector": "body"} for full page

- scroll: Scroll the page
  Parameters: {"direction": "down", "amount": "500"} (amount in pixels)

- wait: Wait for an element to appear or a delay
  Parameters: {"selector": ".loading"} or {"timeout": "2000"} (timeout in ms)

- done: Task is complete
  Parameters: {"result": "The extracted information or confirmation of completion"}

- fail: Cannot continue with task
  Parameters: {"reason": "Explanation of why the task cannot be completed"}

GUIDELINES:
- Use the element index numbers [N] from the DOM state to identify elements
- Prefer using specific selectors (id, name) over generic ones
- If an element has an id attribute, use it (e.g., "#element-id")
- For forms, look for submit buttons or press enter after typing
- If you can't find an expected element, try scrolling or waiting
- When extracting content, target specific containers, not the whole body
- Call "done" with the result when you have achieved the task goal
- Call "fail" only when you're certain the task cannot be completed`;

  protected outputSchema = `{
  "current_state": {
    "page_summary": "string - Brief description of what's on the current page",
    "relevant_elements": ["string - List of elements relevant to the current goal"],
    "progress": "string - How far along you are toward completing the task"
  },
  "action": {
    "thought": "string - Your reasoning for choosing this action",
    "action_type": "navigate | click | type | extract | scroll | wait | done | fail",
    "parameters": {
      "key": "value - The parameters for the action (depends on action_type)"
    }
  }
}`;

  constructor() {
    super('Navigator');
  }

  /**
   * Get the next action to take based on current DOM state
   */
  async getNextAction(context: AgentContext, domState: DOMState): Promise<NavigatorOutput> {
    // Format the plan if available
    const planStr = context.plan
      ? `CURRENT PLAN:
${context.plan.plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Success Criteria: ${context.plan.plan.success_criteria}`
      : 'No plan available - proceed based on the task.';

    // Format recent action history (last 5 for context without overwhelming)
    const historyStr =
      context.history.length > 0
        ? `RECENT ACTIONS:
${context.history
  .slice(-5)
  .map(
    (h) =>
      `- ${h.action.action_type}(${JSON.stringify(h.action.parameters)}) -> ${
        h.result.success ? 'OK' + (h.result.data ? ': ' + h.result.data.slice(0, 100) : '') : 'FAILED: ' + h.result.error
      }`
  )
  .join('\n')}`
        : 'No actions taken yet.';

    // Format interactive elements (limit to prevent token overflow)
    const elementsStr = domState.interactiveElements
      .slice(0, MAX_INTERACTIVE_ELEMENTS)
      .map((el) => {
        const attrs = Object.entries(el.attributes)
          .map(([k, v]) => `${k}="${v.slice(0, 30)}"`)
          .join(' ');
        return `[${el.index}] <${el.tag}${el.type ? ` type="${el.type}"` : ''}${attrs ? ' ' + attrs : ''}> "${el.text.slice(0, 50)}" -> selector: ${el.selector}`;
      })
      .join('\n');

    const prompt = `TASK: ${context.task}

${planStr}

${historyStr}

CURRENT PAGE STATE:
URL: ${domState.url}
Title: ${domState.title}

INTERACTIVE ELEMENTS (use these selectors):
${elementsStr || 'No interactive elements found on this page.'}

PAGE TEXT (excerpt):
${domState.pageText.slice(0, 1500)}${domState.pageText.length > 1500 ? '...' : ''}

Based on the current state, determine the next action to take to progress toward the goal.
If you have achieved the goal, use the "done" action with the result.`;

    return this.invoke(prompt);
  }
}
