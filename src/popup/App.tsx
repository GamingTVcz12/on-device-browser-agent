/**
 * Main Application Component
 *
 * Manages the popup UI state and communication with the background service worker.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { TaskInput } from './components/TaskInput';
import { ProgressDisplay } from './components/ProgressDisplay';
import { ModelStatus } from './components/ModelStatus';
import { ResultView } from './components/ResultView';
import { POPUP_PORT_NAME } from '../shared/constants';
import type { ExecutorEvent } from '../shared/types';

// ============================================================================
// Types
// ============================================================================

export interface Step {
  number: number;
  action: string;
  params: Record<string, string>;
  status: 'pending' | 'running' | 'success' | 'failed';
  result?: string;
  error?: string;
}

type AppState = 'idle' | 'loading' | 'planning' | 'executing' | 'complete' | 'error';

// ============================================================================
// App Component
// ============================================================================

export function App(): React.ReactElement {
  // Application state
  const [state, setState] = useState<AppState>('idle');
  const [modelProgress, setModelProgress] = useState(0);
  const [plan, setPlan] = useState<string[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);

  // Connect to background service worker
  useEffect(() => {
    const newPort = chrome.runtime.connect({ name: POPUP_PORT_NAME });
    setPort(newPort);

    newPort.onMessage.addListener((message) => {
      console.log('[Popup] Received message:', message);

      if (message.type === 'EXECUTOR_EVENT') {
        handleExecutorEvent(message.event as ExecutorEvent);
      } else if (message.type === 'TASK_RESULT') {
        setResult(message.result);
        setState('complete');
      } else if (message.type === 'ERROR') {
        setError(message.error);
        setState('error');
      }
    });

    newPort.onDisconnect.addListener(() => {
      console.log('[Popup] Port disconnected');
      setPort(null);
    });

    return () => {
      newPort.disconnect();
    };
  }, []);

  // Handle executor events
  const handleExecutorEvent = useCallback((event: ExecutorEvent) => {
    console.log('[Popup] Executor event:', event.type);

    switch (event.type) {
      case 'INIT_START':
        setState('loading');
        setModelProgress(0);
        break;

      case 'INIT_PROGRESS':
        setModelProgress(event.progress);
        break;

      case 'INIT_COMPLETE':
        setModelProgress(1);
        break;

      case 'PLAN_START':
        setState('planning');
        break;

      case 'PLAN_COMPLETE':
        setPlan(event.plan);
        setState('executing');
        break;

      case 'STEP_START':
        setSteps((prev) => [
          ...prev,
          {
            number: event.stepNumber,
            action: '...',
            params: {},
            status: 'running',
          },
        ]);
        break;

      case 'STEP_ACTION':
        setSteps((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last) {
            last.action = event.action;
            last.params = event.params;
          }
          return updated;
        });
        break;

      case 'STEP_RESULT':
        setSteps((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last) {
            last.status = event.success ? 'success' : 'failed';
            if (event.success && event.data) {
              last.result = event.data.slice(0, 200);
            } else if (!event.success) {
              last.error = event.data;
            }
          }
          return updated;
        });
        break;

      case 'REPLAN':
        // Clear plan and steps for replanning
        setPlan([]);
        setSteps([]);
        setState('planning');
        break;

      case 'TASK_COMPLETE':
        setResult(event.result);
        setState('complete');
        break;

      case 'TASK_FAILED':
        setError(event.error);
        setState('error');
        break;
    }
  }, []);

  // Submit a new task
  const handleSubmitTask = useCallback(
    (task: string) => {
      if (!port) {
        setError('Not connected to background service');
        setState('error');
        return;
      }

      // Reset state
      setState('loading');
      setModelProgress(0);
      setPlan([]);
      setSteps([]);
      setResult(null);
      setError(null);

      // Send task to background
      port.postMessage({ type: 'START_TASK', payload: { task } });
    },
    [port]
  );

  // Reset to initial state
  const handleReset = useCallback(() => {
    setState('idle');
    setModelProgress(0);
    setPlan([]);
    setSteps([]);
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Local Browser</h1>
        <p>AI Web Automation (On-Device)</p>
      </header>

      <main className="main">
        {state === 'idle' && <TaskInput onSubmit={handleSubmitTask} />}

        {state === 'loading' && <ModelStatus progress={modelProgress} />}

        {(state === 'planning' || state === 'executing') && (
          <ProgressDisplay state={state} plan={plan} steps={steps} />
        )}

        {state === 'complete' && result && (
          <ResultView result={result} onReset={handleReset} />
        )}

        {state === 'error' && error && (
          <div className="error-view">
            <h2>Error</h2>
            <div className="error-content">{error}</div>
            <button onClick={handleReset}>Try Again</button>
          </div>
        )}
      </main>
    </div>
  );
}
