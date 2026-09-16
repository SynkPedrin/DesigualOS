/**
 * Tipos de job do Studio (seção 7.3), alinhado com as capabilities de
 * exemplo da seção 6.1 (image_generation, video_generation, upscale).
 */
export const STUDIO_JOB_TYPES = ['image', 'carousel', 'video', 'reels', 'upscale'] as const;

export type StudioJobType = (typeof STUDIO_JOB_TYPES)[number];

/**
 * Preset de qualidade de WIRE (contrato API/DB) - valores gravados em
 * studio_jobs.quality_preset hoje em produção, não mude sem migration de
 * dados. Fonte única: antes disso `apps/api/src/studio/routes.ts`,
 * `apps/web/src/lib/api/contracts.ts` e `nodes/studio-node` declaravam essa
 * união 3x de forma independente (achado do levantamento de 08/09/2026).
 * Não confundir com `QualityProfile` (draft|standard|master) do motor de
 * geração do studio-node - esse é um conceito de EXECUÇÃO interno, este
 * aqui é o valor que trafega na API. 'high' mapeia pra 'master' na
 * execução (ver studio-node/src/comfyui-client.ts:qualityProfileFromPreset).
 */
export const STUDIO_QUALITY_PRESETS = ['draft', 'standard', 'high'] as const;
export type StudioQualityPreset = (typeof STUDIO_QUALITY_PRESETS)[number];

/** Direção de arte pedida no job. 'padrao' = Brand Kit do cliente sem modificador. Fonte única (mesma duplicação 3x do preset acima). */
export const STUDIO_STYLES = ['padrao', 'minimalista', 'cinematico', 'editorial', '3d'] as const;
export type StudioStyle = (typeof STUDIO_STYLES)[number];

/**
 * Status de studio_jobs.status. Coluna é `text` livre no banco (sem
 * pgEnum/CHECK - achado do levantamento de 08/09/2026), então adicionar um
 * valor novo aqui NÃO exige migration. Os 4 primeiros são os únicos
 * gravados em produção hoje; os demais são os novos estágios do pipeline
 * adaptativo (seção 33 do plano de evolução) - todo `publishWsEvent({type:
 * 'studio.job.progress', payload: {status}})` deve usar um valor daqui.
 */
export const STUDIO_JOB_STATUSES = [
  'queued',
  'rendering',
  'completed',
  'failed',
  /**
   * Cancelado pelo usuário. Terminal, como completed/failed - o worker
   * descarta o job sem gerar quando encontra este status, e o loop de
   * qualidade para antes do próximo ciclo (ver studio-node/src/qa-loop.ts).
   */
  'cancelled',
  // Novos estágios (pipeline adaptativo) - opcionais, um job simples pode
  // pular direto de 'queued' pra 'rendering' pra 'completed' como sempre fez.
  'planning',
  'quality_check',
  'refining',
  'post_processing',
  'uploading',
  'keyframe_generation',
  'keyframe_qa',
  'video_draft',
  'motion_qa',
  'video_master',
  'video_qa',
] as const;
export type StudioJobStatus = (typeof STUDIO_JOB_STATUSES)[number];

/**
 * Papel semântico de uma referência visual. FLUX.2 entende múltiplas
 * imagens, mas só consegue usá-las de forma previsível quando o prompt diz
 * o que deve ser extraído de cada uma. `logo` e `font` também permitem que
 * o acabamento os trate como ativos exatos, em vez de pedir ao modelo para
 * redesenhá-los.
 */
export const STUDIO_REFERENCE_ROLES = [
  'auto',
  'scene',
  'subject',
  'product',
  'style',
  'layout',
  'logo',
  'mask',
] as const;
export type StudioReferenceRole = (typeof STUDIO_REFERENCE_ROLES)[number];

export const STUDIO_REFERENCE_FIDELITY = ['exact', 'high', 'interpretive'] as const;
export type StudioReferenceFidelity = (typeof STUDIO_REFERENCE_FIDELITY)[number];

