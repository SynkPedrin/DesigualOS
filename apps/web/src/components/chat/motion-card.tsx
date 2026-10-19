'use client';

import { useState } from 'react';
import { motion as fm } from 'framer-motion';
import { AlertTriangle, Download, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useMotion, useRerenderMotion, useUpdateMotion } from '@/hooks/use-motion';
import type { MotionAssetsWire, MotionVersionWire } from '@/hooks/use-motion';
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

/** URL de uma versão específica: prefere o render final, cai pro preview. */
export function pickVersionUrl(versions: MotionVersionWire[], version: number): string | null {
  const ofVersion = versions.filter((entry) => entry.version === version && entry.url);
  return ofVersion.find((entry) => entry.quality === 'final')?.url ?? ofVersion[0]?.url ?? null;
}

/** Slug pro nome do arquivo: minúsculo, sem acento, sem espaço. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `<cliente>-<campanha>-motion-v<N>.mp4`; sem cliente/campanha conhecidos,
 * cai pra `cliente-motion-v<N>.mp4`. */
export function motionDownloadFilename(
  clientName: string | null | undefined,
  campaignName: string | null | undefined,
  version: number,
): string {
  const parts = [slugify(clientName ?? ''), slugify(campaignName ?? '')].filter(Boolean);
  const base = parts.length > 0 ? parts.join('-') : 'cliente';
  return `${base}-motion-v${version}.mp4`;
}

/** "Usando: ✓ Logo ✓ 3 fotografias" — flags do que o pipeline usou de fato,
 * sem paths técnicos (§39). */
export function assetSummaryParts(assets: MotionAssetsWire): string[] {
  const parts: string[] = [];
  if (assets.logo) parts.push('Logo');
  if (assets.images > 0) parts.push(`${assets.images} ${assets.images === 1 ? 'fotografia' : 'fotografias'}`);
  if (assets.videos > 0) parts.push(`${assets.videos} ${assets.videos === 1 ? 'vídeo' : 'vídeos'}`);
  return parts;
}

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
  /** Versão escolhida nos chips; null = a atual (renderVersion). */
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const status = data?.status ?? reference.status ?? 'queued';
  const working = !TERMINAL.has(status);
  const width = data?.width ?? reference.width ?? 1080;
  const height = data?.height ?? reference.height ?? 1920;
  const isVertical = height > width;

  const versions = data?.versions ?? [];
  const versionNumbers = [...new Set(versions.map((entry) => entry.version))].sort((a, b) => a - b);
  const currentVersion = data?.renderVersion || versionNumbers.at(-1) || null;
  const activeVersion = selectedVersion ?? currentVersion;
  const videoUrl =
    (selectedVersion !== null && activeVersion !== null ? pickVersionUrl(versions, activeVersion) : null) ??
    data?.finalUrl ??
    data?.previewUrl ??
    null;
  const assetParts = data?.assets ? assetSummaryParts(data.assets) : [];
  const downloadName = motionDownloadFilename(data?.clientName, data?.campaignName, activeVersion ?? 1);

  if (status === 'failed') {
    // 'failed' é estágio terminal no use-motion (TERMINAL): o polling para
    // aqui, então este card NÃO refaz chamada nenhuma sozinho. Em particular
    // no OPUS_UNAVAILABLE (quota semanal do Opus 5.5 esgotada) não existe
    // auto-retry — tentar de novo antes da quota renovar só geraria outra
    // falha igual. O botão continua manual: é a pessoa quem decide quando
    // faz sentido re-tentar.
    const opusDown = data?.errorCode === 'OPUS_UNAVAILABLE';
    return (
      <Surface level="grafite" className="mt-2 max-w-[420px] overflow-hidden p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-aviso" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-branco-cru">{data?.error ?? 'O motion não ficou pronto.'}</p>
            {opusDown ? (
              <p className="mt-2 text-xs leading-relaxed text-aviso/90">
                Quando a quota renovar, teste a conexão nas configurações do Motion Engine e tente de novo aqui.
              </p>
            ) : null}
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

      {versionNumbers.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-grafite-elevado px-3 py-2">
          {versionNumbers.map((version) => (
            <button
              key={version}
              type="button"
              onClick={() => setSelectedVersion(version)}
              aria-pressed={activeVersion === version}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] transition-colors',
                activeVersion === version
                  ? 'border-roxo-eletrico/70 bg-roxo-eletrico/15 text-branco-cru'
                  : 'border-grafite-elevado text-branco-cru/70 hover:border-roxo-eletrico/60 hover:text-branco-cru',
              )}
            >
              V{version}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-grafite-elevado px-3 py-2 text-[11px] text-branco-cru/55">
        <span>{data?.durationSeconds ?? reference.duration_seconds ?? 15}s</span>
        <span aria-hidden>·</span>
        <span>
          {width}×{height}
        </span>
        <span aria-hidden>·</span>
        <span>{data?.fps ?? reference.fps ?? 30}fps</span>
        {activeVersion ? (
          <>
            <span aria-hidden>·</span>
            <span>v{activeVersion}</span>
          </>
        ) : null}
      </div>

      {assetParts.length > 0 ? (
        <p className="flex flex-wrap gap-x-2 gap-y-0.5 px-3 pb-2 text-[11px] text-branco-cru/45">
          <span>Usando:</span>
          {assetParts.map((part) => (
            <span key={part}>✓ {part}</span>
          ))}
        </p>
      ) : null}

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
            download={downloadName}
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
