'use client';

import { useReducer, useRef } from 'react';
import {
  StudioProcessButton,
  jobButtonReducer,
  initialJobButtonState,
} from '@/components/studio/studio-process-button';
import { PHASES } from '@/lib/job-phases';

/**
 * Isolated review ground for the four motion systems. StudioProcessButton lands here first
 * (see the DESIGUAL_OS motion spec, §9) with manual controls that force every JobStatus
 * without touching the real Studio GPU pipeline. AgentDock / OutputCarousel / AuthScene join
 * this page as their own sections once each is built.
 */
export default function MotionDevPage() {
  const [state, dispatch] = useReducer(jobButtonReducer, initialJobButtonState);
  const simulationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearSimulation() {
    if (simulationTimer.current) {
      clearTimeout(simulationTimer.current);
      simulationTimer.current = null;
    }
  }

  function runFullSimulation() {
    clearSimulation();
    dispatch({ type: 'START' });

    let elapsed = 300;
    simulationTimer.current = setTimeout(() => dispatch({ type: 'QUEUED', position: 3 }), elapsed);

    elapsed += 900;
    setTimeout(() => dispatch({ type: 'QUEUED', position: 1 }), elapsed);

    PHASES.forEach((phase, index) => {
      elapsed += 700;
      setTimeout(() => dispatch({ type: 'PHASE', phase: phase.id, etaSeconds: 90 - index * 20 }), elapsed);

      const steps = 4;
      for (let step = 1; step <= steps; step += 1) {
        elapsed += 260;
        const within = step / steps;
        const weightedBefore = PHASES.slice(0, index).reduce((sum, p) => sum + p.weight, 0);
        const value = Math.min(0.99, weightedBefore + phase.weight * within);
        setTimeout(() => dispatch({ type: 'PROGRESS', value }), elapsed);
      }
    });

    elapsed += 500;
    setTimeout(() => dispatch({ type: 'FINALIZE' }), elapsed);

    elapsed += 900;
    simulationTimer.current = setTimeout(
      () => dispatch({ type: 'DONE', outputUrl: 'https://example.internal/studio/outputs/mock.mp4' }),
      elapsed,
    );
  }

  function runStalledThenError() {
    clearSimulation();
    dispatch({ type: 'START' });
    setTimeout(() => dispatch({ type: 'PHASE', phase: 'render', etaSeconds: 45 }), 200);
    setTimeout(() => dispatch({ type: 'PROGRESS', value: 0.3 }), 500);
    setTimeout(() => dispatch({ type: 'STALLED' }), 1200);
    setTimeout(
      () => dispatch({ type: 'ERROR', code: 'GPU_OOM', message: 'A GPU ficou sem memória durante o render.' }),
      2400,
    );
  }

  return (
    <div className="min-h-screen bg-carbono p-10 text-branco-cru">
      <div className="mx-auto max-w-3xl space-y-10">
        <header>
          <h1 className="font-display text-3xl uppercase tracking-tight">Motion Dev</h1>
          <p className="mt-1 font-body text-sm text-nevoa">
            Componentes de motion isolados para revisão visual, fora da rota autenticada.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="font-heading text-lg font-semibold">StudioProcessButton</h2>

          <div className="flex items-center justify-center rounded-lg border border-grafite-elevado bg-grafite p-10">
            <StudioProcessButton
              state={state}
              dispatch={dispatch}
              onStart={() => {
                /* demo: onStart normally kicks off the real job + SSE stream */
              }}
              onCancel={() => {
                clearSimulation();
              }}
              onOpenResult={(url) => window.alert(`Abriria o resultado: ${url}`)}
            />
          </div>

          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <DevButton onClick={runFullSimulation}>Simular job completo</DevButton>
            <DevButton onClick={runStalledThenError}>Simular travamento → erro</DevButton>
            <DevButton
              onClick={() => {
                clearSimulation();
                dispatch({ type: 'START' });
              }}
            >
              Forçar: queued
            </DevButton>
            <DevButton
              onClick={() => {
                clearSimulation();
                dispatch({ type: 'START' });
                dispatch({ type: 'PHASE', phase: 'render', etaSeconds: 120 });
                dispatch({ type: 'PROGRESS', value: 0.35 });
              }}
            >
              Forçar: processing
            </DevButton>
            <DevButton
              onClick={() => {
                clearSimulation();
                dispatch({ type: 'START' });
                dispatch({ type: 'PHASE', phase: 'publish' });
                dispatch({ type: 'PROGRESS', value: 0.99 });
                dispatch({ type: 'FINALIZE' });
              }}
            >
              Forçar: finalizing
            </DevButton>
            <DevButton
              onClick={() => {
                clearSimulation();
                dispatch({ type: 'START' });
                dispatch({ type: 'PHASE', phase: 'publish' });
                dispatch({ type: 'DONE', outputUrl: 'https://example.internal/studio/outputs/mock.mp4' });
              }}
            >
              Forçar: success
            </DevButton>
            <DevButton
              onClick={() => {
                clearSimulation();
                dispatch({ type: 'START' });
                dispatch({ type: 'PHASE', phase: 'render' });
                dispatch({ type: 'ERROR', code: 'GPU_OOM', message: 'A GPU ficou sem memória durante o render.' });
              }}
            >
              Forçar: error
            </DevButton>
            <DevButton
              onClick={() => {
                clearSimulation();
                dispatch({ type: 'RESET' });
              }}
            >
              Reset
            </DevButton>
          </div>

          <pre className="overflow-auto rounded-md bg-grafite-elevado p-3 font-mono text-[11px] text-nevoa">
            {JSON.stringify(state, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}

function DevButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm border border-grafite-elevado bg-grafite px-3 py-1.5 text-nevoa transition-colors hover:border-roxo-eletrico hover:text-branco-cru"
    >
      {children}
    </button>
  );
}
