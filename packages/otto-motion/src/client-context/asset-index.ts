import type { MotionAsset, MotionAssetKind } from './types.js';

/**
 * §31/§32 — seleção inteligente de assets.
 *
 * O problema real: um cliente com 25 imagens no Studio não pode mandar as 25
 * pro Opus. Não é só custo — é direção: 25 fotos sem hierarquia produzem um
 * motion que usa todas e não escolhe nenhuma.
 *
 * A prioridade abaixo é deliberada e segue §31: marca antes de conteúdo,
 * referência pedida pela pessoa antes de tudo.
 */
const KIND_PRIORITY: Record<MotionAssetKind, number> = {
  reference: 0,
  logo: 1,
  font: 2,
  image: 3,
  video: 4,
  document: 5,
};

/** Origem mais confiável primeiro: o que a marca declarou vem antes do que foi gerado. */
const ORIGIN_PRIORITY: Record<string, number> = {
  'anexo do turno': 0,
  client_brand_kits: 1,
  studio_brand_kits: 2,
  project_files: 3,
  studio_assets: 4,
};

export interface AssetSelection {
  selected: MotionAsset[];
  /** O que ficou de fora e por quê — vai pro log e pro metadata da sessão. */
  skipped: { filename: string; reason: string }[];
}

export interface AssetBudget {
  logos: number;
  images: number;
  videos: number;
  references: number;
}

export const DEFAULT_ASSET_BUDGET: AssetBudget = { logos: 2, images: 8, videos: 3, references: 6 };

export function inferAssetKind(contentType: string, filename: string, origin: string): MotionAssetKind {
  const lower = filename.toLowerCase();
  if (origin === 'client_brand_kits' || /\blogo\b|logotipo|marca[_\-.]/.test(lower)) return 'logo';
  if (contentType.startsWith('video/')) return 'video';
  if (/font|\.(ttf|otf|woff2?)$/.test(lower) || contentType.startsWith('font/')) return 'font';
  if (contentType.startsWith('image/')) return 'image';
  return 'document';
}

/**
 * Escolhe o que vai pro workspace. Determinístico de propósito: o mesmo
 * cliente com o mesmo acervo produz a mesma seleção, o que torna um motion
 * ruim investigável em vez de misterioso.
 */
export function selectAssets(
  assets: readonly MotionAsset[],
  budget: AssetBudget = DEFAULT_ASSET_BUDGET,
): AssetSelection {
  const ordered = [...assets].sort((a, b) => {
    const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (byKind !== 0) return byKind;
    const byOrigin = (ORIGIN_PRIORITY[a.origin] ?? 9) - (ORIGIN_PRIORITY[b.origin] ?? 9);
    if (byOrigin !== 0) return byOrigin;
    // Empate: a maior resolução ganha. Foto pequena esticada num 1080x1920
    // é o defeito visual mais comum e mais evitável de todos.
    return (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0);
  });

  const used: Record<MotionAssetKind, number> = {
    reference: 0,
    logo: 0,
    font: 0,
    image: 0,
    video: 0,
    document: 0,
  };
  const limits: Record<MotionAssetKind, number> = {
    reference: budget.references,
    logo: budget.logos,
    font: 4,
    image: budget.images,
    video: budget.videos,
    document: 0,
  };

  const selected: MotionAsset[] = [];
  const skipped: { filename: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const asset of ordered) {
    if (seen.has(asset.sourceUrl)) {
      skipped.push({ filename: asset.filename, reason: 'duplicado' });
      continue;
    }
    if (used[asset.kind] >= limits[asset.kind]) {
      skipped.push({ filename: asset.filename, reason: `acima do orçamento de ${asset.kind}` });
      continue;
    }
    seen.add(asset.sourceUrl);
    used[asset.kind] += 1;
    selected.push(asset);
  }

  return { selected, skipped };
}

/** Há material visual utilizável? Decide entre seguir e devolver NO_ASSETS (§26/§47-E). */
export function hasUsableVisuals(assets: readonly MotionAsset[]): boolean {
  return assets.some((asset) => asset.kind === 'logo' || asset.kind === 'image' || asset.kind === 'video');
}
