export { loadOttoConfig } from './llm/config.js';
export type { OttoConfig } from './llm/config.js';

export { createOttoLLMProvider, OttoLLMError } from './llm/ollama-provider.js';
export { extractJsonPayload, parseJsonLoose } from './llm/json-extract.js';
export type {
  OttoChatMessage,
  OttoChatOptions,
  OttoLLMHealth,
  OttoLLMHealthStatus,
  OttoLLMProvider,
  OttoLLMProviderConfig,
} from './llm/ollama-provider.js';

export {
  checkBrainHealth,
  invalidateBrainIndex,
  loadBrainIndex,
  retrieveRelevantKnowledge,
} from './brain/retrieval.js';
export type {
  BrainDoc,
  BrainFrontmatter,
  BrainHealth,
  BrainIndex,
  RetrievedKnowledge,
  RetrieveOptions,
} from './brain/retrieval.js';

export {
  classifyRetrievalDepth,
  depthPolicy,
  planTurnDepth,
  extractOrchestratorContext,
  stripOrchestratorContext,
  CONTEXT_BLOCK_MARKER,
} from './brain/depth.js';
export type { DepthDecision, DepthPolicy, RetrievalDepth, TurnDepthPlan } from './brain/depth.js';
export { classificarTurno, itensDaLista, resolverReferente } from './brain/referential.js';
export type { ClasseDeTurno, TurnoClassificado } from './brain/referential.js';
export { documentoPermitido, donoDoDocumento } from './brain/retrieval.js';

export {
  artDirectionSchema,
  carouselNarrativeFunctionSchema,
  carouselPlanSchema,
  carouselSlideSchema,
  creativeFeedbackSchema,
  creativePlanSchema,
  criticEvaluationSchema,
  criticFlagsSchema,
  criticRootCauseSchema,
  criticScoresSchema,
  angleScoresSchema,
  creativeAngleSchema,
  creativeStrategySchema,
  hookScoresSchema,
  hookCandidateSchema,
  bigIdeaAndHooksSchema,
  productionSpecSchema,
  qualityCriteriaSchema,
  qualityEvaluationSchema,
  qualityIssueSchema,
  studioJobTypeSchema,
  upscaleSpecSchema,
  videoPlanSchema,
  videoSceneSchema,
} from './creative/schemas.js';
export type {
  ArtDirection,
  CarouselNarrativeFunction,
  CarouselPlan,
  CarouselSlide,
  CreativeFeedback,
  CreativePlan,
  CriticEvaluation,
  CriticFlags,
  CriticRootCause,
  CriticScores,
  AngleScores,
  CreativeAngle,
  CreativeStrategy,
  HookScores,
  HookCandidate,
  BigIdeaAndHooks,
  ProductionSpec,
  QualityCriteria,
  QualityEvaluation,
  QualityIssue,
  StudioJobType,
  UpscaleSpec,
  VideoPlan,
  VideoScene,
} from './creative/schemas.js';

export {
  buildImagePrompt,
  buildProductionSpec,
  createCreativePlan,
  planCarousel,
  planVideo,
} from './creative/planner.js';
export type {
  BuildProductionSpecOptions,
  CreateCreativePlanInput,
  PlannerDeps,
} from './creative/planner.js';

export { buildDirectionDirective } from './creative/stance.js';
export {
  blocoDeContinuacaoCriativa,
  contratoDeSaida,
  diretivaDoContrato,
  ehRevisaoEliptica,
  exigeFrescorOperacional,
  parseRequestedSlideCount,
} from './creative/output-contract.js';
export type { ArtefatoPedido, ContratoDeSaida } from './creative/output-contract.js';
export type { DirectionDirectiveInput } from './creative/stance.js';

export { evaluateCreative } from './creative/quality.js';
export type { CreativeAssetUnderReview, QualityDeps } from './creative/quality.js';

