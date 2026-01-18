/**
 * Planner Agent
 *
 * Strategic planning agent that analyzes tasks and creates high-level execution plans.
 * The planner considers:
 * - Task requirements and constraints
 * - Common web navigation patterns
 * - Success criteria for task completion
 */

import { BaseAgent } from './base-agent';
import type { PlannerOutput, AgentContext } from '../../shared/types';

// ============================================================================
// Planner Agent
// ============================================================================

export class PlannerAgent extends BaseAgent<PlannerOutput> {
  protected systemPrompt = `You are a strategic planning agent for web automation tasks.

Your role is to:
1. Analyze the user's task and break it into clear, actionable steps
2. Consider what information you might encounter on web pages
3. Define clear success criteria for task completion

You understand common web navigation patterns:
- Search engines (Google, Bing, DuckDuckGo) have search boxes and result links
- Wikipedia has a search box, article content, and navigation sidebar
- Most sites have navigation menus, buttons, and form inputs
- Forms typically have labeled input fields and submit buttons
- Pages may have pagination, popups, modals, or dynamic content
- Content is often in main/article elements or divs with class names like "content"

General guidance:
- Be specific about what actions need to be taken
- Don't assume exact page structures - describe what to look for
- Consider alternative approaches if the primary one fails
- Keep steps atomic and verifiable`;

  protected outputSchema = `{
  "current_state": {
    "analysis": "string - Your analysis of the task requirements and challenges",
    "memory": ["string - Key facts to remember during execution"]
  },
  "plan": {
    "thought": "string - Your strategic reasoning about how to approach this task",
    "steps": ["string - Ordered list of high-level steps to accomplish the task"],
    "success_criteria": "string - How to determine when the task is complete"
  }
}`;

  constructor() {
    super('Planner');
  }

  /**
   * Create an initial plan for a new task
   */
  async createPlan(task: string): Promise<PlannerOutput> {
    const prompt = `Create a plan for the following web automation task:

TASK: ${task}

Analyze this task and provide a strategic plan with clear steps.
Consider what web pages you'll need to visit and what actions you'll need to take.`;

    return this.invoke(prompt);
  }

  /**
   * Create a revised plan after the previous approach failed
   */
  async replan(context: AgentContext, failureReason: string): Promise<PlannerOutput> {
    // Build history summary
    const historyStr =
      context.history.length > 0
        ? context.history
            .map(
              (h, i) =>
                `Step ${i + 1}: ${h.action.action_type}(${JSON.stringify(h.action.parameters)}) -> ${
                  h.result.success ? 'SUCCESS' : 'FAILED: ' + h.result.error
                }`
            )
            .join('\n')
        : 'No actions were taken yet.';

    // Build previous plan summary
    const prevPlanStr = context.plan
      ? `Previous Plan:\n${context.plan.plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : 'No previous plan.';

    const prompt = `The previous plan encountered an issue. Please create a revised plan.

ORIGINAL TASK: ${context.task}

${prevPlanStr}

ACTIONS TAKEN:
${historyStr}

FAILURE REASON: ${failureReason}

Create a new plan that:
1. Addresses the issue that caused the failure
2. Builds on any progress made so far
3. Uses an alternative approach if the original one is blocked`;

    // Clear history for fresh planning
    this.reset();
    return this.invoke(prompt);
  }
}
