/**
 * Modelo de documento do Studio > Canva (editor gráfico completo dentro do
 * Studio, pedido do usuário em 2026-09-10). Cada objeto na arte é um dado
 * serializável (não um asset renderizado): a peça inteira nunca é salva só
 * como PNG, sempre como estrutura editável (`CanvaPage.objects`).
 */
export const CANVA_OBJECT_TYPES = ['image', 'text', 'shape', 'group'] as const;
export type CanvaObjectType = (typeof CANVA_OBJECT_TYPES)[number];

export const CANVA_SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'line', 'star'] as const;
export type CanvaShapeKind = (typeof CANVA_SHAPE_KINDS)[number];

/** Campos que TODO objeto da arte possui, independente do tipo. */
export interface CanvaObjectBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  zIndex: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface CanvaImageFilters {
  brightness?: number | undefined;
  contrast?: number | undefined;
  saturation?: number | undefined;
  blur?: number | undefined;
  grayscale?: boolean | undefined;
  sepia?: boolean | undefined;
  /** Graus, 0-360. */
  hueRotate?: number | undefined;
  invert?: boolean | undefined;
  /** 0-1: intensidade da máscara de nitidez (unsharp mask). Sem equivalente
   * em CSS filter - aplicado via convolução própria (ver fabric-sync.ts). */
  sharpen?: number | undefined;
}

export interface CanvaImageObject extends CanvaObjectBase {
  type: 'image';
  src: string;
  /** Crop não-destrutivo: recorta a fonte original, nunca sobrescreve `src`.
   * cropX/cropY = deslocamento em pixels da imagem original; `width`/`height`
   * (de CanvaObjectBase) JÁ SÃO o tamanho da janela de recorte nesses mesmos
   * pixels-fonte quando há crop ativo (mesma convenção do Fabric.js) - não
   * existem campos cropWidth/cropHeight separados, seriam redundantes. */
  cropX?: number | undefined;
  cropY?: number | undefined;
  flipX?: boolean | undefined;
  flipY?: boolean | undefined;
  filters?: CanvaImageFilters | undefined;
  /** Borda (moldura) opcional ao redor da imagem - mesmo par stroke/strokeWidth
   * de CanvaShapeObject, por consistência. `strokeWidth` 0/undefined = sem borda. */
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
}

export interface CanvaTextObject extends CanvaObjectBase {
  type: 'text';
  text: string;
  fontFamily: string;
  /** Slug do Fontsource (ex: "space-grotesk") quando `fontFamily` veio do
   * FontPicker - permite recarregar o arquivo .woff2 certo ao reabrir o
   * documento (o navegador não lembra fontes de sessões anteriores). `undefined`
   * pras fontes nativas do app (Work Sans, Big Shoulders etc., via next/font). */
  fontId?: string | undefined;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  fill: string;
  textAlign: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
  underline: boolean;
  uppercase: boolean;
}

export interface CanvaShapeObject extends CanvaObjectBase {
  type: 'shape';
  shape: CanvaShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius?: number | undefined;
  shadow?: boolean | undefined;
}

export interface CanvaGroupObject extends CanvaObjectBase {
  type: 'group';
  /** Estrutura interna nativa do Fabric (`group.toObject()` / `Group.fromObject()`),
   * não o modelo `CanvaObject` recursivo - de propósito: um grupo é composição
   * aninhada (filhos com coordenadas relativas ao grupo), e o Fabric já resolve
   * isso de forma testada com `NoopLayoutManager` (preserva o layout exato no
   * round-trip). Reconstruir esse aninhamento à mão replicaria a mesma lógica
   * com risco real de erro sutil de matriz de transformação. Único tipo de
   * objeto que não é 100% portável fora do Fabric - troca aceita conscientemente
   * pela robustez do round-trip nativo dele. */
  fabricData: Record<string, unknown>;
}

export type CanvaObject = CanvaImageObject | CanvaTextObject | CanvaShapeObject | CanvaGroupObject;

export interface CanvaPageBackground {
  type: 'color' | 'image' | 'transparent';
  value?: string | undefined;
}

export interface CanvaPage {
  id: string;
  order: number;
  name?: string | undefined;
  background: CanvaPageBackground;
  objects: CanvaObject[];
}

/**
 * Presets iniciais de artboard. `width`/`height` em pixels a 100% (A4 em
 * 300dpi: 2480x3508). "Custom Size" não entra aqui - é qualquer width/height
 * que o usuário digitar direto, sem preset associado.
 */
export const CANVA_SIZE_PRESETS = [
  { id: 'instagram-post', label: 'Instagram Post', width: 1080, height: 1080 },
  { id: 'instagram-portrait', label: 'Instagram Portrait', width: 1080, height: 1350 },
  { id: 'instagram-story', label: 'Instagram Story / Reel', width: 1080, height: 1920 },
  { id: 'linkedin-post', label: 'LinkedIn Post', width: 1200, height: 627 },
  { id: 'youtube-thumbnail', label: 'YouTube Thumbnail', width: 1280, height: 720 },
  { id: 'presentation', label: 'Apresentação', width: 1920, height: 1080 },
  { id: 'a4', label: 'A4', width: 2480, height: 3508 },
] as const;
export type CanvaSizePresetId = (typeof CANVA_SIZE_PRESETS)[number]['id'];

/** Formato de wire (API) do documento completo - o que `PATCH .../:id` grava
 * de uma vez no autosave e `GET .../:id` devolve pra reabrir a edição. */
export interface CanvaDocumentWire {
  id: string;
  client_id: string;
  project_id: string | null;
  name: string;
  width: number;
  height: number;
  thumbnail_url: string | null;
  pages: CanvaPage[];
  created_at: string;
  updated_at: string;
}

/** Versão enxuta pra listagem (sidebar "Projetos"): sem `pages`, só o
 * suficiente pra montar o card (thumbnail, nome, dimensões, última edição). */
export interface CanvaDocumentSummaryWire {
  id: string;
  client_id: string;
  project_id: string | null;
  name: string;
  width: number;
  height: number;
  thumbnail_url: string | null;
  page_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Painel "Imagens" do Canva: formato normalizado que esconde da UI as três
 * APIs diferentes por trás (Pexels/Unsplash/Pixabay) - ver
 * apps/api/src/studio/image-providers/. `download_tracking_url`, quando
 * presente (só Unsplash), DEVE ser chamado pelo backend no momento em que a
 * imagem é efetivamente adicionada ao design (não só exibida na busca) -
 * regra das Unsplash API Guidelines.
 */
export const IMAGE_SEARCH_PROVIDERS = ['pexels', 'unsplash', 'pixabay'] as const;
export type ImageSearchProvider = (typeof IMAGE_SEARCH_PROVIDERS)[number];

export interface ImageSearchResultWire {
  id: string;
  provider: ImageSearchProvider;
  thumbnail_url: string;
  preview_url: string;
  full_url: string;
  width: number;
  height: number;
  author: string;
  author_url: string | null;
  source_url: string;
  download_tracking_url: string | null;
}
