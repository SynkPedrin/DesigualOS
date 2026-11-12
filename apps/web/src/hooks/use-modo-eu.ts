'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useMe } from '@/hooks/use-me';

/**
 * MODO EU do Daily Tasks: só o que está atribuído a quem está olhando. Vale para Tarefas e Calendário ao mesmo tempo
 * (o botão mora na barra do Daily) e fica lembrado neste navegador.
 *
 * Sem escolha guardada, COLABORADOR começa no Modo eu e master na visão da agência (12/11/2026): a Ana Luiza abria o
 * Daily pela primeira vez e via a agência inteira, quando o que ela precisa é do que é dela. Quem trocar uma vez fica
 * com a própria escolha.
 */
const CHAVE = 'dt:modo-eu';
const EVENTO = 'dt:modo-eu';
let naMemoria: 'on' | 'off' | '' = '';

/** 'on' | 'off' = escolha da pessoa; '' = ainda não escolheu (vale o padrão do papel). */
function ler(): string {
  try { return localStorage.getItem(CHAVE) ?? ''; } catch { return naMemoria; }
}

function assinar(aviso: () => void): () => void {
  const noStorage = (e: StorageEvent) => { if (e.key === CHAVE) aviso(); };
  window.addEventListener(EVENTO, aviso);
  window.addEventListener('storage', noStorage);
  return () => { window.removeEventListener(EVENTO, aviso); window.removeEventListener('storage', noStorage); };
}

export function useModoEu(): [boolean, (ligado: boolean) => void] {
  const escolha = useSyncExternalStore(assinar, ler, () => '');
  const papeis = useMe().data?.roles;
  const padrao = Boolean(papeis) && !papeis!.some((p) => p === 'master' || p === 'admin');
  const ligado = escolha === 'on' || (escolha !== 'off' && padrao);
  const definir = useCallback((v: boolean) => {
    naMemoria = v ? 'on' : 'off';
    try { localStorage.setItem(CHAVE, v ? 'on' : 'off'); } catch { /* sem storage: vale só na memória */ }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return [ligado, definir];
}
