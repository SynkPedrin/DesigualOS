'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { BrandProvider } from '@/components/shell/brand-provider';
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

  /**
   * A marca da empresa entra aqui, por fora do shell: qualquer tela dentro
   * re-tematiza sozinha, sem saber que existe tenant — do mesmo jeito que o
   * tema claro já funciona. Ver brand-provider.tsx.
   */
  return (
    <BrandProvider>
      <AppShell>{children}</AppShell>
    </BrandProvider>
  );
}
