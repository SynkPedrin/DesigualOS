'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Clapperboard,
  FileText,
  ImageIcon,
  LayoutGrid,
  Link2,
  Loader2,
  Minus,
  Newspaper,
  Paperclip,
  Sparkles,
  UploadCloud,
  Video,
  X,
} from 'lucide-react';
import { useClients } from '@/hooks/use-clients';
import { useBrandKit } from '@/hooks/use-brand-kit';
import { useCreateStudioJob, useStudioJob, useUploadStudioReference } from '@/hooks/use-studio-jobs';
import { STUDIO_JOB_TYPES, type StudioJobAttachmentWire, type StudioJobType, type StudioStyle } from '@/lib/api/contracts';
import { ApiRequestError } from '@/lib/api/client';
import { STUDIO_VARIATION_OPTIONS, useStudioFormStore, type StudioQualityChoice } from '@/stores/studio-form-store';
import { cn } from '@/lib/utils';

const BRIEFING_MAX_LENGTH = 500;
const MAX_REFERENCE_ATTACHMENTS = 10;

const REFERENCE_ROLES: Array<{ value: NonNullable<StudioJobAttachmentWire['role']>; label: string }> = [
  { value: 'auto', label: 'Automático' },
  { value: 'scene', label: 'Cenário' },
  { value: 'subject', label: 'Pessoa/rosto' },
  { value: 'product', label: 'Produto' },
  { value: 'style', label: 'Estilo' },
  { value: 'layout', label: 'Composição' },
  { value: 'logo', label: 'Logo' },
  { value: 'mask', label: 'Máscara' },
];

/**
 * Todos os valores são MÚLTIPLOS DE 16 porque é como o Flux trabalha - 1080
 * não é, e degradava a imagem (ver snapToFluxGrid no studio-node, com a
 * comparação medida). O backend alinha de novo por segurança, mas mandar
 * certo daqui evita a surpresa de pedir 1080 e receber 1088.
 */
const ASPECT_RATIOS = [
  { value: '1088x1088', label: 'Quadrado', ratio: '1:1', width: 22, height: 22 },
  { value: '1088x1360', label: 'Retrato', ratio: '4:5', width: 18, height: 22 },
  { value: '1088x1920', label: 'Story', ratio: '9:16', width: 13, height: 22 },
  { value: '1536x864', label: 'Paisagem', ratio: '16:9', width: 34, height: 19 },
] as const;

const DEFAULT_ASPECT_RATIO: Record<'image' | 'carousel', string> = {
  image: '1536x864',
  carousel: '1088x1360',
};

/** video/reels geram de verdade via MiniMax H3 (nodes/studio-node/src/video-h3.ts) desde
 * 08/09/2026, mas o form ainda não expõe um seletor de resolução pra esses tipos - manda
 * este fallback fixo (o worker faz snap pra grade de 32 do H3 de qualquer forma).
 * Reels é vertical por definição: 9:16. */
const FALLBACK_RESOLUTION = '1088x1920';

const CONTENT_TYPES: { value: StudioJobType; label: string; icon: typeof ImageIcon; hint: string }[] = [
  { value: 'image', label: 'Imagem', icon: ImageIcon, hint: 'Peça única com variações' },
  { value: 'carousel', label: 'Carrossel', icon: LayoutGrid, hint: 'Sequência de slides com copy' },
  { value: 'video', label: 'Vídeo', icon: Video, hint: 'Vídeo curto gerado por IA' },
  { value: 'reels', label: 'Reel', icon: Clapperboard, hint: 'Vertical 9:16 para redes' },
];

/** Upscale tirado da seleção (pedido do usuário, 2026-09-03) - o backend gera de verdade
 * (nodes/studio-node/src/upscale.ts), mas como tipo de job à parte não fazia sentido de
 * produto: as únicas partes dele que importavam - qualidade e proporção - viraram
 * controles de verdade em image/carousel abaixo. */
const SELECTABLE_TYPES = new Set<StudioJobType>(STUDIO_JOB_TYPES.filter((type) => type !== 'upscale'));

const STYLES: { value: StudioStyle; label: string; icon: typeof Sparkles }[] = [
  { value: 'padrao', label: 'Padrão', icon: Sparkles },
  { value: 'minimalista', label: 'Minimalista', icon: Minus },
  { value: 'cinematico', label: 'Cinemático', icon: Clapperboard },
  { value: 'editorial', label: 'Editorial', icon: Newspaper },
  { value: '3d', label: '3D', icon: Box },
];

