import { createClient } from '@supabase/supabase-js';
import { setAccessTokenProvider } from '@/lib/api/client';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/**
 * Direct browser-to-Supabase Auth client. There is no login screen of our own beyond the UI
 * shell: this talks to Supabase directly with the publishable key (safe to expose client-side
 * by design), per the architecture already agreed with the backend team. Independent of
 * NEXT_PUBLIC_API_MODE: the Orchestrator being mocked or live has no bearing on auth.
 */
export const supabase = createClient(supabaseUrl, supabasePublishableKey);

let tokenProviderWired = false;

/** Keeps apiFetch's Authorization header in sync with the current Supabase session. Call
 * once from the root layout. */
export function wireSupabaseAccessToken() {
  if (tokenProviderWired) return;
  tokenProviderWired = true;

  let currentToken: string | null = null;
  setAccessTokenProvider(() => currentToken);

  supabase.auth.getSession().then(({ data }) => {
    currentToken = data.session?.access_token ?? null;
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    currentToken = session?.access_token ?? null;
  });
}
