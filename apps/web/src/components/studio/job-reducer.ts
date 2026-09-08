import type { JobPhaseId } from '@/lib/job-phases';

export type JobStatus = 'idle' | 'queued' | 'processing' | 'finalizing' | 'success' | 'error' | 'cancelled';

export interface JobButtonState {
  status: JobStatus;
  phase: JobPhaseId | null;
  queuePosition: number | null;
  etaSeconds: number | null;
  /** Weighted 0..1, across the whole pipeline. Never regresses; capped at 0.99 until DONE. */
  progress: number;
  outputUrl: string | null;
  error: { code: string; message: string } | null;
  /** Inline "Cancelar job?" confirm is showing, in place of the cancel target. */
  cancelRequested: boolean;
  /** No SSE event in >20s — label switches to "Ainda processando" but nothing else changes. */
  stalled: boolean;
}

export type JobButtonAction =
  | { type: 'START' }
  | { type: 'QUEUED'; position: number }
  | { type: 'PHASE'; phase: JobPhaseId; etaSeconds?: number }
  | { type: 'PROGRESS'; value: number }
  | { type: 'FINALIZE' }
  | { type: 'DONE'; outputUrl: string }
  | { type: 'ERROR'; code: string; message: string }
  | { type: 'STALLED' }
  | { type: 'RESUMED' }
  | { type: 'REQUEST_CANCEL' }
  | { type: 'DISMISS_CANCEL' }
  | { type: 'CONFIRM_CANCEL' }
  | { type: 'RESET' };

export const initialJobButtonState: JobButtonState = {
  status: 'idle',
  phase: null,
  queuePosition: null,
  etaSeconds: null,
  progress: 0,
  outputUrl: null,
  error: null,
  cancelRequested: false,
  stalled: false,
};

/** States from which a job can still be cancelled or can still fail. */
const IN_FLIGHT: JobStatus[] = ['queued', 'processing', 'finalizing'];
/** States from which starting a new job is allowed. */
const STARTABLE: JobStatus[] = ['idle', 'success', 'error', 'cancelled'];

export function jobButtonReducer(state: JobButtonState, action: JobButtonAction): JobButtonState {
  switch (action.type) {
    case 'START':
      if (!STARTABLE.includes(state.status)) return state;
      return { ...initialJobButtonState, status: 'queued' };

    case 'QUEUED':
      if (state.status !== 'queued') return state;
      return { ...state, queuePosition: action.position };

    case 'PHASE':
      if (state.status !== 'queued' && state.status !== 'processing') return state;
      return {
        ...state,
        status: 'processing',
        phase: action.phase,
        etaSeconds: action.etaSeconds ?? null,
        queuePosition: null,
        stalled: false,
      };

    case 'PROGRESS': {
      if (state.status !== 'processing') return state;
      // Never regress, and never show 100% before DONE actually lands.
      const next = Math.min(0.99, Math.max(state.progress, action.value));
      return { ...state, progress: next, stalled: false };
    }

    case 'FINALIZE':
      if (state.status !== 'processing') return state;
      return { ...state, status: 'finalizing', progress: Math.max(state.progress, 0.99), stalled: false };

    case 'DONE':
      if (state.status !== 'processing' && state.status !== 'finalizing') return state;
      return {
        ...state,
        status: 'success',
        progress: 1,
        outputUrl: action.outputUrl,
        cancelRequested: false,
        stalled: false,
      };

    case 'ERROR':
      if (!IN_FLIGHT.includes(state.status)) return state;
      return { ...state, status: 'error', error: { code: action.code, message: action.message }, cancelRequested: false };

    case 'STALLED':
      if (!IN_FLIGHT.includes(state.status)) return state;
      return { ...state, stalled: true };

    case 'RESUMED':
      if (!IN_FLIGHT.includes(state.status)) return state;
      return { ...state, stalled: false };

    case 'REQUEST_CANCEL':
      if (!IN_FLIGHT.includes(state.status)) return state;
      return { ...state, cancelRequested: true };

    case 'DISMISS_CANCEL':
      return { ...state, cancelRequested: false };

    case 'CONFIRM_CANCEL':
      if (!IN_FLIGHT.includes(state.status)) return state;
      return { ...initialJobButtonState, status: 'cancelled' };

    case 'RESET':
      if (state.status !== 'success' && state.status !== 'error' && state.status !== 'cancelled') return state;
      return { ...initialJobButtonState };

    default:
      return state;
  }
}
