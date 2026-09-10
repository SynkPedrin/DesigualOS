import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { StudioNodeConfig } from './config';

/** Um client por processo função é desperdício real: um job de carrossel com 10 slides
 * criava 10 clients Supabase (um por upload) sem necessidade nenhuma - o client não
 * carrega nada específico de request, só credenciais + config. `getSupabaseClient`
 * cacheia por config pra todo `uploadAsset` do mesmo job (e do processo inteiro)
 * reaproveitar a mesma instância. */
let cachedClient: SupabaseClient | null = null;
let cachedClientKey: string | null = null;

export function getSupabaseClient(config: StudioNodeConfig): SupabaseClient {
  const key = `${config.SUPABASE_URL}:${config.SUPABASE_SECRET_KEY}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY);
    cachedClientKey = key;
  }
  return cachedClient;
}

const UPLOAD_ATTEMPTS = 3;

/**
 * Upload direto pro Supabase Storage (ADR 0001) com a secret key (acesso
 * de servidor, ignora RLS de propósito: quem chama isso já é um processo
 * de confiança, não um usuário final).
 *
 * `upsert: true` faz o upload ser seguro de repetir (mesmo path sobrescreve
 * em vez de falhar com "already exists"), então uma falha de rede transitória
 * pode simplesmente tentar de novo sem regenerar a imagem - a GPU já foi
 * gasta, perder a imagem por um soluço de upload seria o pior desfecho.
 */
export async function uploadAsset(
  config: StudioNodeConfig,
  path: string,
  content: string | Buffer,
  contentType: string,
): Promise<string> {
  const supabase = getSupabaseClient(config);

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).upload(path, content, {
      contentType,
      upsert: true,
    });
    if (!error) {
      const { data } = supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    }
    lastError = error.message;
    if (attempt < UPLOAD_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`Supabase Storage upload failed after ${UPLOAD_ATTEMPTS} attempts: ${lastError}`);
}
