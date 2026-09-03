'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, FileText, ImageIcon, Paperclip, Sparkles, X } from 'lucide-react';
import { useClients } from '@/hooks/use-clients';
import { useCreateStudioJob, useUploadStudioReference } from '@/hooks/use-studio-jobs';
import {
  STUDIO_JOB_TYPES,
  STUDIO_QUALITY_PRESETS,
  type StudioJobAttachmentWire,
  type StudioJobType,
  type StudioQualityPreset,
} from '@/lib/api/contracts';
import { ApiRequestError } from '@/lib/api/client';
import { Surface } from '@/components/ui/surface';

const QUALITY_LABELS: Record<StudioQualityPreset, string> = {
  draft: 'Rascunho',
  standard: 'Padrão',
  high: 'Alta',
};

/** image/carousel geram de verdade (Flux via ComfyUI): 'draft' fica de fora de propósito —
 * medição real mostrou que menos de 28 passos degrada a imagem (ver comfyui-client.ts). */
const IMAGE_QUALITY_PRESETS: StudioQualityPreset[] = ['standard', 'high'];

const DURATION_OPTIONS_SECONDS = [5, 10, 15, 30];

const TYPE_LABELS: Record<StudioJobType, string> = {
  image: 'Imagem',
  carousel: 'Carousel',
  video: 'Vídeo',
  reels: 'Reels',
  upscale: 'Upscale',
};

/** Upscale tirado da seleção (pedido do usuário, 2026-09-03): não tem geração real
 * conectada, e as únicas partes dele que importavam — qualidade e proporção — viraram
 * controles de verdade em image/carousel abaixo, em vez de um tipo de job à parte. */
const SELECTABLE_TYPES: StudioJobType[] = STUDIO_JOB_TYPES.filter((type) => type !== 'upscale');

interface AspectRatioOption {
  value: string;
  label: string;
}

/**
 * Todos os valores são MÚLTIPLOS DE 16 porque é como o Flux trabalha — 1080
 * não é, e degradava a imagem (ver snapToFluxGrid no studio-node, com a
 * comparação medida). O backend alinha de novo por segurança, mas mandar
 * certo daqui evita a surpresa de pedir 1080 e receber 1088. "Paisagem" é o
 * único valor com comparação de qualidade medida de verdade na RTX 4090;
 * os outros reaproveitam os mesmos números já usados noutros formatos.
 */
const ASPECT_RATIOS: AspectRatioOption[] = [
  { value: '1088x1088', label: 'Quadrado · 1:1' },
  { value: '1088x1360', label: 'Retrato · 4:5' },
  { value: '1088x1920', label: 'Vertical · 9:16' },
  { value: '1344x896', label: 'Paisagem · 3:2' },
];

const DEFAULT_ASPECT_RATIO: Record<'image' | 'carousel', string> = {
  image: '1344x896',
  carousel: '1088x1360',
};

/** video/reels não geram de verdade ainda (job falha honesto antes de chegar no ComfyUI),
 * então a resolução aqui não afeta nada por enquanto — só mantém o payload coerente. */
const FALLBACK_RESOLUTION = '1088x1920';

