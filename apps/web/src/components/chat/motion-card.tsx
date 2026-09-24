'use client';

import { useState } from 'react';
import { motion as fm } from 'framer-motion';
import { AlertTriangle, Download, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useMotion, useRerenderMotion, useUpdateMotion } from '@/hooks/use-motion';
import { cn } from '@/lib/utils';

/** O bloco que o worker grava em messages.metadata.motion (ver motion-guard.ts). */
export interface ChatMotionRef {
  motion_id: string;
  status?: string;
  format?: string;
  duration_seconds?: number;
  fps?: number;
  width?: number;
  height?: number;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * §16/§40 — o motion dentro do chat do Otto.
 *
 * Enquanto trabalha, mostra o estágio em linguagem de ofício ("Montando o
 * storyboard"), nunca webpack/spawn/ffmpeg (§39). Pronto, vira player com as
 * ações do §40.
 */
export function MotionCard({ reference }: { reference: ChatMotionRef }) {
  const { data, isLoading } = useMotion(reference.motion_id);
  const rerender = useRerenderMotion(reference.motion_id);
  const update = useUpdateMotion(reference.motion_id);
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState('');

  const status = data?.status ?? reference.status ?? 'queued';
  const working = !TERMINAL.has(status);
  const videoUrl = data?.finalUrl ?? data?.previewUrl ?? null;
  const width = data?.width ?? reference.width ?? 1080;
  const height = data?.height ?? reference.height ?? 1920;
  const isVertical = height > width;

  if (status === 'failed') {
    return (
      <Surface level="grafite" className="mt-2 max-w-[420px] overflow-hidden p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-aviso" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-branco-cru">{data?.error ?? 'O motion não ficou pronto.'}</p>
            <button
              type="button"
              onClick={() => rerender.mutate()}
              disabled={rerender.isPending}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru/80 transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru disabled:opacity-50"
            >
              <RefreshCw size={12} className={cn(rerender.isPending && 'animate-spin')} />
              Tentar de novo
            </button>
          </div>
        </div>
      </Surface>
    );
  }

  return (
    <Surface level="grafite" className="mt-2 max-w-[420px] overflow-hidden">
      {working || !videoUrl ? (
        <div
          className={cn(
            'relative flex items-center justify-center bg-carbono/60',
            isVertical ? 'aspect-[9/16] max-h-[360px]' : 'aspect-video',
          )}
        >
          {/* Pulso lento em vez de barra de progresso: as etapas do motion não
              têm duração previsível, e uma barra que trava em 60% mente. */}
          <fm.div
            className="absolute inset-0 bg-gradient-to-br from-roxo-eletrico/12 via-transparent to-transparent"
            animate={{ opacity: [0.35, 0.85, 0.35] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative flex flex-col items-center gap-2 px-6 text-center">
            {isLoading ? (
              <Loader2 size={18} className="animate-spin text-branco-cru/50" />
            ) : (
              <Sparkles size={18} className="text-roxo-eletrico" />
            )}
            <span className="text-sm font-medium text-branco-cru">{data?.stage ?? 'Na fila'}</span>
            {data?.stageDetail ? <span className="text-xs text-branco-cru/50">{data.stageDetail}</span> : null}
          </div>
        </div>
      ) : (
        <video
          key={videoUrl}
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          className={cn('w-full bg-black', isVertical ? 'max-h-[360px]' : '')}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-grafite-elevado px-3 py-2 text-[11px] text-branco-cru/55">
        <span>{data?.durationSeconds ?? reference.duration_seconds ?? 15}s</span>
        <span aria-hidden>·</span>
        <span>
          {width}×{height}
        </span>
        <span aria-hidden>·</span>
        <span>{data?.fps ?? reference.fps ?? 30}fps</span>
        {data?.renderVersion ? (
          <>
            <span aria-hidden>·</span>
            <span>v{data.renderVersion}</span>
          </>
        ) : null}
      </div>

      {!working && videoUrl ? (
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-2.5 py-1.5 text-xs text-branco-cru/80 transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
          >
            <Pencil size={12} />
            Editar
          </button>
          <button
            type="button"
            onClick={() => rerender.mutate()}
            disabled={rerender.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-2.5 py-1.5 text-xs text-branco-cru/80 transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru disabled:opacity-50"
          >
            <RefreshCw size={12} className={cn(rerender.isPending && 'animate-spin')} />
            Renderizar
          </button>
          <a
            href={videoUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-2.5 py-1.5 text-xs text-branco-cru/80 transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
          >
            <Download size={12} />
            Baixar
          </a>
        </div>
      ) : null}

      {editing ? (
        <form
          className="flex gap-2 border-t border-grafite-elevado px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (instruction.trim().length < 3) return;
            update.mutate(instruction.trim());
            setInstruction('');
            setEditing(false);
          }}
        >
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="O que ajustar? Ex.: o CTA precisa entrar antes"
            className="min-w-0 flex-1 rounded-md border border-grafite-elevado bg-carbono/50 px-2.5 py-1.5 text-xs text-branco-cru outline-none placeholder:text-branco-cru/35 focus:border-roxo-eletrico/60"
          />
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Ajustar
          </button>
        </form>
      ) : null}
    </Surface>
  );
}
