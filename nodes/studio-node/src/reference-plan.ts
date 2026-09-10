import type {
  CreativeSpec,
  StudioBrandPlacement,
  StudioReferenceAsset,
  StudioReferenceFidelity,
  StudioReferenceRole,
} from '@desigual-os/types';
import type { StudioJobAttachment } from '@desigual-os/orchestrator';

const ROLE_PATTERNS: Array<[StudioReferenceRole, RegExp]> = [
  ['mask', /(?:^|[._ -])(mask|mascara|máscara)(?:[._ -]|$)/i],
  ['logo', /(?:^|[._ -])(logo|marca|brandmark|assinatura)(?:[._ -]|$)/i],
  ['subject', /(?:^|[._ -])(face|rosto|pessoa|personagem|character|modelo)(?:[._ -]|$)/i],
  ['product', /(?:^|[._ -])(produto|product|packshot|embalagem|maquina|máquina)(?:[._ -]|$)/i],
  ['layout', /(?:^|[._ -])(layout|wireframe|composicao|composição)(?:[._ -]|$)/i],
  ['style', /(?:^|[._ -])(style|estilo|moodboard|mood)(?:[._ -]|$)/i],
  ['scene', /(?:^|[._ -])(scene|cenario|cenário|local|lugar|location|background|fundo)(?:[._ -]|$)/i],
];

export interface ResolvedReferenceAsset extends StudioReferenceAsset {
  role: StudioReferenceRole;
  fidelity: StudioReferenceFidelity;
  placement: StudioBrandPlacement;
}

export interface ResolvedReferencePlan {
  all: ResolvedReferenceAsset[];
  /** Imagens que entram no ReferenceLatent nativo do FLUX.2. */
  modelReferences: ResolvedReferenceAsset[];
  /** Logo aplicado depois da difusão, preservando bytes/proporção do ativo. */
  canvasLogo?: ResolvedReferenceAsset;
  mask?: ResolvedReferenceAsset;
}

function inferRole(asset: StudioReferenceAsset, index: number): StudioReferenceRole {
  if (asset.role && asset.role !== 'auto') return asset.role;
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(asset.filename)) return role;
  }
  // A primeira imagem genérica é a base visual mais provável. As seguintes
  // são referências auxiliares, sem inventar que representam uma pessoa ou
  // produto específico.
  return index === 0 ? 'scene' : 'style';
}

function defaultFidelity(role: StudioReferenceRole): StudioReferenceFidelity {
  if (role === 'logo' || role === 'mask') return 'exact';
  if (role === 'style') return 'interpretive';
  return 'high';
}

function defaultPlacement(role: StudioReferenceRole, prompt: string): StudioBrandPlacement {
  if (role !== 'logo') return 'reference_only';
  const integrated = /\b(?:on|onto|na|no|em) (?:the )?(?:box|package|packaging|shirt|cap|hat|vehicle|machine|product|sign|facade|caixa|embalagem|camisa|bon[eé]|chap[eé]u|ve[ií]culo|m[aá]quina|produto|placa|fachada)\b/i.test(prompt);
  return integrated ? 'in_scene' : 'canvas_bottom_right';
}

/**
 * Une anexos do job, referências vindas da galeria e o plano explícito do
 * Otto. O plano explícito ganha por URL; nenhum arquivo é duplicado.
 */
export function resolveReferencePlan(params: {
  attachments?: StudioJobAttachment[];
  galleryReferenceUrls?: string[];
  spec?: CreativeSpec;
  prompt?: string | null;
}): ResolvedReferencePlan {
  const explicit = params.spec?.referencePlan?.assets ?? [];
  const byUrl = new Map<string, StudioReferenceAsset>();

  for (const asset of params.attachments ?? []) byUrl.set(asset.url, asset);
  for (const [index, url] of (params.galleryReferenceUrls ?? []).entries()) {
    if (!byUrl.has(url)) {
      byUrl.set(url, { url, filename: `gallery-reference-${index + 1}.png`, contentType: 'image/png' });
    }
  }
  for (const asset of explicit) {
    const previous = byUrl.get(asset.url);
    byUrl.set(asset.url, { ...previous, ...asset });
  }

  const all = [...byUrl.values()].map<ResolvedReferenceAsset>((asset, index) => {
    const role = inferRole(asset, index);
    return {
      ...asset,
      role,
      fidelity: asset.fidelity ?? defaultFidelity(role),
      placement: asset.placement ?? defaultPlacement(role, params.prompt ?? ''),
    };
  });

  const canvasLogo = all.find(
    (asset) => asset.role === 'logo' && asset.placement.startsWith('canvas_'),
  );
  const mask = all.find((asset) => asset.role === 'mask');
  const modelReferences = all
    .filter((asset) => asset.contentType.startsWith('image/'))
    .filter((asset) => asset.role !== 'mask')
    .filter((asset) => asset !== canvasLogo)
    .slice(0, 10);

  return { all, modelReferences, ...(canvasLogo ? { canvasLogo } : {}), ...(mask ? { mask } : {}) };
}

const ROLE_DIRECTIVE: Record<StudioReferenceRole, string> = {
  auto: 'use it only for the visual evidence relevant to the instruction',
  scene: 'keep the location, camera position, perspective, spatial layout and existing light direction',
  subject: 'preserve the same person, facial geometry, age cues, skin tone, hair and recognizable identity',
  product: 'preserve exact product silhouette, proportions, parts, materials, colors and distinctive details',
  style: 'use its visual language, color treatment and photographic mood without copying unrelated content',
  layout: 'preserve the composition grid, subject placement, scale relationships and negative space',
  logo: 'preserve the supplied mark, spelling, letterforms, proportions and colors',
  mask: 'change only the white area and keep the black area unchanged',
};

export function buildReferencePromptDirective(references: ResolvedReferenceAsset[]): string {
  if (references.length === 0) return '';
  return references
    .map((asset, index) => {
      const fidelity = asset.fidelity === 'exact'
        ? 'Treat this as exact source evidence'
        : asset.fidelity === 'high'
          ? 'Match it with high fidelity'
          : 'Interpret it as inspiration';
      return `Reference Image ${index + 1} (${asset.role}): ${fidelity}; ${asset.instruction ?? ROLE_DIRECTIVE[asset.role]}.`;
    })
    .join(' ');
}