export function JobForm({ onCreated }: { onCreated: (jobId: string) => void }) {
  const { data: clients } = useClients();
  const createJob = useCreateStudioJob();
  const uploadReference = useUploadStudioReference();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [clientId, setClientId] = useState('');
  const [type, setType] = useState<StudioJobType>('carousel');
  const [objective, setObjective] = useState('');
  const [briefing, setBriefing] = useState('');
  const [attachments, setAttachments] = useState<StudioJobAttachmentWire[]>([]);
  const [numSlides, setNumSlides] = useState(5);
  const [includeText, setIncludeText] = useState(true);
  const [qualityPreset, setQualityPreset] = useState<StudioQualityPreset>('standard');
  const [durationSeconds, setDurationSeconds] = useState(10);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO.carousel);

  function handleTypeChange(nextType: StudioJobType) {
    setType(nextType);
    if (nextType === 'image' || nextType === 'carousel') {
      setAspectRatio(DEFAULT_ASPECT_RATIO[nextType]);
    }
  }

  // Sobe na hora que a pessoa escolhe: ela vê o que anexou ANTES de mandar
  // gerar, e o job nunca nasce apontando pra um upload pela metade.
  function handlePickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    for (const file of files.slice(0, 5 - attachments.length)) {
      uploadReference.mutate(file, {
        onSuccess: (uploaded) => setAttachments((current) => [...current, uploaded]),
      });
    }
  }

  const canSubmit = clientId && briefing.trim().length > 0 && !createJob.isPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const prompt = objective.trim() ? `${objective.trim()}. ${briefing.trim()}` : briefing.trim();
    try {
      const result = await createJob.mutateAsync({
        clientId,
        type,
        prompt,
        resolution: type === 'image' || type === 'carousel' ? aspectRatio : FALLBACK_RESOLUTION,
        attachments,
        ...(type === 'carousel' ? { numSlides } : {}),
        ...(type === 'image' || type === 'carousel' ? { includeText, qualityPreset } : {}),
        ...(type === 'video' || type === 'reels' ? { qualityPreset, durationSeconds } : {}),
      });
      onCreated(result.job_id);
      setBriefing('');
      setObjective('');
      setAttachments([]);
    } catch {
      // createJob.isError below already reflects this; nothing more to do here.
    }
  }

  return (
    <Surface level="grafite" className="p-5">
      <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
        Novo projeto
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Cliente
          </label>
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            required
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          >
            <option value="">Selecione um cliente</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Tipo
          </label>
          <div className="flex flex-wrap gap-2">
            {SELECTABLE_TYPES.map((jobType) => (
              <button
                key={jobType}
                type="button"
                onClick={() => handleTypeChange(jobType)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  type === jobType
                    ? 'border-sinal bg-sinal/10 text-sinal'
                    : 'border-grafite-elevado bg-carbono text-nevoa hover:text-branco-cru'
                }`}
              >
                {TYPE_LABELS[jobType]}
              </button>
            ))}
          </div>
        </div>

        {(type === 'image' || type === 'carousel') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                Proporção
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio.value}
                    type="button"
                    onClick={() => setAspectRatio(ratio.value)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      aspectRatio === ratio.value
                        ? 'border-sinal bg-sinal/10 text-sinal'
                        : 'border-grafite-elevado bg-carbono text-nevoa hover:text-branco-cru'
                    }`}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                Qualidade
              </label>
              <div className="flex flex-wrap gap-1.5">
                {IMAGE_QUALITY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setQualityPreset(preset)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      qualityPreset === preset
                        ? 'border-sinal bg-sinal/10 text-sinal'
                        : 'border-grafite-elevado bg-carbono text-nevoa hover:text-branco-cru'
                    }`}
                  >
                    {QUALITY_LABELS[preset]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {type === 'carousel' && (
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Número de slides
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={numSlides}
              onChange={(event) => setNumSlides(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
              className="w-24 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>
        )}

        {(type === 'image' || type === 'carousel') && (
          <label className="flex items-center gap-2 text-sm text-branco-cru">
            <input
              type="checkbox"
              checked={includeText}
              onChange={(event) => setIncludeText(event.target.checked)}
              className="size-4 rounded border-grafite-elevado bg-carbono accent-roxo-eletrico"
            />
            Gerar copy de marketing e sobrepor texto nas imagens
          </label>
        )}

        {(type === 'video' || type === 'reels') && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                Qualidade
              </label>
              <div className="flex flex-wrap gap-2">
                {STUDIO_QUALITY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setQualityPreset(preset)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      qualityPreset === preset
                        ? 'border-sinal bg-sinal/10 text-sinal'
                        : 'border-grafite-elevado bg-carbono text-nevoa hover:text-branco-cru'
                    }`}
                  >
                    {QUALITY_LABELS[preset]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                Duração
              </label>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS_SECONDS.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    onClick={() => setDurationSeconds(seconds)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      durationSeconds === seconds
                        ? 'border-sinal bg-sinal/10 text-sinal'
                        : 'border-grafite-elevado bg-carbono text-nevoa hover:text-branco-cru'
                    }`}
                  >
                    {seconds}s
                  </button>
                ))}
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-md border border-aviso/30 bg-aviso/5 p-2.5 text-xs text-aviso">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Geração real de {TYPE_LABELS[type].toLowerCase()} ainda está em desenvolvimento — o job vai retornar
              um erro explicando isso, sem gerar nada de fato.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Objetivo
          </label>
          <input
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Ex: divulgar promoção de fim de semana"
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Briefing
          </label>
          <textarea
            value={briefing}
            onChange={(event) => setBriefing(event.target.value)}
            required
            rows={4}
            placeholder="Descreva o que o Studio deve criar..."
            className="w-full resize-none rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Referências (imagem ou PDF, até 5)
          </label>

          {attachments.length > 0 && (
            <ul className="mb-2 space-y-1">
              {attachments.map((attachment) => (
                <li
                  key={attachment.url}
                  className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5"
                >
                  {attachment.contentType === 'application/pdf' ? (
                    <FileText size={13} className="shrink-0 text-nevoa" />
                  ) : (
                    <ImageIcon size={13} className="shrink-0 text-nevoa" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-branco-cru">{attachment.filename}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((a) => a.url !== attachment.url))}
                    aria-label={`Remover ${attachment.filename}`}
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
            onChange={handlePickFiles}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadReference.isPending || attachments.length >= 5}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-grafite-elevado py-2 text-xs text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru disabled:opacity-40"
          >
            <Paperclip size={13} />
            {uploadReference.isPending ? 'Enviando…' : 'Anexar referência'}
          </button>
          {uploadReference.isError && (
            <p className="mt-1 text-[11px] text-erro">
              {uploadReference.error instanceof ApiRequestError ? uploadReference.error.message : 'Não foi possível anexar.'}
            </p>
          )}
        </div>

        <p className="font-mono text-[11px] text-nevoa">
          Brand Kit selecionado automaticamente a partir do cliente.
        </p>

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2.5 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40 disabled:hover:shadow-none"
        >
          <Sparkles size={16} />
          {createJob.isPending ? 'Enviando...' : 'Gerar'}
        </button>
        {createJob.isError && (
          <p className="text-sm text-erro">
            {createJob.error instanceof ApiRequestError ? createJob.error.message : 'Não foi possível criar o job.'}
          </p>
        )}
      </form>
    </Surface>
  );
}
