/**
 * OTTO MOTION ENGINE — fronteira pública do módulo.
 *
 * Nada fora de `packages/otto-motion` deve importar de um caminho interno:
 * o que atravessa a fronteira está listado aqui, e é isso que mantém o
 * isolamento do §1 verificável em vez de combinado.
 */
export { ottoMotionEnabled } from './flag.js';
export {
  MotionError,
  MotionModelUnavailableError,
  isMotionError,
  userMessageFor,
  type MotionErrorAction,
  type MotionErrorCode,
} from './errors.js';
export { MOTION_MODEL_ID, MIN_CLAUDE_CODE_VERSION } from './model.js';
export {
  MOTION_FORMATS,
  MOTION_STATUSES,
  UI_STAGE,
  DURATION_PRESETS,
  ALLOWED_FPS,
  DEFAULT_FPS,
  DEFAULT_MOTION_FORMAT,
  DEFAULT_DURATION_SECONDS,
  TERMINAL_MOTION_STATUSES,
  type CreateMotionInput,
  type MotionFormat,
  type MotionFps,
  type MotionQualityScore,
  type MotionReference,
  type MotionSession,
  type MotionStatus,
  type MotionStatusView,
  type UpdateMotionInput,
} from './types.js';
export { detectMotionIntent, type MotionIntent, type MotionIntentContext } from './intent/detect.js';
export {
  createMotion,
  updateMotion,
  renderMotionAgain,
  getMotionStatus,
  findConversationMotion,
} from './service.js';
export { getMotionQueue, startMotionWorker, MOTION_QUEUE_NAME, type MotionJobData } from './queue.js';
export {
  checkClaudeConnection,
  checkChatGptConnection,
  probeOpusModel,
  PROVIDER_STATES,
  type ProviderConnection,
  type ProviderState,
} from './providers/connection.js';
export { resolveClientContext } from './client-context/resolver.js';
/**
 * Superfície para scripts de prova e para quem precisa rodar o pipeline fora
 * da fila (ver apps/worker/scripts/motion-e2e.mts). O caminho normal continua
 * sendo createMotion/updateMotion, que enfileiram.
 */
export { runMotionPipeline } from './pipeline.js';
export { workspaceFor, type MotionWorkspace } from './workspace/workspace.js';
export { requireSession as getMotionSession, getMetadata as getMotionMetadata } from './store/sessions.js';
export type { BrandIdentity, ClientMotionContext, MotionAsset } from './client-context/types.js';
