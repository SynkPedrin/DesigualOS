'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Copy, Download, Sparkles, X } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import { downloadAssetsAsZip } from '@/lib/zip-download';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useGenerateAssetCaption } from '@/hooks/use-studio-assets';
import { toast } from '@/stores/toast-store';
import type { StudioAsset } from '@/lib/api/contracts';

export const TYPE_LABELS: Record<string, string> = {
  image: 'Imagem',
  carousel: 'Carrossel',
  video: 'Vídeo',
  reels: 'Reel',
  upscale: 'Upscale',
};

export const QUALITY_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  standard: 'Padrão',
  high: 'Alta',
};

/** Vídeo e reels não renderizam em <img>; o resto do catálogo é imagem/SVG. */
export function isVideoAsset(asset: StudioAsset): boolean {
  return asset.type === 'video' || asset.type === 'reels' || /\.(mp4|webm|mov)$/i.test(asset.filename);
}

export function AssetPreview({
  asset,
  className,
  variant = 'full',
}: {
  asset: StudioAsset;
  className?: string;
  /** 'thumb' (grade da galeria): usa a thumbnail 480px webp gerada em
   * background quando existe - medido em 12/09/2026: a galeria baixava ~80MB
   * de originais Flux (2-17MB por imagem) só pra montar os cards. 'full'
   * (lightbox/download) segue no original. */
  variant?: 'thumb' | 'full';
}) {
  if (isVideoAsset(asset)) {
    return <video src={asset.storageUrl} controls={variant === 'full'} preload={variant === 'thumb' ? 'metadata' : 'auto'} className={className} />;
  }
  // <img> e não next/image: storage_url é externo (Supabase Storage), fora do loader do Next.
  const src = variant === 'thumb' ? (asset.thumbUrl ?? asset.storageUrl) : asset.storageUrl;
  return <img src={src} alt={asset.prompt} className={className} loading={variant === 'thumb' ? 'lazy' : 'eager'} decoding="async" />;
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

/** Botão manual - a única forma de gerar legenda hoje (nunca automático na criação
 * do job). Otto analisa a imagem já gerada + o briefing original + o BrandKit do
 * cliente (POST /studio/assets/:id/caption); "Gerar novamente" reaparece depois de
 * já existir uma, pra permitir tentar de novo sem sair da ficha técnica. */
function GenerateCaptionButton({ assetId, hasCaption }: { assetId: string; hasCaption: boolean }) {
  const generateCaption = useGenerateAssetCaption();

  return (
    <button
      type="button"
      disabled={generateCaption.isPending}
      onClick={() =>
        generateCaption.mutate(assetId, {
          onError: () => toast('Não foi possível gerar a legenda. Tente de novo.', 'error'),
        })
      }
      className="flex items-center gap-1 text-[10px] font-medium text-roxo-eletrico transition-opacity hover:underline disabled:opacity-50"
    >
      <Sparkles size={11} />
      {generateCaption.isPending ? 'Gerando…' : hasCaption ? 'Gerar novamente' : 'Gerar legenda com Otto'}
    </button>
  );
}

/** Visualização em tela cheia: navega slides de carrossel (setas + teclado),
 * vídeo com controles nativos e a ficha técnica completa da peça. */
export function AssetLightbox({
  group,
  initialAssetId,
  onClose,
}: {
  group: StudioAsset[];
  initialAssetId?: string | undefined;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => {
    const found = group.findIndex((asset) => asset.id === initialAssetId);
    return found >= 0 ? found : 0;
  });
  const [downloading, setDownloading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  const asset = group[Math.min(index, group.length - 1)]!;
  const isGroup = group.length > 1;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (!isGroup) return;
      if (event.key === 'ArrowLeft') setIndex((current) => (current - 1 + group.length) % group.length);
      if (event.key === 'ArrowRight') setIndex((current) => (current + 1) % group.length);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, group.length, isGroup]);

  async function handleDownload() {
    if (!isGroup) return; // asset único baixa pelo <a> direto
    setDownloading(true);
    try {
      await downloadAssetsAsZip(
        group.map((item) => ({ url: item.storageUrl, filename: item.filename })),
        `studio-${asset.jobId ?? asset.id}.zip`,
      );
      toast('Download do .zip iniciado.', 'success');
    } catch {
      toast('Não foi possível baixar o .zip. Tente de novo.', 'error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/90 p-4 backdrop-blur-sm md:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Visualizar ${asset.filename}`}
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-grafite-elevado bg-grafite shadow-elevated md:flex-row"
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-h-[40vh] flex-1 items-center justify-center bg-black/50 p-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={asset.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
              className="flex max-h-full items-center justify-center"
            >
              <AssetPreview asset={asset} className="max-h-[72vh] w-auto max-w-full rounded-md object-contain" />
            </motion.div>
          </AnimatePresence>

          {isGroup && (
            <>
              <button
                type="button"
                onClick={() => setIndex((current) => (current - 1 + group.length) % group.length)}
                aria-label="Slide anterior"
                className="absolute left-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-grafite-elevado bg-carbono/80 text-branco-cru transition-all hover:border-roxo-eletrico/60 hover:text-roxo-eletrico"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => setIndex((current) => (current + 1) % group.length)}
                aria-label="Próximo slide"
                className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-grafite-elevado bg-carbono/80 text-branco-cru transition-all hover:border-roxo-eletrico/60 hover:text-roxo-eletrico"
              >
                <ChevronRight size={18} />
              </button>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-carbono/80 px-2.5 py-1 font-mono text-[10px] text-branco-cru">
                {index + 1}/{group.length}
              </span>
            </>
          )}
        </div>

        <div className="w-full shrink-0 space-y-4 overflow-y-auto p-5 md:w-80">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Ficha técnica</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar visualização"
              className="text-nevoa transition-colors hover:text-branco-cru"
            >
              <X size={18} />
            </button>
          </div>

          <p className="text-sm text-branco-cru">{asset.prompt || 'Sem prompt registrado.'}</p>

          <div className="rounded-md border border-grafite-elevado bg-carbono p-2.5">
            {asset.caption && <p className="text-xs text-branco-cru">{asset.caption}</p>}
            <div className="mt-1.5 flex items-center gap-3">
              {asset.caption && <CopyCaptionButton caption={asset.caption} />}
              <GenerateCaptionButton assetId={asset.id} hasCaption={Boolean(asset.caption)} />
            </div>
          </div>

          <dl className="space-y-2 font-mono text-[11px] text-nevoa">
            <div className="flex justify-between gap-3">
              <dt>Tipo</dt>
              <dd className="text-branco-cru">{TYPE_LABELS[asset.type] ?? asset.type}</dd>
            </div>
            {asset.qualityPreset && (
              <div className="flex justify-between gap-3">
                <dt>Qualidade</dt>
                <dd className="text-branco-cru">{QUALITY_LABELS[asset.qualityPreset] ?? asset.qualityPreset}</dd>
              </div>
            )}
            {asset.style && (
              <div className="flex justify-between gap-3">
                <dt>Estilo</dt>
                <dd className="text-branco-cru">{asset.style}</dd>
              </div>
            )}
            {isGroup && (
              <div className="flex justify-between gap-3">
                <dt>Slide</dt>
                <dd className="text-branco-cru">
                  {index + 1} de {group.length}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt>Criado por</dt>
              <dd className="truncate text-branco-cru">{asset.createdBy ?? 'não registrado'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Quando</dt>
              <dd className="text-branco-cru" title={new Date(asset.createdAt).toLocaleString('pt-BR')}>
                {formatRelativeTime(asset.createdAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Workflow</dt>
              <dd className="truncate text-branco-cru">{asset.model ?? '-'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Máquina</dt>
              <dd className="truncate text-branco-cru">{asset.nodeId ?? '-'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Arquivo</dt>
              <dd className="truncate text-branco-cru">{asset.filename}</dd>
            </div>
          </dl>

          {isGroup ? (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50"
            >
              <Download size={14} />
              {downloading ? 'Compactando…' : `Baixar tudo (.zip)`}
            </button>
          ) : (
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
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
