'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, ImageIcon, Layers, Maximize2, Play, User } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelativeTime } from '@/lib/format';
import { downloadStudioGroup } from '@/lib/studio-actions';
import { toast } from '@/stores/toast-store';
import { useClients } from '@/hooks/use-clients';
import { AssetActionsMenu } from './asset-actions-menu';
import { AssetLightbox, AssetPreview, QUALITY_LABELS, TYPE_LABELS, isVideoAsset } from './asset-lightbox';
import type { StudioAsset } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/**
 * Assets de um mesmo job de carousel (slidesTotal>1) OU de um job de
 * "variações" (variationsTotal>1, várias imagens do mesmo prompt num job só)
 * compartilham `jobId` (ver nodes/studio-node/src/index.ts) - agrupa pra
 * virar um único card, em vez de N cards soltos sem contexto de que são a
 * mesma peça.
 *
 * Achado real (2026-09-11): só o caminho de carousel (`slidesTotal`) entrava
 * aqui - `variationsTotal`/`variationIndex` existiam no job/worker e na API
 * há tempos, mas o mapeamento do wire pro frontend (mapStudioAsset) nunca os
 * lia, então SEMPRE chegavam como `null` aqui, e um job de "4 variações"
 * virava 4 cards soltos e sem relação nenhuma na galeria, cada um exigindo
 * exclusão individual. Corrigido junto (ver contracts.ts).
 */
export function groupAssets(assets: StudioAsset[]): StudioAsset[][] {
  const byJob = new Map<string, StudioAsset[]>();
  const groups: StudioAsset[][] = [];

  for (const asset of assets) {
    const groupSize = Math.max(asset.slidesTotal ?? 1, asset.variationsTotal ?? 1);
    if (asset.jobId && groupSize > 1) {
      const list = byJob.get(asset.jobId) ?? [];
      list.push(asset);
      byJob.set(asset.jobId, list);
      if (list.length === 1) groups.push(list);
    } else {
      groups.push([asset]);
    }
  }

  for (const group of groups) {
    if (group.length > 1) {
      group.sort((a, b) => (a.slideIndex ?? a.variationIndex ?? 0) - (b.slideIndex ?? b.variationIndex ?? 0));
    }
  }
  // `assets` já vem ordenado por created_at desc da API; groups preserva essa
  // ordem porque cada grupo nasce na posição do primeiro asset encontrado.
  return groups;
}

/** Badge de duração pra vídeo/reels: lê os metadados de verdade do arquivo. */
function VideoDurationBadge({ src }: { src: string }) {
  const [duration, setDuration] = useState<number | null>(null);
  if (duration === null) {
    return (
      <video
        src={src}
        preload="metadata"
        muted
        className="hidden"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      />
    );
  }
  if (!Number.isFinite(duration)) return null;
  return (
    <span className="absolute bottom-2 right-2 rounded bg-carbono/80 px-1.5 py-0.5 font-mono text-[9px] text-branco-cru">
      {Math.round(duration)}s
    </span>
  );
}

/** "N slides" pro carousel, "N variações" pro job de variações - mesmo
 * `groupAssets` acima, distingue pelo campo que realmente está preenchido. */
function groupUnitLabel(asset: StudioAsset, groupSize: number): string {
  if (groupSize <= 1) return '';
  return (asset.slidesTotal ?? 0) > 1 ? ` · ${groupSize} slides` : ` · ${groupSize} variações`;
}

function TypeBadge({ asset, groupSize }: { asset: StudioAsset; groupSize: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-grafite-elevado bg-carbono/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-nevoa">
      {groupSize > 1 && <Layers size={9} className="text-roxo-eletrico" />}
      {TYPE_LABELS[asset.type] ?? asset.type}
      {groupUnitLabel(asset, groupSize)}
    </span>
  );
}

