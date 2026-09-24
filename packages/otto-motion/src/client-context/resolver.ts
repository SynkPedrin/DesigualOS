import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { parseBrain } from './brain-parser.js';
import { inferAssetKind } from './asset-index.js';
import type { BrandIdentity, ClientMotionContext, MotionAsset } from './types.js';
import type { MotionReference } from '../types.js';
import { MotionError } from '../errors.js';

/**
 * §10 — ClientContextResolver.
 *
 * A spec desenhava uma pasta de cliente com brand/logos/images/videos/fonts, e
 * mandava descobrir a estrutura REAL antes de presumir. A auditoria achou
 * outra coisa: `arquivos clientes/` só tem markdown (123 arquivos, zero
 * imagem), e o material visual de verdade mora no Postgres + Supabase
 * Storage. O conhecimento criativo mora nos BRAIN.md, que chegam ao banco
 * como `memories` kind `client.profile` via scripts/sync-brains.mts.
 *
 * Então a "pasta do cliente" deste sistema é, na prática, quatro fontes:
 *
 *   memories(client.profile)   -> marca, voz, cores, CTAs, restrições
 *   client_brand_kits          -> logo, paleta, fontes (quando preenchido)
 *   studio_brand_kits          -> imagens de referência da marca
 *   studio_assets/project_files-> fotos, vídeos e documentos do cliente
 *
 * Todas READ-ONLY (§11). Nada aqui escreve, renomeia ou apaga nada do
 * cliente: o resolver só lê e o pipeline COPIA pro workspace.
 */
