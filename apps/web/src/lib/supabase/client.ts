import { createBrowserClient } from '@supabase/ssr';
import { setAccessTokenAsyncProvider, setAccessTokenProvider } from '@/lib/api/client';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/**
 * Direct browser-to-Supabase Auth client. There is no login screen of our own beyond the UI
 * shell: this talks to Supabase directly with the publishable key (safe to expose client-side
 * by design), per the architecture already agreed with the backend team. Independent of
 * NEXT_PUBLIC_API_MODE: the Orchestrator being mocked or live has no bearing on auth.
 *
 * Uses @supabase/ssr's browser client (cookie-backed session storage) instead of plain
 * @supabase/supabase-js (which defaults to localStorage): src/proxy.ts needs to read the same
 * session from the request cookies to gate (shell) routes server-side, so client and server
 * have to agree on where the session lives.
 */
export const supabase = createBrowserClient(supabaseUrl, supabasePublishableKey);

let tokenProviderWired = false;

/** Keeps apiFetch's Authorization header in sync with the current Supabase session. Call
 * once from the root layout. */
export function wireSupabaseAccessToken() {
  if (tokenProviderWired) return;
  tokenProviderWired = true;

  let currentToken: string | null = null;
  setAccessTokenProvider(() => currentToken);

  // O getSession inicial é a fonte da verdade do boot; quem chegar antes
  // dele espera essa promise (com teto de 2s pra nunca pendurar a UI se a
  // auth travar) em vez de disparar sem token. Depois do boot, o provider
  // síncrono acima já tem o token e este caminho nem é consultado.
  const initialSession = supabase.auth.getSession().then(({ data }) => {
    currentToken = data.session?.access_token ?? null;
    return currentToken;
  });
  setAccessTokenAsyncProvider(() =>
    Promise.race([
      initialSession,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]).catch(() => null),
  );

  supabase.auth.onAuthStateChange((_event, session) => {
    currentToken = session?.access_token ?? null;
  });
}

// Wiring em ESCOPO DE MÓDULO, não em useEffect: efeitos de filhos rodam
// antes dos pais, então queries montadas abaixo do auth-provider disparavam
// /me sem token (401 garantido em toda carga de página, medido na auditoria
// de performance). O guard `tokenProviderWired` torna a chamada do
// auth-provider um no-op idempotente. createBrowserClient acima já executa
// no import, então isto não amplia a superfície de SSR.
wireSupabaseAccessToken();
