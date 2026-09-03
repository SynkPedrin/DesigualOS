'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Cpu, Download, ImageIcon, Maximize2, User, X } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeTime } from '@/lib/format';
import { downloadAssetsAsZip } from '@/lib/zip-download';
import type { StudioAsset } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<string, string> = {
  image: 'Imagem',
  carousel: 'Carousel',
  video: 'Vídeo',
  reels: 'Reels',
  upscale: 'Upscale',
};

/** Vídeo e reels não renderizam em <img>; o resto do catálogo é imagem/SVG. */
function isVideo(asset: StudioAsset): boolean {
  return asset.type === 'video' || asset.type === 'reels' || /\.(mp4|webm|mov)$/i.test(asset.filename);
}

function AssetPreview({ asset, className }: { asset: StudioAsset; className?: string }) {
  if (isVideo(asset)) {
    return <video src={asset.storageUrl} controls className={className} />;
  }
  // <img> e não next/image: storage_url é externo (Supabase Storage), fora do loader do Next.
  return <img src={asset.storageUrl} alt={asset.prompt} className={className} />;
}

/**
 * Assets de um mesmo job de carousel compartilham `jobId` (ver
 * nodes/studio-node/src/index.ts) — agrupa pra virar um único card com
 * strip de slides, em vez de N cards soltos e sem contexto de que são a
 * mesma peça.
 */
function groupAssets(assets: StudioAsset[]): StudioAsset[][] {
  const byJob = new Map<string, StudioAsset[]>();
  const groups: StudioAsset[][] = [];

  for (const asset of assets) {
    if (asset.jobId && (asset.slidesTotal ?? 1) > 1) {
      const list = byJob.get(asset.jobId) ?? [];
      list.push(asset);
      byJob.set(asset.jobId, list);
      if (list.length === 1) groups.push(list);
    } else {
      groups.push([asset]);
    }
  }

  for (const group of groups) {
    if (group.length > 1) group.sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
  }
  // `assets` já vem ordenado por created_at desc da API; groups preserva essa
  // ordem porque cada grupo nasce na posição do primeiro asset encontrado.
  return groups;
}

function CopyCaptionButton({ caption }: { caption: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(caption).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex items-center gap-1 text-[10px] font-medium text-roxo-eletrico hover:underline"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copiado!' : 'Copiar legenda'}
    </button>
  );
}

