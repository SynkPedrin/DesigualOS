import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Chaveado por (url, key) em vez de uma única variável: um singleton fixo
// na primeira chamada ignorava silenciosamente supabaseUrl/secretKey de
// toda chamada seguinte, então uma credencial rotacionada em runtime (ou
// um teste passando outro projeto) continuava usando o cliente antigo.
const clientsByKey = new Map<string, SupabaseClient>();

/**
 * Cliente admin do Supabase (service role, ignora RLS de propósito).
 * Usado só em contextos de confiança do servidor: convite de usuário,
 * nunca exposto ao frontend.
 */
export function getSupabaseAdminClient(supabaseUrl: string, secretKey: string): SupabaseClient {
  const cacheKey = `${supabaseUrl}::${secretKey}`;
  let client = clientsByKey.get(cacheKey);
  if (!client) {
    client = createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    clientsByKey.set(cacheKey, client);
  }
  return client;
}