export async function resolveClientContext(
  clientId: string,
  references: readonly MotionReference[] = [],
): Promise<ClientMotionContext> {
  const [client] = await db
    .select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);

  if (!client) {
    throw new MotionError('NO_CLIENT', 'Não achei esse cliente na carteira. Escolhe o cliente no chat e eu sigo daqui.', {
      detail: `client ${clientId} não existe`,
    });
  }

  const sources: string[] = [];
  const missing: string[] = [];
  const assets: MotionAsset[] = [];

  // ---- 1. Brain criativo (memories, kind client.profile) -------------------
  // `subject` não é coluna: o memory-engine o guarda em metadata->>'subject'
  // (ver packages/orchestrator/src/memory-engine.ts). Ler pela coluna errada
  // devolveria undefined em silêncio e o brain nunca seria escolhido.
  const profiles = await db
    .select({ content: schema.memories.content, subject: sql<string | null>`${schema.memories.metadata}->>'subject'` })
    .from(schema.memories)
    .where(and(eq(schema.memories.clientId, clientId), eq(schema.memories.kind, 'client.profile'), eq(schema.memories.status, 'active')))
    .orderBy(desc(schema.memories.importance), desc(schema.memories.updatedAt))
    .limit(4);

  const brainRow = profiles.find((row) => row.subject?.endsWith(':brain')) ?? profiles[0];
  const briefing = profiles.map((row) => row.content).join('\n\n---\n\n').trim() || null;
  const parsed = brainRow ? parseBrain(brainRow.content) : null;
  if (brainRow) sources.push('brain criativo do cliente');
  else missing.push('brain criativo (rode scripts/sync-brains.mts se o BRAIN.md existe no repositório)');

  // ---- 2. Brand kit geral --------------------------------------------------
  const [kit] = await db
    .select()
    .from(schema.clientBrandKits)
    .where(eq(schema.clientBrandKits.clientId, clientId))
    .limit(1);

  if (kit) {
    sources.push('brand kit do cliente');
    if (kit.logoUrl) {
      assets.push({
        kind: 'logo',
        sourceUrl: kit.logoUrl,
        filename: filenameFromUrl(kit.logoUrl, 'logo.png'),
        contentType: contentTypeFromUrl(kit.logoUrl),
        origin: 'client_brand_kits',
      });
    }
  }

  // Cores e fontes: o brand kit é a fonte operacional, o brain é a
  // declarada. Os dois entram, sem duplicar, brand kit primeiro — ele é o que
  // o resto do sistema (Studio) já usa.
  const colors = dedupe([...(kit?.colors ?? []), ...(parsed?.colors ?? [])]);
  const fonts = dedupe([...(kit?.fonts ?? []), ...(parsed?.fonts ?? [])]);

  if (colors.length === 0) missing.push('paleta da marca');
  if (fonts.length === 0) missing.push('tipografia da marca');
  if (!kit?.logoUrl) missing.push('logo oficial');

  // ---- 3. Referências visuais da marca (studio_brand_kits) -----------------
  const [studioKit] = await db
    .select()
    .from(schema.studioBrandKits)
    .where(eq(schema.studioBrandKits.clientId, clientId))
    .limit(1);

  for (const url of studioKit?.referenceImages ?? []) {
    assets.push({
      kind: 'reference',
      sourceUrl: url,
      filename: filenameFromUrl(url, 'referencia.png'),
      contentType: contentTypeFromUrl(url),
      origin: 'studio_brand_kits',
    });
  }
  if ((studioKit?.referenceImages.length ?? 0) > 0) sources.push('referências visuais da marca');

  // ---- 4. Acervo do cliente (studio_assets) --------------------------------
  const studioAssets = await db
    .select({
      type: schema.studioAssets.type,
      filename: schema.studioAssets.filename,
      storageUrl: schema.studioAssets.storageUrl,
      metadata: schema.studioAssets.metadata,
    })
    .from(schema.studioAssets)
    .where(eq(schema.studioAssets.clientId, clientId))
    .orderBy(desc(schema.studioAssets.createdAt))
    .limit(60);

  for (const asset of studioAssets) {
    const contentType = contentTypeFromUrl(asset.storageUrl, asset.type);
    const dimensions = asset.metadata as { width?: number; height?: number } | null;
    assets.push({
      kind: inferAssetKind(contentType, asset.filename, 'studio_assets'),
      sourceUrl: asset.storageUrl,
      filename: asset.filename,
      contentType,
      origin: 'studio_assets',
      width: dimensions?.width,
      height: dimensions?.height,
    });
  }
  if (studioAssets.length > 0) sources.push(`acervo do Studio (${studioAssets.length} peças)`);

  // ---- 5. Arquivos de projeto do chat --------------------------------------
  const projectFiles = await db
    .select({
      filename: schema.projectFiles.filename,
      storageUrl: schema.projectFiles.storageUrl,
      contentType: schema.projectFiles.contentType,
      kind: schema.projectFiles.kind,
    })
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.clientId, clientId))
    .limit(40);

  for (const file of projectFiles) {
    assets.push({
      kind: inferAssetKind(file.contentType, file.filename, 'project_files'),
      sourceUrl: file.storageUrl,
      filename: file.filename,
      contentType: file.contentType,
      origin: 'project_files',
    });
  }
  if (projectFiles.length > 0) sources.push(`arquivos do projeto (${projectFiles.length})`);

  // ---- 6. Referências que a pessoa anexou neste turno (§33) ----------------
  for (const reference of references) {
    assets.push({
      kind: 'reference',
      sourceUrl: reference.url,
      filename: reference.filename,
      contentType: reference.contentType,
      origin: 'anexo do turno',
    });
  }
  if (references.length > 0) sources.push('referências que você anexou');

  const brand: BrandIdentity = {
    name: client.name,
    slug: client.slug,
    positioning: parsed?.positioning ?? null,
    audience: parsed?.audience ?? null,
    toneOfVoice: kit?.toneOfVoice ?? parsed?.toneOfVoice ?? null,
    colors,
    fonts,
    approvedCtas: parsed?.approvedCtas ?? [],
    restrictions: parsed?.restrictions ?? [],
    products: parsed?.products ?? [],
    gaps: parsed?.gaps ?? [],
  };

  if (!brand.positioning) missing.push('posicionamento');
  if (!brand.toneOfVoice) missing.push('tom de voz');
  if (brand.approvedCtas.length === 0) missing.push('CTAs aprovados');

  return { clientId, brand, assets, briefing, sources, missing };
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (key === '') continue;
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(key);
  }
  return out;
}

export function filenameFromUrl(url: string, fallback: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return name === '' ? fallback : name;
  } catch {
    return fallback;
  }
}

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  pdf: 'application/pdf',
};

export function contentTypeFromUrl(url: string, hint?: string): string {
  const extension = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url)?.[1]?.toLowerCase();
  if (extension && EXTENSION_TYPES[extension]) return EXTENSION_TYPES[extension];
  if (hint === 'video' || hint === 'reels') return 'video/mp4';
  if (hint === 'image' || hint === 'carousel') return 'image/png';
  return 'application/octet-stream';
}
