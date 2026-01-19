/**
 * Task Input Component
 *
 * Allows users to enter natural language tasks for the AI agent to execute.
 */

import React, { useState, useCallback } from 'react';

interface TaskInputProps {
  onSubmit: (task: string, visionMode: boolean) => void;
  visionModeSupported?: boolean;
}

const EXAMPLE_TASKS = [
  'Go to Wikipedia and search for "WebGPU"',
  'Search Google for "latest AI news"',
  'Go to example.com and tell me what\'s there',
];

export function TaskInput({ onSubmit, visionModeSupported = true }: TaskInputProps): React.ReactElement {
  const [task, setTask] = useState('');
  const [visionMode, setVisionMode] = useState(false);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (task.trim()) {
        onSubmit(task.trim(), visionMode);
      }
    },
    [task, visionMode, onSubmit]
  );

  const handleExampleClick = useCallback((example: string) => {
    setTask(example);
  }, []);

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Describe what you want to automate...&#10;&#10;Example: Search for 'WebGPU' on Wikipedia and extract the first paragraph"
        autoFocus
      />

      {visionModeSupported && (
        <div className="vision-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={visionMode}
              onChange={(e) => setVisionMode(e.target.checked)}
            />
            <span className="toggle-text">
              Vision Mode (use screenshots)
            </span>
          </label>
          {visionMode && (
            <div className="vision-hint">
              Uses VLM to analyze page screenshots instead of DOM parsing.
              More accurate but slower.
            </div>
          )}
        </div>
      )}

      <button type="submit" disabled={!task.trim()}>
        Run Task
      </button>

      <div className="examples">
        <div className="examples-label">Try an example:</div>
        <div className="examples-list">
          {EXAMPLE_TASKS.map((example, index) => (
            <button
              key={index}
              type="button"
              className="example-chip"
              onClick={() => handleExampleClick(example)}
            >
              {example.slice(0, 30)}...
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
