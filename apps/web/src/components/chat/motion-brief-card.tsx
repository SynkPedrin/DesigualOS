'use client';

import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Sparkles } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useSendChatMessage } from '@/hooks/use-send-chat-message';
import type { ChatMotionBriefRequestWire, MotionBriefWire } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/** Estado do formulário: tudo string porque input vazio é "", e "" NÃO vai
 * pro POST (ver buildMotionBrief). fps fica fora da UI — só atravessa quando o
 * Otto já inferiu no prefill. */
export interface MotionBriefFields {
  campaignName: string;
  objective: string;
  offerName: string;
  price: string;
  condition: string;
  cta: string;
  aspectRatio: string;
  duration: string;
  audience: string;
  tone: string;
  notes: string;
  fps?: 24 | 30 | 60 | undefined;
}

const OBJECTIVE_SUGGESTIONS = [
  'Gerar leads',
  'Vender agora',
  'Divulgar lançamento',
  'Reforçar marca',
  'Convidar para evento',
] as const;

const FORMAT_OPTIONS = [
  { value: '9:16', label: 'Reels/Stories 9:16' },
  { value: '1:1', label: 'Feed 1:1' },
  { value: '16:9', label: '16:9' },
  { value: '4:5', label: '4:5' },
] as const;

const TONE_OPTIONS = ['Premium', 'Direto', 'Agressivo', 'Clean', 'Acolhedor', 'Institucional'] as const;

export function initialBriefFields(prefill: ChatMotionBriefRequestWire['prefill'] | undefined): MotionBriefFields {
  return {
    campaignName: prefill?.campaignName ?? '',
    objective: '',
    offerName: '',
    price: '',
    condition: '',
    cta: '',
    aspectRatio: prefill?.aspectRatio ?? '',
    duration: prefill?.duration ? String(prefill.duration) : '15',
    audience: '',
    tone: '',
    notes: '',
    fps: prefill?.fps,
  };
}

/** Monta o motion_brief do POST /chat. Regra do contrato: campo vazio NÃO
 * vai — o objeto carrega só o que a pessoa preencheu de fato. Valor e condição
 * passam verbatim: são fatos comerciais, o motion usa exatamente como escrito. */
export function buildMotionBrief(fields: MotionBriefFields): MotionBriefWire {
  const brief: MotionBriefWire = {};
  const text = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const campaignName = text(fields.campaignName);
  if (campaignName) brief.campaignName = campaignName;
  const objective = text(fields.objective);
  if (objective) brief.objective = objective;

  const offerName = text(fields.offerName);
  const price = text(fields.price);
  const condition = text(fields.condition);
  if (offerName || price || condition) {
    brief.offer = {
      ...(offerName ? { name: offerName } : {}),
      ...(price ? { price } : {}),
      ...(condition ? { condition } : {}),
    };
  }

  const cta = text(fields.cta);
  if (cta) brief.cta = cta;
  const audience = text(fields.audience);
  if (audience) brief.audience = audience;
  if (fields.aspectRatio) brief.aspectRatio = fields.aspectRatio;

  const duration = Number.parseInt(fields.duration, 10);
  if (Number.isFinite(duration) && duration > 0) brief.duration = duration;
  if (fields.fps) brief.fps = fields.fps;

  const tone = text(fields.tone);
  if (tone) brief.tone = tone;
  const notes = text(fields.notes);
  if (notes) brief.notes = notes;

  return brief;
}

const inputClass =
  'w-full rounded-md border border-grafite-elevado bg-carbono/50 px-2.5 py-1.5 text-xs text-branco-cru outline-none placeholder:text-branco-cru/35 focus:border-roxo-eletrico/60';
const labelClass = 'mb-1 block font-mono text-[10px] uppercase tracking-wider text-branco-cru/50';
const chipClass =
  'rounded-md border border-grafite-elevado px-2 py-1 text-[11px] text-branco-cru/70 transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru';
const chipActiveClass = 'border-roxo-eletrico/70 bg-roxo-eletrico/15 text-branco-cru';

/**
 * Card de briefing do Otto Motion Engine: quando a resposta assistente vem com
 * metadata.motion_brief_request, o balão ganha este formulário compacto. O
 * envio é um POST /chat normal com `motion_brief` — o motion nasce como uma
 * nova mensagem/card na conversa, então aqui o card colapsa num resumo.
 */
