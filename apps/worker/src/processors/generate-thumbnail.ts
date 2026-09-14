import { desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { getSupabaseAdminClient } from '@desigual-os/auth';
import sharp from 'sharp';
import type { Logger } from '@desigual-os/logging';

const THUMB_WIDTH = 480;
const BUCKET = 'studio-assets';

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY not configured');
  }
  return getSupabaseAdminClient(supabaseUrl, secretKey);
}

/**
 * Gera a thumbnail de um asset do Studio: baixa o original do Storage,
 * redimensiona pra 480px webp e sobe em `thumbs/`. Idempotente: se o asset
 * já tem thumb_url (ou sumiu), sai sem fazer nada. Só processa imagens;
 * vídeo e PDF ficam sem thumb por ora.
 */
export async function generateThumbnail(assetId: string, logger: Logger): Promise<void> {
  const [asset] = await db
    .select({
      id: schema.studioAssets.id,
      clientId: schema.studioAssets.clientId,
      filename: schema.studioAssets.filename,
      storageUrl: schema.studioAssets.storageUrl,
      thumbUrl: schema.studioAssets.thumbUrl,
    })
    .from(schema.studioAssets)
    .where(eq(schema.studioAssets.id, assetId));

  if (!asset || asset.thumbUrl) return;
  if (!/\.(png|jpe?g|webp)$/i.test(asset.filename)) return;

  const response = await fetch(asset.storageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Download do asset falhou com HTTP ${response.status}`);
  }
  const original = Buffer.from(await response.arrayBuffer());

  const thumb = await sharp(original).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();

  const supabase = getSupabase();
  const path = `thumbs/${asset.clientId}/${asset.filename.replace(/\.[^.]+$/, '')}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, thumb, { contentType: 'image/webp', upsert: true });
  if (error) {
    throw new Error(`Upload da thumbnail falhou: ${error.message}`);
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  await db.update(schema.studioAssets).set({ thumbUrl: data.publicUrl }).where(eq(schema.studioAssets.id, assetId));
  logger.info(
    { assetId, before_kb: Math.round(original.length / 1024), after_kb: Math.round(thumb.length / 1024) },
    'Thumbnail gerada',
  );
}

/**
 * Backfill no boot do worker: enfileira os assets de imagem sem thumb
 * (mais novos primeiro, teto de 500 pra não varrer a história inteira de
 * uma vez). O jobId determinístico torna reexecução inócua.
 */
export async function backfillThumbnails(logger: Logger): Promise<number> {
  const { enqueueThumbnail } = await import('@desigual-os/orchestrator');
  const missing = await db
    .select({ id: schema.studioAssets.id, filename: schema.studioAssets.filename })
    .from(schema.studioAssets)
    .where(isNull(schema.studioAssets.thumbUrl))
    .orderBy(desc(schema.studioAssets.createdAt))
    .limit(500);

  let enqueued = 0;
  for (const asset of missing) {
    if (!/\.(png|jpe?g|webp)$/i.test(asset.filename)) continue;
    await enqueueThumbnail(asset.id).catch(() => null);
    enqueued += 1;
  }
  if (enqueued > 0) logger.info({ enqueued }, 'Backfill de thumbnails enfileirado');
  return enqueued;
}
