'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * MODO EU do Daily Tasks: só o que está atribuído a quem está olhando. Vale para Tarefas e Calendário ao mesmo tempo
 * (o botão mora na barra do Daily) e fica lembrado neste navegador. Sem storage (aba anônima), começa desligado e
 * funciona na sessão.
 */
const CHAVE = 'dt:modo-eu';
const EVENTO = 'dt:modo-eu';
let naMemoria = false;

function ler(): boolean {
  try { return localStorage.getItem(CHAVE) === 'on'; } catch { return naMemoria; }
}

function assinar(aviso: () => void): () => void {
  const noStorage = (e: StorageEvent) => { if (e.key === CHAVE) aviso(); };
  window.addEventListener(EVENTO, aviso);
  window.addEventListener('storage', noStorage);
  return () => { window.removeEventListener(EVENTO, aviso); window.removeEventListener('storage', noStorage); };
}

export function useModoEu(): [boolean, (ligado: boolean) => void] {
  const ligado = useSyncExternalStore(assinar, ler, () => false);
  const definir = useCallback((v: boolean) => {
    naMemoria = v;
    try { localStorage.setItem(CHAVE, v ? 'on' : 'off'); } catch { /* sem storage: vale só na memória */ }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return [ligado, definir];
}
