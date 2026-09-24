/**
 * Vocabulário do Motion Engine. Tudo que atravessa a fronteira do módulo
 * (worker, API, chat) passa por aqui.
 */

/** §27 — estágios reais do job. A UI mostra um recorte simplificado (ver UI_STAGE). */
export const MOTION_STATUSES = [
  'queued',
  'resolving_context',
  'preparing_assets',
  'planning',
  'coding',
  'building',
  'rendering_preview',
  'reviewing',
  'fixing',
  'rendering_final',
  'completed',
  'failed',
  'cancelled',
] as const;

export type MotionStatus = (typeof MOTION_STATUSES)[number];

export const TERMINAL_MOTION_STATUSES: ReadonlySet<MotionStatus> = new Set<MotionStatus>([
  'completed',
  'failed',
  'cancelled',
]);

/**
 * §39 — o que a pessoa lê. `spawn`, `cwd`, `webpack` e PID de worker ficam no
 * log; no chat aparece trabalho de motion designer.
 */
export const UI_STAGE: Record<MotionStatus, string> = {
  queued: 'Na fila',
  resolving_context: 'Lendo a marca',
  preparing_assets: 'Separando os materiais',
  planning: 'Montando o storyboard',
  coding: 'Criando o motion',
  building: 'Montando a composição',
  rendering_preview: 'Renderizando preview',
  reviewing: 'Revisando quadro a quadro',
  fixing: 'Ajustando o que ficou fora do lugar',
  rendering_final: 'Finalizando',
  completed: 'Pronto',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

/** §34 — presets de formato. Chave semântica, não resolução crua. */
export const MOTION_FORMATS = {
  '9:16': { width: 1080, height: 1920, label: 'Stories / Reels' },
  '4:5': { width: 1080, height: 1350, label: 'Feed vertical' },
  '1:1': { width: 1080, height: 1080, label: 'Feed quadrado' },
  '16:9': { width: 1920, height: 1080, label: 'YouTube / horizontal' },
} as const;

export type MotionFormat = keyof typeof MOTION_FORMATS;

export const DEFAULT_MOTION_FORMAT: MotionFormat = '9:16';

/** §35 — presets existem, mas duração arbitrária é suportada. */
export const DURATION_PRESETS = [5, 6, 10, 15, 20, 30] as const;
export const DEFAULT_DURATION_SECONDS = 15;
export const MIN_DURATION_SECONDS = 2;
export const MAX_DURATION_SECONDS = 120;

/** §36 */
export const ALLOWED_FPS = [24, 30, 60] as const;
export type MotionFps = (typeof ALLOWED_FPS)[number];
export const DEFAULT_FPS: MotionFps = 30;

export type MotionQuality = 'preview' | 'final';

/** §23 — preview é barato de propósito: altura 720 e CRF frouxo. */
export const QUALITY_PRESETS = {
  preview: { scale: 720 / 1920, crf: 28, label: 'preview' },
  final: { scale: 1, crf: 18, label: 'final' },
} as const;

export interface MotionSession {
  id: string;
  clientId: string;
  conversationId: string | null;
  projectId: string | null;
  requestedBy: string | null;
  workspacePath: string;
  status: MotionStatus;
  stageDetail: string | null;
  prompt: string;
  durationSeconds: number;
  fps: MotionFps;
  width: number;
  height: number;
  format: MotionFormat;
  /** Sempre o id do Opus 5.5 — gravado pra auditoria provar que não houve troca. */
  model: string;
  renderVersion: number;
  error: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MotionRender {
  id: string;
  motionSessionId: string;
  version: number;
  quality: MotionQuality;
  storageUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  sizeBytes: number | null;
  renderTimeMs: number | null;
  /** §44 — checklist interno, não número de marketing. */
  qualityScore: MotionQualityScore | null;
  createdAt: Date;
}

/**
 * §44 — heurística/checklist, jamais "precisão falsa de IA".
 *
 * `technical` é o único medido programaticamente (arquivo existe, duração
 * bate, fps bate, resolução bate, não há frame preto, asset faltando ou erro
 * de runtime). Os outros quatro são o veredito do revisor visual sobre
 * critérios explícitos, e servem só pra decidir se vale mais uma passada.
 */
export interface MotionQualityScore {
  technical: number;
  visual: number;
  brand: number;
  legibility: number;
  composition: number;
}

export const TECHNICAL_SCORE_FLOOR = 95;

/** §14 — a superfície que o Otto enxerga. Ele não sabe o que é Remotion. */
export interface CreateMotionInput {
  clientId: string;
  conversationId: string | null;
  projectId: string | null;
  requestedBy: string | null;
  executionId: string | null;
  prompt: string;
  durationSeconds?: number;
  format?: MotionFormat;
  fps?: MotionFps;
  /** URLs de referência que a pessoa anexou no turno (§33). */
  references?: MotionReference[];
}

export interface MotionReference {
  url: string;
  filename: string;
  contentType: string;
}

export interface UpdateMotionInput {
  motionId: string;
  instruction: string;
  requestedBy: string | null;
  executionId: string | null;
  references?: MotionReference[];
}

export interface MotionStatusView {
  motionId: string;
  status: MotionStatus;
  /** Texto de UI (§39). */
  stage: string;
  stageDetail: string | null;
  format: MotionFormat;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  renderVersion: number;
  previewUrl: string | null;
  finalUrl: string | null;
  error: string | null;
  errorCode: string | null;
  updatedAt: string;
}
