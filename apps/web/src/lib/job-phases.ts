export type JobPhaseId = 'prompt' | 'render' | 'upscale' | 'encode' | 'publish';

export interface JobPhaseDef {
  id: JobPhaseId;
  label: string;
  /** Share of total weighted progress this phase represents; weights sum to 1. */
  weight: number;
}

/**
 * A GPU job reports progress per-phase (0..1 within that phase). The button shows a single
 * weighted percentage across the whole pipeline, not the isolated phase progress — otherwise
 * the bar would jump from ~60% to ~5% the moment "upscale" starts.
 */
export const PHASES: readonly JobPhaseDef[] = [
  { id: 'prompt', label: 'Interpretando o pedido', weight: 0.05 },
  { id: 'render', label: 'Gerando', weight: 0.62 },
  { id: 'upscale', label: 'Ampliando resolução', weight: 0.18 },
  { id: 'encode', label: 'Codificando', weight: 0.1 },
  { id: 'publish', label: 'Publicando', weight: 0.05 },
] as const;

const PHASE_INDEX = new Map(PHASES.map((phase, index) => [phase.id, index]));

export function phaseLabel(phase: JobPhaseId | null): string {
  if (!phase) return '';
  return PHASES.find((p) => p.id === phase)?.label ?? phase;
}

/**
 * Weighted 0..1 progress for `phase` at `withinPhase` (0..1) completion: the sum of every
 * prior phase's full weight, plus this phase's own partial share.
 */
export function weightedProgress(phase: JobPhaseId, withinPhase: number): number {
  const index = PHASE_INDEX.get(phase) ?? 0;
  const completed = PHASES.slice(0, index).reduce((sum, p) => sum + p.weight, 0);
  const current = PHASES[index]?.weight ?? 0;
  const clamped = Math.min(1, Math.max(0, withinPhase));
  return Math.min(1, completed + current * clamped);
}

/** `~2 min` / `~40 s` — only called when the API actually sent an etaSeconds > 10. */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.round(seconds)} s`;
  return `~${Math.round(seconds / 60)} min`;
}
