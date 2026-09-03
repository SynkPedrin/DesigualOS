'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { useSupabaseSession } from '@/hooks/use-supabase-session';

/** Every route in this group requires a Supabase session; unauthenticated visitors bounce to /login. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, isLoading } = useSupabaseSession();

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/login');
    }
  }, [isLoading, session, router]);

  if (isLoading || !session) {
    return <div className="h-screen bg-carbono" />;
  }

  return <AppShell>{children}</AppShell>;
}