/** 'draft' fica de fora de propósito - medição real mostrou que menos de 28 passos
 * degrada a imagem (ver comfyui-client.ts). 'ultra' não é preset do backend:
 * vira high + metadata.ultra no payload. */
const QUALITY_OPTIONS: { value: StudioQualityChoice; label: string; hint: string }[] = [
  { value: 'standard', label: 'Padrão', hint: 'Equilíbrio entre velocidade e qualidade.' },
  { value: 'high', label: 'Alta', hint: 'Mais passos de renderização, mais detalhe.' },
  { value: 'ultra', label: 'Ultra', hint: 'Máxima qualidade disponível (High + refinamento).' },
];

const DURATION_OPTIONS_SECONDS = [5, 10, 15, 30];

const FIELD_CLASS =
  'w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/70 transition-colors focus:border-roxo-eletrico/60 focus:outline-none';

function SectionLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa">
      {children}
    </label>
  );
}

function BrandKitSummary({ clientId }: { clientId: string }) {
  const { data: kit, isPending } = useBrandKit(clientId);
  if (isPending) {
    return <p className="mt-2 flex items-center gap-1.5 text-[11px] text-nevoa"><Loader2 size={11} className="animate-spin" /> Carregando Brand Kit…</p>;
  }
  if (!kit || (kit.colors.length === 0 && !kit.logoUrl && !kit.toneOfVoice)) {
    return <p className="mt-2 text-[11px] text-nevoa">Este cliente ainda não tem Brand Kit cadastrado, o Studio usa o estilo base.</p>;
  }
  return (
    <div className="mt-2 flex items-center gap-3 rounded-md border border-grafite-elevado bg-carbono/60 px-2.5 py-2">
      {kit.logoUrl && <img src={kit.logoUrl} alt="Logo do cliente" className="size-7 rounded object-contain" />}
      {kit.colors.length > 0 && (
        <div className="flex items-center gap-1" aria-label={`Cores do Brand Kit: ${kit.colors.join(', ')}`}>
          {kit.colors.slice(0, 6).map((color) => (
            <span
              key={color}
              title={color}
              className="size-4 rounded-full border border-white/15"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      )}
      <div className="min-w-0 flex-1">
        {kit.fonts.length > 0 && <p className="truncate text-[11px] text-branco-cru">{kit.fonts.join(' · ')}</p>}
        {kit.toneOfVoice && <p className="truncate text-[10px] text-nevoa" title={kit.toneOfVoice}>{kit.toneOfVoice}</p>}
      </div>
    </div>
  );
}

/**
 * Isolado do JobForm de propósito (bug relatado: "criar um job buga o front"):
 * useStudioJob faz polling de 500ms enquanto o job está ativo, e antes esse
 * hook vivia direto no JobForm - cada tick re-renderizava o formulário
 * inteiro (todos os selects, o drag&drop, os previews) só pra atualizar o
 * label do botão. Isolando aqui, o polling só re-renderiza este rodapé.
 */
function JobSubmitStatus({
  trackedJobId,
  setTrackedJobId,
  createJob,
  hasLastPayload,
  onRetry,
}: {
  trackedJobId: string | null;
  setTrackedJobId: (id: string | null) => void;
  createJob: ReturnType<typeof useCreateStudioJob>;
  hasLastPayload: boolean;
  onRetry: () => void;
}) {
  const trackedJob = useStudioJob(trackedJobId);

  // Ciclo do CTA: o polling é o MESMO query cache do JobProgressCard (mesma key),
  // então refletir o andamento aqui não custa request extra.
  useEffect(() => {
    if (!trackedJob.data) return;
    if (trackedJob.data.status === 'completed') {
      const timeout = setTimeout(() => setTrackedJobId(null), 2500);
      return () => clearTimeout(timeout);
    }
    if (trackedJob.data.status === 'failed') {
      const timeout = setTimeout(() => setTrackedJobId(null), 6000);
      return () => clearTimeout(timeout);
    }
  }, [trackedJob.data, setTrackedJobId]);

  const jobStatus = trackedJob.data?.status;
  const busy =
    createJob.isPending || Boolean(trackedJobId && (jobStatus === 'queued' || jobStatus === 'rendering' || !jobStatus));
  const ctaLabel = createJob.isPending
    ? 'Preparando...'
    : jobStatus === 'queued'
      ? 'Processando...'
      : jobStatus === 'rendering'
        ? 'Gerando variações...'
        : jobStatus === 'completed'
          ? 'Projeto gerado'
          : 'Gerar projeto';

  return (
    <div className="space-y-2 border-t border-grafite-elevado pt-4">
      <button
        type="submit"
        disabled={busy}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-all',
          jobStatus === 'completed'
            ? 'bg-sinal text-carbono shadow-sinal'
            : 'bg-roxo-eletrico text-branco-cru hover:opacity-90 hover:shadow-glow disabled:opacity-40 disabled:hover:shadow-none',
        )}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : jobStatus === 'completed' ? (
          <CheckCircle2 size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        {ctaLabel}
      </button>

      <AnimatePresence>
        {(createJob.isError || jobStatus === 'failed') && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-md border border-erro/30 bg-erro/5 p-2.5"
          >
            <p role="alert" className="text-xs text-erro">
              {createJob.error instanceof ApiRequestError
                ? createJob.error.message
                : trackedJob.data?.error ?? 'Não foi possível gerar o projeto.'}
            </p>
            <button
              type="button"
              onClick={() => {
                createJob.reset();
                setTrackedJobId(null);
                onRetry();
              }}
              disabled={busy || !hasLastPayload}
              className="mt-1.5 text-xs font-medium text-roxo-eletrico hover:underline disabled:opacity-40"
            >
              Tentar novamente
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function JobForm({ onCreated }: { onCreated: (jobId: string) => void }) {
  const { data: clients } = useClients();
  const createJob = useCreateStudioJob();
  const uploadReference = useUploadStudioReference();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visualInputRef = useRef<HTMLInputElement>(null);

  const form = useStudioFormStore();
  const {
    clientId, type, style, aspectRatio, quality, variations, numSlides,
    durationSeconds, objective, briefing, visualReference, attachments, referenceImages,
  } = form;

  /** Payload do último submit, pra [Tentar novamente] refazer sem perder nada. */
  const lastPayloadRef = useRef<Parameters<typeof createJob.mutateAsync>[0] | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);

  function handleTypeChange(nextType: StudioJobType) {
    form.set({ type: nextType });
    if (nextType === 'image' || nextType === 'carousel') {
      form.set({ aspectRatio: DEFAULT_ASPECT_RATIO[nextType] });
    }
  }

  // Sobe na hora que a pessoa escolhe: ela vê o que anexou ANTES de mandar
  // gerar, e o job nunca nasce apontando pra um upload pela metade.
  function uploadFiles(files: File[], target: 'attachments' | 'visual') {
    for (const file of files) {
      if (target === 'visual' && !/^image\/(png|jpeg|webp)$/.test(file.type)) {
        setVisualError('Referência visual aceita só PNG, JPG ou WEBP.');
        continue;
      }
      setVisualError(null);
      uploadReference.mutate(file, {
        onSuccess: (uploaded) => {
          if (target === 'visual') {
            form.set({
              visualReference: { ...uploaded, role: 'scene', fidelity: 'high' },
              attachments: useStudioFormStore.getState().attachments.slice(0, MAX_REFERENCE_ATTACHMENTS - 1),
            });
          } else {
            form.set({ attachments: [...useStudioFormStore.getState().attachments, uploaded] });
          }
        },
      });
      if (target === 'visual') break;
    }
  }

  function handlePickAttachments(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    const available = MAX_REFERENCE_ATTACHMENTS - attachments.length - (visualReference ? 1 : 0);
    uploadFiles(files.slice(0, Math.max(0, available)), 'attachments');
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragActive(false);
    uploadFiles(Array.from(event.dataTransfer.files), 'visual');
  }

  // Ctrl/Cmd+V em qualquer campo do formulário (briefing, objetivo) também
  // manda pra referências — mesmo destino do input de arquivo abaixo, com o
  // mesmo teto de MAX_REFERENCE_ATTACHMENTS. Não intercepta colagem de texto
  // puro: só entra quando o clipboard traz arquivo de verdade.
  function handleFormPaste(event: React.ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    const available = MAX_REFERENCE_ATTACHMENTS - attachments.length - (visualReference ? 1 : 0);
    uploadFiles(files.slice(0, Math.max(0, available)), 'attachments');
  }

  function buildPayload() {
    const prompt = objective.trim() ? `${objective.trim()}. ${briefing.trim()}` : briefing.trim();
    const allAttachments = (visualReference ? [visualReference, ...attachments] : attachments).slice(0, MAX_REFERENCE_ATTACHMENTS);
    return {
      clientId,
      type,
      prompt,
      resolution: type === 'image' || type === 'carousel' ? aspectRatio : FALLBACK_RESOLUTION,
      attachments: allAttachments,
      style,
      ...(referenceImages.length ? { referenceImages } : {}),
      ...(type === 'carousel' ? { numSlides } : {}),
      // Copy automática desligada de propósito (achado 2026-09-10): legenda
      // só é gerada sob demanda, depois que a imagem existe, pelo botão
      // manual "Gerar legenda com Otto" na ficha técnica do asset - nunca
      // mais na criação do job. Ver useGenerateAssetCaption/asset-lightbox.
      ...(type === 'image' ? { variations, includeText: false, qualityPreset: quality === 'ultra' ? ('high' as const) : quality, ultra: quality === 'ultra' } : {}),
      ...(type === 'carousel' ? { includeText: false, qualityPreset: quality === 'ultra' ? ('high' as const) : quality, ultra: quality === 'ultra' } : {}),
      ...(type === 'video' || type === 'reels' ? { qualityPreset: quality === 'ultra' ? ('high' as const) : quality, ultra: quality === 'ultra', durationSeconds } : {}),
    };
  }

  async function submit() {
    const payload = buildPayload();
    lastPayloadRef.current = payload;
    try {
      const result = await createJob.mutateAsync(payload);
      onCreated(result.job_id);
      setTrackedJobId(result.job_id);
      form.set({ briefing: '', objective: '', attachments: [], referenceImages: [], visualReference: null });
    } catch {
      // createJob.isError abaixo já reflete isso; o botão vira [Tentar novamente].
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!clientId) {
      setValidationError('Selecione um cliente para continuar.');
      return;
    }
    if (!briefing.trim()) {
      setValidationError('Descreva o que o Studio deve criar.');
      return;
    }
    setValidationError(null);
    await submit();
  }

  const isVisualType = type === 'image' || type === 'carousel';
  const isMotionType = type === 'video' || type === 'reels';

  return (
    <form onSubmit={handleSubmit} onPaste={handleFormPaste} className="space-y-6">
      {/* CLIENTE */}
      <section>
        <SectionLabel htmlFor="studio-client">Cliente</SectionLabel>
        <select
          id="studio-client"
          value={clientId}
          onChange={(event) => form.set({ clientId: event.target.value })}
          className={FIELD_CLASS}
        >
          <option value="">Selecione um cliente</option>
          {clients?.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        {clientId && <BrandKitSummary clientId={clientId} />}
      </section>

      {/* TIPO DE CONTEÚDO */}
      <section>
        <SectionLabel>Tipo de conteúdo</SectionLabel>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de conteúdo">
          {CONTENT_TYPES.filter((option) => SELECTABLE_TYPES.has(option.value)).map((option) => {
            const Icon = option.icon;
            const selected = type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                title={option.hint}
                onClick={() => handleTypeChange(option.value)}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all',
                  selected
                    ? 'border-roxo-eletrico/70 bg-roxo-eletrico/10 shadow-glow'
                    : 'border-grafite-elevado bg-carbono hover:border-nevoa/40 hover:bg-grafite-elevado/50',
                )}
              >
                <Icon size={16} className={selected ? 'text-roxo-eletrico' : 'text-nevoa'} />
                <span className={cn('text-xs font-medium', selected ? 'text-branco-cru' : 'text-nevoa')}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ESTILO VISUAL */}
      <section>
        <SectionLabel>Estilo visual</SectionLabel>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Estilo visual">
          {STYLES.map((option) => {
            const Icon = option.icon;
            const selected = style === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => form.set({ style: option.value })}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-all',
                  selected
                    ? 'border-roxo-eletrico/70 bg-roxo-eletrico/10 text-branco-cru'
                    : 'border-grafite-elevado bg-carbono text-nevoa hover:border-nevoa/40 hover:text-branco-cru',
                )}
              >
                <Icon size={12} className={selected ? 'text-roxo-eletrico' : undefined} />
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* PROPORÇÃO (image/carousel) */}
      {isVisualType && (
        <section>
          <SectionLabel>Proporção</SectionLabel>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Proporção">
            {ASPECT_RATIOS.map((option) => {
              const selected = aspectRatio === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={`${option.label} ${option.ratio} (${option.value})`}
                  onClick={() => form.set({ aspectRatio: option.value })}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-all',
                    selected
                      ? 'border-roxo-eletrico/70 bg-roxo-eletrico/10'
                      : 'border-grafite-elevado bg-carbono hover:border-nevoa/40',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn('rounded-[2px] border-2', selected ? 'border-roxo-eletrico' : 'border-nevoa/60')}
                    style={{ width: option.width, height: option.height }}
                  />
                  <span className={cn('text-[9px] font-medium leading-none', selected ? 'text-branco-cru' : 'text-nevoa')}>
                    {option.ratio}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* QUALIDADE */}
      <section>
        <SectionLabel>Qualidade</SectionLabel>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-grafite-elevado bg-carbono p-1" role="radiogroup" aria-label="Qualidade">
          {QUALITY_OPTIONS.map((option) => {
            const selected = quality === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                title={option.hint}
                onClick={() => form.set({ quality: option.value })}
                className={cn(
                  'rounded-md py-1.5 text-xs font-medium transition-all',
                  selected ? 'bg-roxo-eletrico text-branco-cru shadow-glow' : 'text-nevoa hover:text-branco-cru',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* VARIAÇÕES (image) / SLIDES (carousel) / DURAÇÃO (video, reels) */}
      {type === 'image' && (
        <section>
          <SectionLabel>Número de variações</SectionLabel>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={STUDIO_VARIATION_OPTIONS.length - 1}
              step={1}
              value={STUDIO_VARIATION_OPTIONS.indexOf(variations as (typeof STUDIO_VARIATION_OPTIONS)[number])}
              onChange={(event) => form.set({ variations: STUDIO_VARIATION_OPTIONS[Number(event.target.value)]! })}
              aria-label="Número de variações"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-grafite-elevado accent-roxo-eletrico"
            />
            <span className="w-8 text-center font-mono text-sm font-semibold text-roxo-eletrico">{variations}</span>
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-nevoa">
            {STUDIO_VARIATION_OPTIONS.map((value) => (
              <span key={value} className={value === variations ? 'text-roxo-eletrico' : undefined}>{value}</span>
            ))}
          </div>
        </section>
      )}

      {type === 'carousel' && (
        <section>
          <SectionLabel htmlFor="studio-slides">Número de slides</SectionLabel>
          <input
            id="studio-slides"
            type="number"
            min={1}
            max={10}
            value={numSlides}
            onChange={(event) => form.set({ numSlides: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })}
            className={cn(FIELD_CLASS, 'w-24')}
          />
        </section>
      )}

      {isMotionType && (
        <section className="space-y-3">
          <div>
            <SectionLabel>Duração</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_OPTIONS_SECONDS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => form.set({ durationSeconds: seconds })}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                    durationSeconds === seconds
                      ? 'border-roxo-eletrico/70 bg-roxo-eletrico/10 text-branco-cru'
                      : 'border-grafite-elevado bg-carbono text-nevoa hover:text-branco-cru',
                  )}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-md border border-grafite-elevado bg-carbono p-2.5 text-xs text-nevoa">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Geração real via MiniMax H3 (ComfyUI) - pode levar alguns minutos. Sem referência anexada, um frame
            inicial é gerado primeiro via Flux e depois animado.
          </p>
        </section>
      )}

      {/* REFERÊNCIA VISUAL */}
      <section>
        <SectionLabel>Referência visual</SectionLabel>
        <input
          ref={visualInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            uploadFiles(files, 'visual');
          }}
        />
        {visualReference ? (
          <div className="flex items-center gap-3 rounded-lg border border-grafite-elevado bg-carbono p-2.5">
            <img src={visualReference.url} alt="Referência visual enviada" className="size-14 rounded-md object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-branco-cru">{visualReference.filename}</p>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => visualInputRef.current?.click()}
                  className="text-[11px] font-medium text-roxo-eletrico hover:underline"
                >
                  Substituir
                </button>
                <button
                  type="button"
                  onClick={() => form.set({ visualReference: null })}
                  className="text-[11px] font-medium text-nevoa hover:text-erro"
                >
                  Remover
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => visualInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            disabled={uploadReference.isPending}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-all',
              dragActive
                ? 'border-roxo-eletrico bg-roxo-eletrico/10'
                : 'border-grafite-elevado bg-carbono hover:border-roxo-eletrico/50',
              uploadReference.isPending && 'opacity-50',
            )}
          >
            <UploadCloud size={20} className={dragActive ? 'text-roxo-eletrico' : 'text-nevoa'} />
            <span className="text-xs text-nevoa">
              {uploadReference.isPending ? 'Enviando…' : 'Arraste ou clique para enviar'}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-nevoa/60">PNG · JPG · WEBP</span>
          </button>
        )}
        {visualError && <p className="mt-1 text-[11px] text-erro">{visualError}</p>}
        {uploadReference.isError && (
          <p className="mt-1 text-[11px] text-erro">
            {uploadReference.error instanceof ApiRequestError ? uploadReference.error.message : 'Não foi possível anexar.'}
          </p>
        )}
      </section>

      {/* DIRETRIZES CRIATIVAS */}
      <section>
        <SectionLabel htmlFor="studio-briefing">Diretrizes criativas</SectionLabel>
        <input
          value={objective}
          onChange={(event) => form.set({ objective: event.target.value })}
          placeholder="Objetivo: ex. divulgar promoção de fim de semana"
          aria-label="Objetivo"
          className={cn(FIELD_CLASS, 'mb-2')}
        />
        <textarea
          id="studio-briefing"
          value={briefing}
          onChange={(event) => form.set({ briefing: event.target.value.slice(0, BRIEFING_MAX_LENGTH) })}
          rows={4}
          maxLength={BRIEFING_MAX_LENGTH}
          placeholder="Descreva o que o Studio deve criar..."
          className={cn(FIELD_CLASS, 'resize-none')}
        />
        <p className="mt-1 text-right font-mono text-[10px] text-nevoa/70">
          {briefing.length}/{BRIEFING_MAX_LENGTH}
        </p>
      </section>

      {/* REFERÊNCIAS (anexos + URLs da galeria) */}
      <section>
        <SectionLabel>Referências (imagem ou PDF, até 10 — também aceita colar com Ctrl/Cmd+V)</SectionLabel>

        {(attachments.length > 0 || referenceImages.length > 0) && (
          <ul className="mb-2 space-y-1">
            {attachments.map((attachment) => (
              <li
                key={attachment.url}
                className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5"
              >
                {attachment.contentType === 'application/pdf' ? (
                  <FileText size={13} className="shrink-0 text-nevoa" />
                ) : attachment.contentType.startsWith('image/') ? (
                  <img src={attachment.url} alt="" className="size-6 shrink-0 rounded object-cover" />
                ) : (
                  <ImageIcon size={13} className="shrink-0 text-nevoa" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] text-branco-cru">{attachment.filename}</span>
                <select
                  value={attachment.role ?? 'auto'}
                  onChange={(event) => form.set({
                    attachments: attachments.map((item) => item.url === attachment.url
                      ? { ...item, role: event.target.value as NonNullable<StudioJobAttachmentWire['role']> }
                      : item),
                  })}
                  aria-label={`Uso de ${attachment.filename}`}
                  className="max-w-28 rounded border border-grafite-elevado bg-carbono px-1.5 py-1 text-[10px] text-nevoa outline-none focus:border-roxo-eletrico"
                >
                  {REFERENCE_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => form.set({ attachments: attachments.filter((a) => a.url !== attachment.url) })}
                  aria-label={`Remover ${attachment.filename}`}
                  className="shrink-0 text-nevoa transition-colors hover:text-erro"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
            {referenceImages.map((url) => (
              <li
                key={url}
                className="flex items-center gap-2 rounded-md border border-roxo-eletrico/30 bg-roxo-eletrico/5 px-2.5 py-1.5"
              >
                <img src={url} alt="" className="size-6 shrink-0 rounded object-cover" />
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] text-branco-cru">
                  <Link2 size={10} className="shrink-0 text-roxo-eletrico" />
                  Referência da galeria
                </span>
                <button
                  type="button"
                  onClick={() => form.removeReferenceImage(url)}
                  aria-label="Remover referência da galeria"
                  className="shrink-0 text-nevoa transition-colors hover:text-erro"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          multiple
          hidden
          onChange={handlePickAttachments}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadReference.isPending || attachments.length + (visualReference ? 1 : 0) >= MAX_REFERENCE_ATTACHMENTS}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-grafite-elevado py-2 text-xs text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru disabled:opacity-40"
        >
          <Paperclip size={13} />
          {uploadReference.isPending ? 'Enviando…' : '+ Adicionar referência'}
        </button>
      </section>

      {/* CTA */}
      {validationError && (
        <p role="alert" className="text-xs text-erro">{validationError}</p>
      )}
      <JobSubmitStatus
        trackedJobId={trackedJobId}
        setTrackedJobId={setTrackedJobId}
        createJob={createJob}
        hasLastPayload={lastPayloadRef.current !== null}
        onRetry={() => void submit()}
      />
    </form>
  );
}
