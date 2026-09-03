import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface SupabaseClaims {
  sub: string;
  email: string;
  raw: Record<string, unknown>;
}

// Um Map em vez de uma única variável: um singleton fixo na primeira
// supabaseUrl chamada travava silenciosamente em um projeto errado se esta
// função rodasse contra mais de uma URL no mesmo processo (multi-tenant,
// teste apontando pra outro projeto etc). Na prática hoje só existe um
// SUPABASE_URL por processo, mas o Map custa nada e remove a armadilha.
const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  // jose já faz cache/retry do JWKS remoto internamente; um único set por
  // URL por processo é suficiente (o projeto Supabase não muda em runtime).
  let set = jwksByUrl.get(supabaseUrl);
  if (!set) {
    set = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
    jwksByUrl.set(supabaseUrl, set);
  }
  return set;
}

/**
 * Valida o access_token emitido pelo Supabase Auth (ADR 0001: o frontend
 * autentica direto com o Supabase, nunca com um JWT nosso). Usa as chaves
 * públicas do projeto (JWKS), formato assimétrico novo do Supabase, sem
 * precisar de nenhum segredo compartilhado aqui.
 *
 * audience/issuer explícitos: sem isso, qualquer JWT assinado pelas mesmas
 * chaves do projeto mas emitido pra outro propósito (aud diferente de
 * "authenticated") passava contanto que tivesse sub/email, já que jose só
 * valida assinatura e expiração por padrão.
 */
export async function verifySupabaseToken(token: string, supabaseUrl: string): Promise<SupabaseClaims> {
  const { payload } = await jwtVerify(token, getJwks(supabaseUrl), {
    audience: 'authenticated',
    issuer: `${supabaseUrl}/auth/v1`,
  });

  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new Error('Supabase token is missing sub or email claims');
  }

  return { sub, email, raw: payload as Record<string, unknown> };
}
