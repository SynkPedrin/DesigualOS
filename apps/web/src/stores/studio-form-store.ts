import { create } from 'zustand';
import type {
  StudioJobAttachmentWire,
  StudioJobDetail,
  StudioJobType,
  StudioQualityPreset,
  StudioStyle,
} from '@/lib/api/contracts';

/** Qualidade da UI: 'ultra' não é preset do backend — vira high + metadata.ultra
 * no submit (ver job-form). */
export type StudioQualityChoice = 'standard' | 'high' | 'ultra';

export const STUDIO_VARIATION_OPTIONS = [1, 2, 4, 6, 8] as const;

interface StudioFormState {
  clientId: string;
  type: StudioJobType;
  style: StudioStyle;
  aspectRatio: string;
  quality: StudioQualityChoice;
  variations: number;
  numSlides: number;
  includeText: boolean;
  durationSeconds: number;
  objective: string;
  briefing: string;
  /** Referência visual principal (dropzone): slot único, substituível. */
  visualReference: StudioJobAttachmentWire | null;
  attachments: StudioJobAttachmentWire[];
  /** URLs de assets da galeria usados como referência (reference_images, máx 16). */
  referenceImages: string[];
  /** Incrementa pra pedir foco/scroll no painel (e abrir o drawer no layout estreito). */
  panelFocusToken: number;

  set: (patch: Partial<Omit<StudioFormState, 'set' | 'reset' | 'loadFromJob' | 'requestPanelFocus' | 'addReferenceImage' | 'removeReferenceImage'>>) => void;
  reset: () => void;
  loadFromJob: (job: StudioJobDetail, fallbackClientId?: string | null) => void;
  requestPanelFocus: () => void;
  addReferenceImage: (url: string) => void;
  removeReferenceImage: (url: string) => void;
}

const DEFAULTS = {
  clientId: '',
  type: 'carousel' as StudioJobType,
  style: 'padrao' as StudioStyle,
  aspectRatio: '1088x1360',
  quality: 'standard' as StudioQualityChoice,
  variations: 1,
  numSlides: 5,
  // Copy automática desligada por padrão (achado da certificação de
  // pré-release, 2026-09-10): a legenda agora só é gerada sob demanda, pelo
  // botão manual "Gerar legenda com Otto" depois que a imagem já existe -
  // nunca mais automaticamente na criação do job.
  includeText: false,
  durationSeconds: 10,
  objective: '',
  briefing: '',
  visualReference: null as StudioJobAttachmentWire | null,
  attachments: [] as StudioJobAttachmentWire[],
  referenceImages: [] as string[],
};

function qualityChoiceOf(preset: StudioQualityPreset | null, ultra: boolean): StudioQualityChoice {
  if (ultra) return 'ultra';
  return preset === 'high' ? 'high' : 'standard';
}

/** Estado do painel de criação, fora da árvore de componentes de propósito: a galeria
 * ("Duplicar", "Editar projeto", "Usar como referência") preenche o form sem prop drilling,
 * e funciona igual na rota /studio e dentro do StudioModal. */
export const useStudioFormStore = create<StudioFormState>((set) => ({
  ...DEFAULTS,
  panelFocusToken: 0,

  set: (patch) => set(patch),
  reset: () => set({ ...DEFAULTS }),
  loadFromJob: (job, fallbackClientId) =>
    set({
      clientId: job.clientId ?? fallbackClientId ?? '',
      type: job.type === 'upscale' ? 'image' : job.type,
      style: job.style ?? 'padrao',
      aspectRatio: job.resolution || DEFAULTS.aspectRatio,
      quality: qualityChoiceOf(job.qualityPreset, job.ultra),
      variations: job.variations ?? 1,
      numSlides: job.numSlides ?? 5,
      includeText: job.includeText ?? false,
      durationSeconds: job.durationSeconds ?? 10,
      objective: '',
      briefing: job.prompt,
      attachments: job.attachments,
      referenceImages: job.referenceImages ?? [],
    }),
  requestPanelFocus: () => set((state) => ({ panelFocusToken: state.panelFocusToken + 1 })),
  addReferenceImage: (url) =>
    set((state) =>
      state.referenceImages.includes(url) || state.referenceImages.length >= 16
        ? state
        : { referenceImages: [...state.referenceImages, url] },
    ),
  removeReferenceImage: (url) =>
    set((state) => ({ referenceImages: state.referenceImages.filter((item) => item !== url) })),
}));
