'use client';

import { useCallback, useEffect, useState } from 'react';
import { Player } from '@remotion/player';
import { X } from 'lucide-react';
import { useMe } from '@/hooks/use-me';
import { DURACAO_TOTAL_EM_FRAMES, FPS } from './roteiro';
import { TutorialVideo } from './tutorial-video';

/**
 * QUANDO O TUTORIAL APARECE SOZINHO: uma vez, no primeiro acesso da conta.
 *
 * A marca fica em `localStorage`, por usuário. Isso é uma escolha com um limite
 * conhecido, e vale dizer qual: quem entrar de outro navegador vê de novo. A
 * alternativa seria uma coluna em `users` e uma migração, e o preço de ver o
 * tutorial duas vezes é menor que o de uma mudança de schema só pra isso.
 *
 * A chave leva o id do usuário de propósito: sem isso, a segunda pessoa a usar
 * o mesmo navegador nunca veria o tutorial, que é exatamente quem mais precisa.
 */
function chaveDoUsuario(userId: string): string {
  return `desigual-os:tutorial-visto:${userId}`;
}

export function useTutorial() {
  const { data: eu } = useMe();
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!eu?.id) return;
    try {
      if (window.localStorage.getItem(chaveDoUsuario(eu.id))) return;
      setAberto(true);
    } catch {
      // localStorage bloqueado (janela anônima, cookies desligados): o tutorial
      // simplesmente não abre sozinho. Nunca vale quebrar a entrada no sistema
      // por causa de um vídeo de boas-vindas.
    }
  }, [eu?.id]);

  const marcarComoVisto = useCallback(() => {
    if (!eu?.id) return;
    try {
      window.localStorage.setItem(chaveDoUsuario(eu.id), new Date().toISOString());
    } catch {
      /* ver acima */
    }
  }, [eu?.id]);

  const fechar = useCallback(() => {
    setAberto(false);
    marcarComoVisto();
  }, [marcarComoVisto]);

  return { aberto, abrir: () => setAberto(true), fechar };
}

export function TutorialModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-carbono/90 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial do Desigual OS"
      onClick={onFechar}
    >
      <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-heading text-base font-semibold text-branco-cru">Como usar o Desigual OS</p>
          <button
            type="button"
            onClick={onFechar}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-nevoa transition-colors hover:text-branco-cru"
          >
            Fechar <X size={16} />
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-grafite-elevado bg-carbono">
          <Player
            component={TutorialVideo}
            durationInFrames={DURACAO_TOTAL_EM_FRAMES}
            fps={FPS}
            compositionWidth={1920}
            compositionHeight={1080}
            style={{ width: '100%' }}
            controls
            autoPlay
            // Sem loop: o tutorial termina e a pessoa volta ao trabalho. Vídeo
            // de boas-vindas que recomeça sozinho vira ruído na segunda volta.
            loop={false}
          />
        </div>

        <p className="mt-3 text-center text-xs text-nevoa">
          Você pode fechar a qualquer momento. O botão Tutorial, no topo, traz este guia de volta.
        </p>
      </div>
    </div>
  );
}
