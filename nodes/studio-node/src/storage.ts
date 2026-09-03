import { createClient } from '@supabase/supabase-js';
import type { StudioNodeConfig } from './config';

/**
 * Upload direto pro Supabase Storage (ADR 0001) com a secret key (acesso
 * de servidor, ignora RLS de propósito: quem chama isso já é um processo
 * de confiança, não um usuário final).
 */
export async function uploadAsset(
  config: StudioNodeConfig,
  path: string,
  content: string | Buffer,
  contentType: string,
): Promise<string> {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY);

  const { error } = await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).upload(path, content, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