function CardMedia({ group, onOpen }: { group: StudioAsset[]; onOpen: (asset: StudioAsset) => void }) {
  const first = group[0]!;
  const video = isVideoAsset(first);

  return (
    <button
      type="button"
      onClick={() => onOpen(first)}
      className="group/media relative block w-full overflow-hidden"
      aria-label={`Visualizar ${first.prompt || first.filename}`}
    >
      <AssetPreview
        asset={first}
        variant="thumb"
        className="aspect-square w-full object-cover transition-transform duration-300 group-hover/media:scale-[1.03]"
      />
      {video && (
        <>
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-carbono/70 backdrop-blur-sm transition-transform group-hover/media:scale-110">
              <Play size={18} className="ml-0.5 text-branco-cru" />
            </span>
          </span>
          <VideoDurationBadge src={first.storageUrl} />
        </>
      )}
      {!video && (
        <span className="absolute inset-0 flex items-center justify-center bg-carbono/50 opacity-0 transition-opacity group-hover/media:opacity-100">
          <Maximize2 size={20} className="text-branco-cru" />
        </span>
      )}
      <span className="absolute left-2 top-2">
        <TypeBadge asset={first} groupSize={group.length} />
      </span>
    </button>
  );
}

function DownloadButton({ group }: { group: StudioAsset[] }) {
  const [downloading, setDownloading] = useState(false);
  const isGroup = group.length > 1;

  async function handleClick() {
    setDownloading(true);
    try {
      await downloadStudioGroup(group);
      toast(isGroup ? 'Download do .zip iniciado.' : 'Download iniciado.', 'success');
    } catch {
      toast('Não foi possível baixar. Tente de novo.', 'error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={downloading}
      className="flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11px] text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-50"
    >
      <Download size={12} />
      {downloading ? 'Compactando…' : isGroup ? 'Baixar tudo (.zip)' : 'Baixar'}
    </button>
  );
}

function AssetGroupCard({
  group,
  clientName,
  highlightAssetId,
  insideStudio,
  onOpen,
}: {
  group: StudioAsset[];
  clientName: string | null;
  highlightAssetId?: string | null | undefined;
  insideStudio: boolean;
  onOpen: (group: StudioAsset[], assetId?: string) => void;
}) {
  const first = group[0]!;
  const highlighted = group.some((asset) => asset.id === highlightAssetId);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'group overflow-hidden rounded-lg border border-grafite-elevado bg-grafite shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-roxo-eletrico/30 hover:shadow-elevated',
        highlighted && 'ring-2 ring-sinal',
      )}
    >
      <CardMedia group={group} onOpen={(asset) => onOpen(group, asset.id)} />

      <div className="p-3">
        <p className="line-clamp-2 min-h-8 text-xs font-medium text-branco-cru" title={first.prompt}>
          {first.prompt || first.filename}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {first.qualityPreset && (
            <span className="rounded-full bg-roxo-eletrico/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-violeta-sutil">
              {QUALITY_LABELS[first.qualityPreset] ?? first.qualityPreset}
            </span>
          )}
          {clientName && (
            <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-nevoa">
              {clientName}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-nevoa">
          {first.createdBy ? (
            <span className="flex min-w-0 items-center gap-1 truncate">
              <User size={9} className="shrink-0" />
              {first.createdBy}
            </span>
          ) : (
            <span />
          )}
          <span className="shrink-0">{formatRelativeTime(first.createdAt)}</span>
        </div>

        <div className="mt-2 flex items-center gap-1 border-t border-grafite-elevado pt-2">
          <button
            type="button"
            onClick={() => onOpen(group, first.id)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11px] text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
          >
            <Maximize2 size={12} />
            Visualizar
          </button>
          <DownloadButton group={group} />
          <AssetActionsMenu
            group={group}
            insideStudio={insideStudio}
            onView={() => onOpen(group, first.id)}
            onDetails={() => onOpen(group, first.id)}
          />
        </div>
      </div>
    </motion.article>
  );
}

function AssetGroupRow({
  group,
  clientName,
  highlightAssetId,
  insideStudio,
  onOpen,
}: {
  group: StudioAsset[];
  clientName: string | null;
  highlightAssetId?: string | null | undefined;
  insideStudio: boolean;
  onOpen: (group: StudioAsset[], assetId?: string) => void;
}) {
  const first = group[0]!;
  const highlighted = group.some((asset) => asset.id === highlightAssetId);
  const video = isVideoAsset(first);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5 shadow-card transition-colors hover:border-roxo-eletrico/30',
        highlighted && 'ring-2 ring-sinal',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(group, first.id)}
        aria-label={`Visualizar ${first.prompt || first.filename}`}
        className="relative shrink-0 overflow-hidden rounded-md"
      >
        <AssetPreview asset={first} className="size-12 object-cover" />
        {video && (
          <span className="absolute inset-0 flex items-center justify-center bg-carbono/40">
            <Play size={12} className="text-branco-cru" />
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-branco-cru">{first.prompt || first.filename}</p>
        <p className="mt-0.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-nevoa">
          <span>
            {TYPE_LABELS[first.type] ?? first.type}
            {groupUnitLabel(first, group.length)}
          </span>
          {first.qualityPreset && <span>{QUALITY_LABELS[first.qualityPreset] ?? first.qualityPreset}</span>}
          {clientName && <span className="truncate">{clientName}</span>}
        </p>
      </div>

      <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-wider text-nevoa sm:block">
        {formatRelativeTime(first.createdAt)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onOpen(group, first.id)}
          aria-label="Visualizar"
          className="rounded-md p-1.5 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
        >
          <Maximize2 size={13} />
        </button>
        <DownloadButton group={group} />
        <AssetActionsMenu
          group={group}
          insideStudio={insideStudio}
          onView={() => onOpen(group, first.id)}
          onDetails={() => onOpen(group, first.id)}
        />
      </div>
    </motion.div>
  );
}

export function AssetGallery({
  assets,
  view = 'grid',
  insideStudio = false,
  highlightAssetId,
}: {
  assets: StudioAsset[];
  view?: 'grid' | 'list';
  insideStudio?: boolean;
  highlightAssetId?: string | null | undefined;
}) {
  const [open, setOpen] = useState<{ group: StudioAsset[]; assetId?: string | undefined } | null>(null);
  const groups = useMemo(() => groupAssets(assets), [assets]);
  const { data: clients } = useClients();
  const clientNameById = useMemo(() => new Map(clients?.map((client) => [client.id, client.name]) ?? []), [clients]);

  // Notificação de job concluído leva pra cá com ?asset=<id>: abre direto a
  // peça que acabou de ficar pronta, em vez de largar a pessoa na grade.
  useEffect(() => {
    if (!highlightAssetId) return;
    const group = groups.find((candidate) => candidate.some((asset) => asset.id === highlightAssetId));
    if (group) setOpen({ group, assetId: highlightAssetId });
  }, [highlightAssetId, groups]);

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
      {view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {groups.map((group) => (
            <AssetGroupCard
              key={group.length > 1 ? (group[0]!.jobId ?? group[0]!.id) : group[0]!.id}
              group={group}
              clientName={clientNameById.get(group[0]!.clientId) ?? null}
              highlightAssetId={highlightAssetId}
              insideStudio={insideStudio}
              onOpen={(nextGroup, assetId) => setOpen({ group: nextGroup, assetId })}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <AssetGroupRow
              key={group.length > 1 ? (group[0]!.jobId ?? group[0]!.id) : group[0]!.id}
              group={group}
              clientName={clientNameById.get(group[0]!.clientId) ?? null}
              highlightAssetId={highlightAssetId}
              insideStudio={insideStudio}
              onOpen={(nextGroup, assetId) => setOpen({ group: nextGroup, assetId })}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <AssetLightbox group={open.group} initialAssetId={open.assetId} onClose={() => setOpen(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
