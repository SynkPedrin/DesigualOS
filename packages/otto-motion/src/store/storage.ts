import fs from 'node:fs/promises';
import { getSupabaseAdminClient } from '@desigual-os/auth';
import { MotionError } from '../errors.js';

/**
 * Upload do MP4. Reaproveita o bucket `studio-assets`, que já existe, já é
 * público e já é de onde a web serve mídia gerada — criar um bucket novo
 * exigiria provisionamento manual no Supabase pra ganhar nada.
 *
 * Prefixo `motions/` separa o acervo do Studio do acervo do Motion Engine
 * sem precisar de infraestrutura nova.
 */
const BUCKET = 'studio-assets';
const UPLOAD_ATTEMPTS = 3;

/**
 * `clientId` null no modo AD_HOC (adendo chat-first) — usa a pasta literal
 * `ad-hoc` no storage, não um id de cliente inventado. `motionId` já é
 * único, então não há colisão entre peças avulsas de conversas diferentes.
 */
export function motionStoragePath(clientId: string | null, motionId: string, version: number, quality: string): string {
  return `motions/${clientId ?? 'ad-hoc'}/${motionId}/v${version}-${quality}.mp4`;
}

export async function uploadMotionFile(params: {
  localFile: string;
  storagePath: string;
  contentType?: string;
}): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new MotionError('INTERNAL', 'O motion ficou pronto, mas não consegui publicá-lo.', {
      detail: 'SUPABASE_URL/SUPABASE_SECRET_KEY ausentes no worker',
    });
  }

  const supabase = getSupabaseAdminClient(supabaseUrl, secretKey);
  const content = await fs.readFile(params.localFile);

  let lastError = '';
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage.from(BUCKET).upload(params.storagePath, content, {
      contentType: params.contentType ?? 'video/mp4',
      // upsert: re-render da MESMA versão sobrescreve em vez de falhar. A GPU
      // (ou os minutos de CPU) já foram gastos; perder o arquivo por um
      // soluço de rede seria o pior desfecho.
      upsert: true,
    });
    if (!error) {
      return supabase.storage.from(BUCKET).getPublicUrl(params.storagePath).data.publicUrl;
    }
    lastError = error.message;
    if (attempt < UPLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }

  throw new MotionError('INTERNAL', 'O motion ficou pronto, mas o envio falhou. O arquivo está salvo no worker.', {
    detail: `upload falhou em ${UPLOAD_ATTEMPTS} tentativas: ${lastError}`,
  });
}
