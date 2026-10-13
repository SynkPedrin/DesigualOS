'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, wireSupabaseAccessToken } from '@/lib/supabase/client';
import { setOnAccountDeactivated } from '@/lib/api/client';

/** Keeps apiFetch's Authorization header synced to the live Supabase session, and
 *  shows ONE honest screen when the account itself is deactivated — instead of
 *  every page guessing its own (wrong) reason for the 403 it got back. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [contaDesativada, setContaDesativada] = useState(false);
  const queryClient = useQueryClient();
  const usuarioAtual = useRef<string | null>(null);

  useEffect(() => {
    wireSupabaseAccessToken();
    setOnAccountDeactivated(() => setContaDesativada(true));

    /**
     * TRAVA DE TROCA DE CONTA (13/10/2026, incidente real): o master aceitou
     * um convite na mesma aba em que estava logado e a tela continuou dizendo
     * "super" com a sessão já trocada. Login/convite/sair agora navegam com
     * reload inteiro (cache novo), mas este listener cobre o que escapa: a
     * sessão trocar SEM passar por essas telas (outra aba, refresh de token
     * depois de um convite, etc.). Conta diferente entrando = todo o cache de
     * dados da conta anterior é apagado na hora.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const id = session?.user.id ?? null;
      if (event === 'SIGNED_IN' && id && usuarioAtual.current && id !== usuarioAtual.current) {
        queryClient.clear();
      }
      usuarioAtual.current = id;
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  if (contaDesativada) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-carbono p-6">
        <div className="max-w-sm rounded-lg border border-grafite-elevado bg-grafite p-6 text-center">
          <h1 className="font-heading text-lg font-semibold text-branco-cru">Esta conta foi desativada</h1>
          <p className="mt-2 text-sm text-nevoa">
            Não é um problema do sistema nem de conexão — a conta que fez login foi desativada por quem administra.
            Peça para reativá-la, ou entre com outra conta.
          </p>
          <button
            type="button"
            onClick={() => supabase.auth.signOut().then(() => window.location.replace('/login'))}
            className="mt-4 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-opacity hover:opacity-90"
          >
            Sair e entrar com outra conta
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