export { deriveCreativeDNA } from './creative/dna.js';
export type { BrandKit, CreativeDNA } from './creative/dna.js';

export { generateImageCaption } from './creative/caption-from-image.js';
export type { GenerateImageCaptionInput, GeneratedImageCaption } from './creative/caption-from-image.js';

export { assessCreativeCopy } from './creative/anti-generic.js';
export type { CopyAssessment, AssessCopyOptions } from './creative/anti-generic.js';

export {
  canPromote,
  createLearning,
  nextStage,
  OTTO_LEARNING_KINDS,
  OTTO_LEARNING_STAGES,
  promoteLearning,
  recordEvidence,
} from './learning/pipeline.js';
export type {
  OttoEvidence,
  OttoEvidenceOrigin,
  OttoLearning,
  OttoLearningKind,
  OttoLearningStage,
  PromotionCheck,
} from './learning/pipeline.js';

export {
  applyFeedbackToLearning,
  feedbackSubject,
  learningKindForVerdict,
} from './learning/feedback.js';
export type {
  OttoFeedbackInput,
  OttoFeedbackTransition,
  OttoFeedbackVerdict,
  OttoLearningPersistedState,
} from './learning/feedback.js';
export { assembleCreativeState, assessCreativeReadiness } from './creative/creative-state.js';
export type { CreativeState, CreativeStateInput, CreativeReadiness, CreativeGap, CreativeReference } from './creative/creative-state.js';
export { classifySourceQuality, synthesizeFindings, researchToEvidence, runResearch } from './research/research.js';
export { createWebSearchProvider, createWebSearchProviderFromEnv, WebSearchError, WEB_SEARCH_VENDORS } from './research/web-search-provider.js';
export type { WebSearchVendor, WebSearchConfig } from './research/web-search-provider.js';
export type { SourceQuality, ResearchSource, ResearchFinding, ResearchProvider, ResearchEvidence, ResearchResult } from './research/research.js';
export { runCreativePipeline } from './creative/creative-pipeline.js';
export type { CreativeOutput, CreativeGenerator, CreativePipelineResult, CreativePipelineDeps } from './creative/creative-pipeline.js';

export {
  critiqueDeliverable,
  computeMissingDeliverables,
  explainDeliverableGap,
  looksLikeScriptContent,
  looksLikeSequencedScript,
  looksLikeCreativeBrief,
  detectPlaceholderContent,
  deliverableRegression,
  deriveCriticOverall,
  passesCriticGate,
  reconcileRootCause,
  formatCriticRevisionNote,
  rewriteRequiresStrategyLayer,
} from './creative/critic.js';
export type { CriticDeps, CriticInput, CriticGateResult } from './creative/critic.js';

export {
  developStrategy,
  deriveAngleTotal,
  selectBestAngle,
  bigIdeaPassesTest,
  developBigIdeaAndHooks,
  deriveHookTotal,
  selectBestHook,
  formatStrategyBriefing,
} from './creative/strategy.js';
export type { StrategyDeps, StrategyInput, AngleSelection, DevelopBigIdeaInput } from './creative/strategy.js';

export { validateReelExecution, formatReelExecutionNote } from './creative/reel-execution.js';
export type { ReelExecutionFinding, ReelExecutionIssue } from './creative/reel-execution.js';

export { detectCarouselRepetition, formatCarouselQualityNote } from './creative/carousel-quality.js';
export type { CarouselQualityFinding, CarouselQualityIssue } from './creative/carousel-quality.js';

export { selectBestValidCandidate } from './creative/best-valid.js';
export type { CandidateRecord } from './creative/best-valid.js';

export {
  containsForbiddenPhrase,
  extractForbiddenPhrases,
  detectForbiddenLanguage,
  extractRequestedRemovals,
  verifyRequestedRemovals,
} from './creative/universal-quality.js';
export type { RequestedRemoval, RemovalVerification } from './creative/universal-quality.js';