export function MotionBriefCard({
  request,
  conversationId,
}: {
  request: ChatMotionBriefRequestWire;
  conversationId: string | null;
}) {
  const [fields, setFields] = useState<MotionBriefFields>(() => initialBriefFields(request.prefill));
  const [sent, setSent] = useState(false);
  const sendMessage = useSendChatMessage();
  const queryClient = useQueryClient();
  const objectiveListId = useId();

  function set<K extends keyof MotionBriefFields>(key: K, value: MotionBriefFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sendMessage.isPending) return;
    const brief = buildMotionBrief(fields);
    try {
      await sendMessage.mutateAsync({
        message: `Gerar motion: ${brief.campaignName ?? 'conforme briefing'}`,
        clientId: request.client_id,
        agentSelection: 'otto',
        conversationId,
        motionBrief: brief,
      });
      setSent(true);
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: ['conversations', conversationId, 'messages'] });
      }
    } catch {
      // isError/isPending do mutation já pintam o estado de erro no card.
    }
  }

  if (sent) {
    return (
      <Surface level="grafite" className="mt-2 max-w-[420px] p-3">
        <div className="flex items-center gap-2 text-sm text-branco-cru">
          <Check size={14} className="shrink-0 text-roxo-eletrico" />
          <span>
            Briefing enviado
            {fields.campaignName.trim() ? `, ${fields.campaignName.trim()}` : ''}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-branco-cru/50">O Otto já está trabalhando no motion.</p>
      </Surface>
    );
  }

  return (
    <Surface level="grafite" className="mt-2 max-w-[420px] overflow-hidden">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="shrink-0 text-roxo-eletrico" />
          <p className="text-xs font-medium text-branco-cru">Briefing do motion</p>
        </div>

        <div>
          <label htmlFor={`${objectiveListId}-campaign`} className={labelClass}>
            Campanha
          </label>
          <input
            id={`${objectiveListId}-campaign`}
            value={fields.campaignName}
            onChange={(event) => set('campaignName', event.target.value)}
            placeholder="Ex.: Coleção Verão 2027"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={`${objectiveListId}-objective`} className={labelClass}>
            Objetivo
          </label>
          <input
            id={`${objectiveListId}-objective`}
            list={objectiveListId}
            value={fields.objective}
            onChange={(event) => set('objective', event.target.value)}
            placeholder="Escolha ou descreva"
            className={inputClass}
          />
          <datalist id={objectiveListId}>
            {OBJECTIVE_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>

        <div>
          <label htmlFor={`${objectiveListId}-offer`} className={labelClass}>
            Oferta
          </label>
          <input
            id={`${objectiveListId}-offer`}
            value={fields.offerName}
            onChange={(event) => set('offerName', event.target.value)}
            placeholder="Ex.: Tênis Runner Pro"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${objectiveListId}-price`} className={labelClass}>
              Valor (usado exatamente como escrito)
            </label>
            <input
              id={`${objectiveListId}-price`}
              value={fields.price}
              onChange={(event) => set('price', event.target.value)}
              placeholder="Ex.: R$ 297"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${objectiveListId}-condition`} className={labelClass}>
              Condição (verbatim)
            </label>
            <input
              id={`${objectiveListId}-condition`}
              value={fields.condition}
              onChange={(event) => set('condition', event.target.value)}
              placeholder="Ex.: 12x de R$ 29,70"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${objectiveListId}-cta`} className={labelClass}>
            CTA
          </label>
          <input
            id={`${objectiveListId}-cta`}
            value={fields.cta}
            onChange={(event) => set('cta', event.target.value)}
            placeholder="Ex.: Compre agora no link da bio"
            className={inputClass}
          />
        </div>

        <div>
          <span className={labelClass}>Formato</span>
          <div className="flex flex-wrap gap-1.5">
            {FORMAT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set('aspectRatio', fields.aspectRatio === option.value ? '' : option.value)}
                className={cn(chipClass, fields.aspectRatio === option.value && chipActiveClass)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${objectiveListId}-duration`} className={labelClass}>
              Duração (segundos)
            </label>
            <input
              id={`${objectiveListId}-duration`}
              type="number"
              min={1}
              max={180}
              value={fields.duration}
              onChange={(event) => set('duration', event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${objectiveListId}-audience`} className={labelClass}>
              Público
            </label>
            <input
              id={`${objectiveListId}-audience`}
              value={fields.audience}
              onChange={(event) => set('audience', event.target.value)}
              placeholder="Ex.: mulheres 25-40"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className={labelClass}>Tom</span>
          <div className="flex flex-wrap gap-1.5">
            {TONE_OPTIONS.map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => set('tone', fields.tone === tone ? '' : tone)}
                className={cn(chipClass, fields.tone === tone && chipActiveClass)}
              >
                {tone}
              </button>
            ))}
          </div>
          <input
            value={TONE_OPTIONS.includes(fields.tone as (typeof TONE_OPTIONS)[number]) ? '' : fields.tone}
            onChange={(event) => set('tone', event.target.value)}
            placeholder="Ou descreva outro tom"
            aria-label="Tom livre"
            className={cn(inputClass, 'mt-1.5')}
          />
        </div>

        <div>
          <label htmlFor={`${objectiveListId}-notes`} className={labelClass}>
            Observação
          </label>
          <textarea
            id={`${objectiveListId}-notes`}
            value={fields.notes}
            onChange={(event) => set('notes', event.target.value)}
            rows={2}
            placeholder="Algo que o Otto precisa saber?"
            className={cn(inputClass, 'resize-none')}
          />
        </div>

        {sendMessage.isError ? (
          <p className="flex items-start gap-1.5 text-[11px] text-erro">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            Não consegui enviar o briefing. Tente de novo.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={sendMessage.isPending}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {sendMessage.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
          Gerar Motion
        </button>
      </form>
    </Surface>
  );
}
