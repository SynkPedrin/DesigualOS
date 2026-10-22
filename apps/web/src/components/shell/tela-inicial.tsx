'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMyWorkspace } from '@/hooks/use-my-workspace';

/**
 * TELA INICIAL POR PESSOA. Quem tem `home_path` (ex.: a Tammy, '/gestao') cai
 * nela ao entrar no sistema — a primeira visita da sessão a '/'. Depois disso,
 * '/' volta a ser a Visão geral: sem isto, clicar em "Visão geral" no menu
 * levaria de volta para a tela inicial e a Visão geral ficaria inalcançável.
 */
const CHAVE = 'desigual-os:tela-inicial-aplicada';

export function TelaInicial() {
  const pathname = usePathname();
  const router = useRouter();
  const workspace = useMyWorkspace();
  const aplicada = useRef(false);
  const destino = workspace.data?.home_path;

  useEffect(() => {
    if (aplicada.current || !workspace.isSuccess) return;
    let jaNestaSessao = false;
    try { jaNestaSessao = window.sessionStorage.getItem(CHAVE) === '1'; window.sessionStorage.setItem(CHAVE, '1'); } catch { /* sem armazenamento: vale só para esta montagem */ }
    aplicada.current = true;
    if (!jaNestaSessao && pathname === '/' && destino && destino !== '/') router.replace(destino);
  }, [workspace.isSuccess, destino, pathname, router]);

  return null;
}
