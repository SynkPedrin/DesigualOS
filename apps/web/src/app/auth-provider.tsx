'use client';

import { useEffect } from 'react';
import { wireSupabaseAccessToken } from '@/lib/supabase/client';

/** Keeps apiFetch's Authorization header synced to the live Supabase session. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    wireSupabaseAccessToken();
  }, []);

  return <>{children}</>;
}
