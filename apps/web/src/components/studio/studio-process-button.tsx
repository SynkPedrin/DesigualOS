'use client';

import { useEffect, useRef, useState, type Dispatch } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { easeOutQuart, duration as motionDuration } from '@/lib/motion';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { formatEta, phaseLabel } from '@/lib/job-phases';
import { jobButtonReducer, initialJobButtonState, type JobButtonAction, type JobButtonState } from './job-reducer';

export { jobButtonReducer, initialJobButtonState };
export type { JobButtonAction, JobButtonState };

const IDLE_WIDTH = 224;
const MAX_WIDTH = 440;
const CANCEL_DELAY_MS = 800;
const SUCCESS_CTA_DELAY_MS = 1600;
const CANCELLED_RESET_DELAY_MS = 240;

const IN_FLIGHT = new Set(['queued', 'processing', 'finalizing']);

export interface StudioProcessButtonProps {
  state: JobButtonState;
  dispatch: Dispatch<JobButtonAction>;
  /** Kick off the actual job on the backend. Called right after the local START dispatch. */
  onStart: () => void;
  /** Tell the backend to cancel the in-flight job. Called right after the local CONFIRM_CANCEL dispatch. */
  onCancel: () => void;
  onOpenResult: (outputUrl: string) => void;
  className?: string;
}

/**
 * The button that fires a Studio GPU job and becomes its own progress indicator — one element
 * carries the whole journey: fire, wait, track, cancel, finish, fail, retry. State comes from a
 * reducer (job-reducer.ts) so the caller (useJobProgress in production, manual dispatch in the
 * /dev/motion demo) owns the actual event source; this component only renders it.
 */
