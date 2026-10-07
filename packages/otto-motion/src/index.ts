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
  type MotionRenderVersion,
  type MotionAssetsSummary,
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
export {
  QUOTA_UNAVAILABLE_MESSAGE,
  clearQuotaState,
  readQuotaState,
  recordQuotaUnavailable,
  type ClaudeQuotaState,
} from './providers/quota-state.js';
export { resolveClientContext } from './client-context/resolver.js';
// Leitura barata (só contagens) usada pelo guard do chat pra montar o card de
// briefing — o resolveClientContext acima continua sendo o dossiê completo do pipeline.
export { summarizeClientContext, type ClientContextSummary } from './client-context/summary.js';
export { campaignBriefSchema, briefHasDirection, type CampaignBrief } from './brief/schema.js';
export { extractCampaignBriefFromMessage } from './brief/extract.js';
/**
 * `runMotionPipeline` NÃO sai por aqui — sai por `@desigual-os/otto-motion/pipeline`
 * (ver "exports" no package.json), e isso é deliberado (07/10/2026, cutover).
 *
 * O pipeline puxa @remotion/renderer, @remotion/bundler e sharp: três addons
 * NATIVOS (.node). Enquanto ele era reexportado daqui, QUALQUER import deste
 * barril arrastava o renderizador junto — inclusive a API, que só precisa
 * enfileirar. Resultado: o esbuild de apps/api quebrava em "No loader is
 * configured for .node files" e a API simplesmente não tinha build de
 * produção (passava despercebido porque dev roda em `tsx`, sem bundle).
 *
 * Esta fronteira continua explícita, só deixou de ser única: o que é leve sai
 * no barril, o que carrega binário nativo sai numa entrada própria, de modo
 * que o custo é de quem realmente renderiza (o worker, e o script de prova em
 * apps/worker/scripts/motion-e2e.mts). O caminho normal segue sendo
 * createMotion/updateMotion, que enfileiram.
 */
export { workspaceFor, type MotionWorkspace } from './workspace/workspace.js';
export { requireSession as getMotionSession, getMetadata as getMotionMetadata } from './store/sessions.js';
export type { BrandIdentity, ClientMotionContext, MotionAsset } from './client-context/types.js';