export const STUDIO_BRAND_PLACEMENTS = [
  'reference_only',
  'in_scene',
  'canvas_top_left',
  'canvas_top_right',
  'canvas_bottom_left',
  'canvas_bottom_right',
] as const;
export type StudioBrandPlacement = (typeof STUDIO_BRAND_PLACEMENTS)[number];

export interface StudioReferenceAsset {
  url: string;
  filename: string;
  contentType: string;
  role?: StudioReferenceRole | undefined;
  fidelity?: StudioReferenceFidelity | undefined;
  /** Instrução curta, por exemplo: "preservar exatamente o rosto". */
  instruction?: string | undefined;
  /** Logos podem guiar a cena ou ser compostos pixel a pixel no canvas. */
  placement?: StudioBrandPlacement | undefined;
}

/**
 * CreativeSpec (seção 1 do plano de evolução do Studio, 08/09/2026):
 * contrato estruturado que o Otto (ou qualquer produtor de job) PODE
 * anexar em `studio_jobs.metadata.creative_spec` pra dar ao Workflow
 * Router e ao Finish Router informação que o StudioJobData plano (prompt +
 * resolution + type) não carrega - o que preservar, quão forte
 * transformar, que profile de qualidade, que acabamento.
 *
 * NENHUM campo é obrigatório: um job sem creative_spec continua
 * funcionando (ver studio-node/src/creative-spec.ts:deriveCreativeSpec, que
 * monta um spec mínimo a partir dos campos de StudioJobData já existentes
 * quando isto não vier preenchido). Isto é aditivo - não substitui
 * StudioJobRequestWire/StudioJobData, é um objeto opcional dentro do
 * metadata livre que ambos já têm.
 */
export interface CreativeSpec {
  objective?: string;
  contentType?: 'image' | 'carousel' | 'video' | 'reel';
  operation?: 'generate' | 'variation' | 'edit' | 'animate';

  subject?: {
    description?: string;
    identityCritical?: boolean;
    productCritical?: boolean;
  };

  environment?: {
    description?: string;
  };

  composition?: {
    framing?: string;
    angle?: string;
    aspectRatio?: string;
  };

  camera?: {
    movement?: string;
    lens?: string;
    look?: string;
  };

  lighting?: {
    description?: string;
  };

  artDirection?: {
    style?: string[];
    mood?: string;
    palette?: string[];
  };

  preservation?: {
    identity?: boolean;
    composition?: boolean;
    camera?: boolean;
    product?: boolean;
    background?: boolean;
    lighting?: boolean;
    perspective?: boolean;
    materials?: boolean;
    textAndLogos?: boolean;
  };

  /**
   * Plano explícito de referência. A ordem é relevante: ela vira
   * "Reference Image 1", "Reference Image 2" no prompt do FLUX.2.
   */
  referencePlan?: {
    assets?: StudioReferenceAsset[];
    /** URL de uma máscara opcional: branco altera, preto preserva. */
    editMaskUrl?: string;
  };

  /** Régua fotográfica usada pelo compilador de prompt e pelo QA. */
  fidelity?: {
    level?: 'balanced' | 'high' | 'maximum';
    location?: boolean;
    identity?: boolean;
    productGeometry?: boolean;
    physicalLighting?: boolean;
    materialMicrodetail?: boolean;
    anatomy?: boolean;
    typography?: boolean;
  };

  /** Ativos que precisam sobreviver ao pipeline sem serem redesenhados. */
  brandComposition?: {
    renderTextDeterministically?: boolean;
    logo?: {
      sourceUrl?: string;
      placement?: StudioBrandPlacement;
      widthRatio?: number;
      marginRatio?: number;
    };
    fontFiles?: Array<{ family: string; sourceUrl: string }>;
  };

  transformationStrength?: 'low' | 'medium' | 'high';

  qualityProfile?: 'draft' | 'standard' | 'master';

  finish?: {
    grain?: 'none' | 'subtle' | 'film';
    upscale?: 'auto' | 'none' | 'restore' | 'master';
  };

  video?: {
    duration?: number;
    fps?: number;
    shots?: Array<{
      start: number;
      end: number;
      action: string;
      camera?: string;
    }>;
    audio?: {
      dialogue?: string;
      ambience?: string;
      music?: string;
    };
  };
}