/** Visualização em tela cheia com a ficha técnica completa que a spec pede. */
function AssetLightbox({ asset, onClose }: { asset: StudioAsset; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/90 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-grafite-elevado bg-carbono shadow-elevated md:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
          <AssetPreview asset={asset} className="max-h-[70vh] w-auto max-w-full object-contain" />
        </div>
        <div className="w-full shrink-0 space-y-4 p-5 md:w-80">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Ficha técnica</h3>
            <button type="button" onClick={onClose} aria-label="Fechar" className="text-nevoa hover:text-branco-cru">
              <X size={18} />
            </button>
          </div>

          <p className="text-sm text-branco-cru">{asset.prompt || 'Sem prompt registrado.'}</p>

          {asset.caption && (
            <div className="rounded-md border border-grafite-elevado bg-grafite p-2.5">
              <p className="text-xs text-branco-cru">{asset.caption}</p>
              <div className="mt-1.5">
                <CopyCaptionButton caption={asset.caption} />
              </div>
            </div>
          )}

          <dl className="space-y-2 font-mono text-[11px] text-nevoa">
            <div className="flex justify-between gap-3">
              <dt>Tipo</dt>
              <dd className="text-branco-cru">{TYPE_LABELS[asset.type] ?? asset.type}</dd>
            </div>
            {asset.slidesTotal && asset.slidesTotal > 1 && (
              <div className="flex justify-between gap-3">
                <dt>Slide</dt>
                <dd className="text-branco-cru">
                  {(asset.slideIndex ?? 0) + 1} de {asset.slidesTotal}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt>Criado por</dt>
              <dd className="truncate text-branco-cru">{asset.createdBy ?? 'não registrado'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Quando</dt>
              <dd className="text-branco-cru">{new Date(asset.createdAt).toLocaleString('pt-BR')}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Workflow</dt>
              <dd className="truncate text-branco-cru">{asset.model ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Máquina</dt>
              <dd className="truncate text-branco-cru">{asset.nodeId ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Arquivo</dt>
              <dd className="truncate text-branco-cru">{asset.filename}</dd>
            </div>
          </dl>

          <a
            href={asset.storageUrl}
            download={asset.filename}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
          >
            <Download size={14} />
            Baixar
          </a>
        </div>
      </div>
    </div>
  );
}

function AssetGroupCard({
  group,
  highlightAssetId,
  onOpen,
}: {
  group: StudioAsset[];
  highlightAssetId?: string | null | undefined;
  onOpen: (asset: StudioAsset) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const first = group[0]!;
  const caption = group.find((asset) => asset.caption)?.caption ?? null;
  const isGroup = group.length > 1;

  async function handleDownloadAll() {
    setDownloading(true);
    try {
      await downloadAssetsAsZip(
        group.map((asset) => ({ url: asset.storageUrl, filename: asset.filename })),
        `studio-${first.jobId ?? first.id}.zip`,
      );
    } catch {
      // downloadAssetsAsZip já propagou o erro só pra sair do try; sem toast
      // system no app ainda, então o botão volta ao normal e a pessoa tenta de novo.
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Surface
      level="grafite"
      className={cn(
        'overflow-hidden p-0',
        group.some((asset) => asset.id === highlightAssetId) && 'ring-2 ring-sinal',
      )}
    >
      {isGroup ? (
        <div className="flex gap-1 overflow-x-auto p-1">
          {group.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onOpen(asset)}
              className="relative shrink-0"
              aria-label={`Visualizar slide ${(asset.slideIndex ?? 0) + 1} de ${group.length}`}
            >
              <AssetPreview asset={asset} className="size-20 rounded-md object-cover" />
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(first)}
          className="group relative block w-full"
          aria-label={`Visualizar ${first.filename}`}
        >
          <AssetPreview asset={first} className="aspect-square w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-carbono/60 opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 size={20} className="text-branco-cru" />
          </span>
        </button>
      )}

      <div className="p-3">
        <p className="truncate text-xs text-branco-cru">{first.prompt}</p>
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-nevoa">
          <span>
            {TYPE_LABELS[first.type] ?? first.type}
            {isGroup ? ` · ${group.length} slides` : ''}
          </span>
          <span>{formatRelativeTime(first.createdAt)}</span>
        </div>

        <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-nevoa">
          {first.createdBy && (
            <p className="flex items-center gap-1 truncate">
              <User size={9} className="shrink-0" />
              {first.createdBy}
            </p>
          )}
          {first.nodeId && (
            <p className="flex items-center gap-1 truncate">
              <Cpu size={9} className="shrink-0" />
              {first.nodeId}
            </p>
          )}
        </div>

        {caption && (
          <div className="mt-2 rounded-md border border-grafite-elevado bg-carbono p-2">
            <p className="line-clamp-3 text-[11px] text-branco-cru">{caption}</p>
            <div className="mt-1">
              <CopyCaptionButton caption={caption} />
            </div>
          </div>
        )}

        <div className="mt-2 flex gap-1 border-t border-grafite-elevado pt-2 text-nevoa">
          <button
            type="button"
            onClick={() => onOpen(first)}
            className="flex flex-1 items-center justify-center gap-1 rounded p-1.5 text-[11px] transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
          >
            <Maximize2 size={12} />
            Visualizar
          </button>
          {isGroup ? (
            <button
              type="button"
              onClick={handleDownloadAll}
              disabled={downloading}
              className="flex flex-1 items-center justify-center gap-1 rounded p-1.5 text-[11px] transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-50"
            >
              <Download size={12} />
              {downloading ? 'Compactando…' : 'Baixar tudo (.zip)'}
            </button>
          ) : (
            <a
              href={first.storageUrl}
              download={first.filename}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1 rounded p-1.5 text-[11px] transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
            >
              <Download size={12} />
              Baixar
            </a>
          )}
        </div>
      </div>
    </Surface>
  );
}

export function AssetGallery({ assets, highlightAssetId }: { assets: StudioAsset[]; highlightAssetId?: string | null }) {
  const [openAsset, setOpenAsset] = useState<StudioAsset | null>(null);
  const groups = useMemo(() => groupAssets(assets), [assets]);

  // Notificação de job concluído leva pra cá com ?asset=<id>: abre direto a
  // peça que acabou de ficar pronta, em vez de largar a pessoa na grade.
  useEffect(() => {
    if (!highlightAssetId) return;
    const target = assets.find((asset) => asset.id === highlightAssetId);
    if (target) setOpenAsset(target);
  }, [highlightAssetId, assets]);

  if (assets.length === 0) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="Nenhum asset ainda"
        description="Gere o primeiro projeto para ver os resultados aqui."
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {groups.map((group) => (
          <AssetGroupCard
            key={group[0]!.jobId ?? group[0]!.id}
            group={group}
            highlightAssetId={highlightAssetId}
            onOpen={setOpenAsset}
          />
        ))}
      </div>

      {openAsset && <AssetLightbox asset={openAsset} onClose={() => setOpenAsset(null)} />}
    </>
  );
}