export function StudioProcessButton({
  state,
  dispatch,
  onStart,
  onCancel,
  onOpenResult,
  className,
}: StudioProcessButtonProps) {
  const prefersReducedMotion = useReducedMotion();
  const [showCancelTarget, setShowCancelTarget] = useState(false);
  const [showResultCta, setShowResultCta] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const jobStartedAtRef = useRef<number | null>(null);

  const { status } = state;
  const isExpanded = status !== 'idle';
  const isBusy = IN_FLIGHT.has(status);

  // Cancel target: fades in 800ms after entering an in-flight state, and stays until the job
  // leaves the in-flight set (success/error/cancelled all hide it immediately).
  useEffect(() => {
    if (!IN_FLIGHT.has(status)) {
      jobStartedAtRef.current = null;
      setShowCancelTarget(false);
      return;
    }
    if (jobStartedAtRef.current === null) jobStartedAtRef.current = Date.now();
    const elapsed = Date.now() - jobStartedAtRef.current;
    const remaining = Math.max(0, CANCEL_DELAY_MS - elapsed);
    const timer = setTimeout(() => setShowCancelTarget(true), remaining);
    return () => clearTimeout(timer);
  }, [status]);

  // Success morphs its label to "Ver resultado" after a beat, without changing width.
  useEffect(() => {
    if (status !== 'success') {
      setShowResultCta(false);
      return;
    }
    const timer = setTimeout(() => setShowResultCta(true), SUCCESS_CTA_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Cancelled is transient: the fill recedes to 0, then the button returns to idle on its own.
  useEffect(() => {
    if (status !== 'cancelled') return;
    const timer = setTimeout(() => dispatch({ type: 'RESET' }), CANCELLED_RESET_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, dispatch]);

  // Screen readers get phase changes, never the percentage — reading a number out loud on
  // every tick is exactly the verbosity a progressbar's aria-valuetext already covers silently.
  useEffect(() => {
    if (state.phase) setAnnouncement(phaseLabel(state.phase));
  }, [state.phase]);

  function handleMainClick() {
    if (status === 'idle' || status === 'error') {
      dispatch({ type: 'START' });
      onStart();
      return;
    }
    if (status === 'success' && state.outputUrl) {
      onOpenResult(state.outputUrl);
    }
    // queued / processing / finalizing / cancelled: no-op, the button is busy tracking the job.
  }

  const fillFraction = status === 'success' ? 1 : status === 'idle' || status === 'cancelled' ? 0 : state.progress;
  const displayFraction = prefersReducedMotion ? Math.round(fillFraction * 20) / 20 : fillFraction;
  const percent = Math.round(state.progress * 100);

  const fillTone =
    status === 'success'
      ? 'bg-sucesso/[0.14]'
      : status === 'error'
        ? 'bg-erro/[0.12]'
        : 'bg-gradient-to-r from-ametista via-roxo-eletrico to-magenta-spark';

  return (
    <div className={cn('relative inline-block w-full', className)} style={{ maxWidth: MAX_WIDTH }}>
      <motion.button
        type="button"
        onClick={handleMainClick}
        aria-busy={isBusy}
        initial={false}
        animate={{ width: isExpanded ? '100%' : IDLE_WIDTH }}
        transition={{ duration: prefersReducedMotion ? 0 : motionDuration.morph, ease: easeOutQuart }}
        style={{ minWidth: isExpanded ? undefined : IDLE_WIDTH }}
        whileHover={status === 'idle' ? { scale: 1.03 } : {}}
        whileTap={status === 'idle' || status === 'error' ? { scale: 0.985 } : {}}
        className={cn(
          'relative flex h-14 items-center overflow-hidden rounded-md border font-heading text-base font-semibold',
          'outline-none transition-shadow duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violeta-sutil',
          status === 'idle' && 'border-transparent bg-roxo-eletrico text-branco-cru hover:shadow-glow',
          status !== 'idle' && 'border-ametista bg-grafite text-branco-cru',
          status === 'error' && 'border-erro/50',
          status === 'success' && 'border-sucesso/50',
        )}
      >
        {/* Progress fill — transform only (scaleX), never width, so it never forces layout. */}
        {status !== 'idle' && (
          <motion.div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status === 'queued' ? undefined : percent}
            aria-valuetext={state.phase ? phaseLabel(state.phase) : status === 'queued' ? 'Na fila' : undefined}
            className={cn('absolute inset-y-0 left-0 w-full origin-left', fillTone)}
            initial={false}
            animate={{ scaleX: displayFraction }}
            transition={
              prefersReducedMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }
            }
          />
        )}

        {/* Queued / finalizing shimmer — a soft band sweeping left to right, transform only. */}
        {!prefersReducedMotion && (status === 'queued' || status === 'finalizing') && (
          <motion.div
            aria-hidden
            className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-branco-cru/[0.12] to-transparent"
            animate={{ x: ['-6rem', '28rem'] }}
            transition={{ duration: 1.6, ease: 'linear', repeat: Infinity }}
          />
        )}

        <div className="relative z-10 flex w-full items-center justify-between gap-3 px-5">
          <AnimatePresence mode="wait" initial={false}>
            {status === 'idle' && (
              <motion.span
                key="idle"
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.8 }}
                transition={{ duration: prefersReducedMotion ? 0.12 : 0.2 }}
                className="flex items-center gap-3"
              >
                <Sparkles size={18} aria-hidden />
                <span>Processar no Studio</span>
              </motion.span>
            )}

            {(status === 'queued' || status === 'processing' || status === 'finalizing') && (
              <motion.span
                key="busy"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionDuration.exit }}
                className="flex w-full items-center justify-between gap-3 font-body text-sm font-normal"
              >
                <span className="truncate">
                  {status === 'queued'
                    ? state.queuePosition
                      ? `Na fila — posição ${state.queuePosition}`
                      : 'Na fila'
                    : status === 'finalizing'
                      ? 'Finalizando'
                      : state.stalled
                        ? 'Ainda processando'
                        : phaseLabel(state.phase)}
                  {state.etaSeconds && state.etaSeconds > 10 && (
                    <span className="ml-2 text-nevoa">{formatEta(state.etaSeconds)}</span>
                  )}
                </span>
                {status !== 'queued' && (
                  <span className="shrink-0 font-mono text-sm tabular-nums">{percent}%</span>
                )}
              </motion.span>
            )}

            {status === 'success' && (
              <motion.span
                key="success"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionDuration.exit }}
                className="flex w-full items-center gap-3"
              >
                <CheckDraw reduced={prefersReducedMotion} />
                <span>{showResultCta ? 'Ver resultado' : 'Pronto'}</span>
              </motion.span>
            )}

            {status === 'error' && (
              <motion.span
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionDuration.exit }}
                className="flex w-full items-center justify-between gap-3 font-body text-sm font-normal"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-erro" aria-hidden />
                  <span className="truncate">{state.error?.message ?? 'Falhou'}</span>
                  {state.error?.code && (
                    <span className="shrink-0 font-mono text-xs text-nevoa">{state.error.code}</span>
                  )}
                </span>
                <span className="shrink-0 font-heading text-sm font-semibold underline-offset-4 hover:underline">
                  Tentar novamente
                </span>
              </motion.span>
            )}

            {status === 'cancelled' && (
              <motion.span
                key="cancelled"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionDuration.exit }}
                className="text-nevoa"
              >
                Cancelado
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Cancel target / inline confirm. A span, not a button, because a real <button> can't
         * nest inside another — stopPropagation keeps clicks here from also firing handleMainClick. */}
        <AnimatePresence>
          {showCancelTarget && !state.cancelRequested && (
            <motion.span
              role="button"
              tabIndex={0}
              aria-label="Cancelar job"
              key="cancel-target"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
              onClick={(event) => {
                event.stopPropagation();
                dispatch({ type: 'REQUEST_CANCEL' });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  dispatch({ type: 'REQUEST_CANCEL' });
                }
              }}
              className="absolute inset-y-0 right-0 z-20 flex w-10 cursor-pointer items-center justify-center text-nevoa outline-none hover:text-branco-cru focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violeta-sutil"
            >
              <X size={16} aria-hidden />
            </motion.span>
          )}

          {state.cancelRequested && (
            <motion.span
              key="cancel-confirm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
              className="absolute inset-y-0 right-3 z-20 flex items-center gap-2 font-body text-xs"
            >
              <span className="text-nevoa">Cancelar job?</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatch({ type: 'CONFIRM_CANCEL' });
                  onCancel();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    dispatch({ type: 'CONFIRM_CANCEL' });
                    onCancel();
                  }
                }}
                className="cursor-pointer font-semibold text-erro outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violeta-sutil"
              >
                Sim
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatch({ type: 'DISMISS_CANCEL' });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    dispatch({ type: 'DISMISS_CANCEL' });
                  }
                }}
                className="cursor-pointer text-branco-cru outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violeta-sutil"
              >
                Não
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function CheckDraw({ reduced }: { reduced: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="shrink-0 text-sucesso">
      <motion.path
        d="M4 9.5l3.2 3.2L14 5.8"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: reduced ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0 : 0.28, ease: 'easeOut' }}
      />
    </svg>
  );
}
