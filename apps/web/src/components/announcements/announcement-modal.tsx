'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MessagesSquare, Sparkles, X, type LucideIcon } from 'lucide-react';
import type { Anuncio } from '@/hooks/use-announcements';

/**
 * O MODAL DE NOVIDADE. Genérico (serve a qualquer anúncio): selo, ícone, título,
 * descrição, prévia real da tela e as duas ações. Esc e o X fecham — e fechar
 * conta como "explorar depois", nunca prende a pessoa.
 */

const ICONES: Record<string, LucideIcon> = { MessagesSquare, Sparkles };

export function AnnouncementModal({ anuncio, onPrincipal, onSecundario, onFechar }: { anuncio: Anuncio; onPrincipal: () => void; onSecundario: () => void; onFechar: () => void }) {
  const principal = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [imagem, setImagem] = useState<'carregando' | 'ok' | 'falhou'>(anuncio.preview_image_url ? 'carregando' : 'falhou');
  const Icone = ICONES[anuncio.icon ?? ''] ?? Sparkles;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    principal.current?.focus({ preventScroll: true });
    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); onFechar(); return; }
      if (ev.key === 'Tab' && caixa.current) {
        const focaveis = [...caixa.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
        const primeiro = focaveis[0];
        const ultimo = focaveis.at(-1);
        if (!primeiro || !ultimo) return;
        if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
        else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
      }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => { document.removeEventListener('keydown', aoTeclar); anterior?.focus?.({ preventScroll: true }); };
  }, [onFechar]);

  return (
    <motion.div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-carbono/75 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onFechar}
    >
      <motion.div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby="anuncio-titulo"
        aria-describedby="anuncio-descricao"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-grafite-elevado bg-grafite shadow-2xl sm:max-w-[560px] sm:rounded-2xl"
      >
        <button type="button" onClick={onFechar} aria-label="Fechar" className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru">
          <X size={16} />
        </button>

        {/* Prévia real da tela: imagem da própria Comunicação, recortada. */}
        <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-grafite-elevado bg-carbono">
          {anuncio.preview_image_url && imagem !== 'falhou' && (
            <img
              src={anuncio.preview_image_url}
              alt="Prévia da tela de Comunicação do Desigual OS"
              className={`h-full w-full object-cover object-top transition-opacity duration-300 ${imagem === 'ok' ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImagem('ok')}
              onError={() => setImagem('falhou')}
            />
          )}
          {imagem !== 'ok' && (
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
              {imagem === 'carregando'
                ? <div className="h-full w-full animate-pulse bg-grafite-elevado/40" />
                : <Icone size={56} className="text-roxo-eletrico/60" />}
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-grafite to-transparent" aria-hidden />
        </div>

        <div className="px-6 pb-6 pt-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-roxo-eletrico/15 text-roxo-eletrico" aria-hidden><Icone size={17} /></span>
            <span className="rounded-full bg-sinal/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-sinal">Novidade</span>
          </div>
          <h2 id="anuncio-titulo" className="font-heading text-xl font-semibold leading-snug text-branco-cru">{anuncio.title}</h2>
          {anuncio.subtitle && <p className="mt-1 text-sm font-medium text-branco-cru/80">{anuncio.subtitle}</p>}
          <p id="anuncio-descricao" className="mt-3 text-sm leading-relaxed text-nevoa">{anuncio.description}</p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {anuncio.secondary_cta && (
              <button type="button" onClick={onSecundario} className="rounded-md border border-grafite-elevado px-4 py-2 text-sm text-branco-cru transition-colors hover:border-roxo-eletrico/60">
                {anuncio.secondary_cta.label}
              </button>
            )}
            <button ref={principal} type="button" onClick={onPrincipal} className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
              {anuncio.primary_cta.label}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
