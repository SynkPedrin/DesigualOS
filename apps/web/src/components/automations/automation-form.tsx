'use client';

import { useMemo, useState } from 'react';
import type { AgentName } from '@desigual-os/types';
import { AGENT_META, FEATURED_AGENTS } from '@/lib/agent-meta';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { ClientSelector } from '@/components/chat/client-selector';
import { ApiRequestError } from '@/lib/api/client';
import type { Automation } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';
import { proximasDoCron } from '@/lib/proximas-do-cron';

/** Dia da semana + dia/mês + hora: é o que responde "quando?" sem exigir conta. */
const FORMATO_DA_PREVIA = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const SCHEDULE_PRESETS = [
  { schedule: '0 8 * * *', label: 'Todos os dias às 08:00' },
  { schedule: '0 12 * * *', label: 'Todos os dias às 12:00' },
  { schedule: '0 18 * * *', label: 'Todos os dias às 18:00' },
  { schedule: '0 * * * *', label: 'A cada hora' },
  { schedule: 'custom', label: 'Personalizado (cron)' },
] as const;

export interface AutomationFormValues {
  name: string;
  agent: AgentName;
  prompt: string;
  clientId: string | null;
  schedule: string;
  scheduleLabel: string;
  estimatedMinutesSaved: number | null;
}

/** Form compartilhado entre criar e editar: com `initial` vem pré-preenchido
 * (edição), sem ele começa zerado com Bento selecionado (criação). */
export function AutomationForm({
  initial,
  isPending,
  error,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Automation;
  isPending: boolean;
  error: unknown;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: AutomationFormValues) => void;
  onCancel: () => void;
}) {
  const initialPreset = initial
    ? SCHEDULE_PRESETS.some((preset) => preset.schedule === initial.schedule)
      ? initial.schedule
      : 'custom'
    : SCHEDULE_PRESETS[0].schedule;

  const [name, setName] = useState(initial?.name ?? '');
  const [agent, setAgent] = useState<AgentName>(initial?.agent ?? 'bento');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [clientId, setClientId] = useState<string | null>(initial?.clientId ?? null);
  const [presetSchedule, setPresetSchedule] = useState<string>(initialPreset);
  const [customSchedule, setCustomSchedule] = useState(
    initial && initialPreset === 'custom' ? initial.schedule : '',
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    initial?.estimatedMinutesSaved?.toString() ?? '',
  );

  const isCustom = presetSchedule === 'custom';
  const schedule = isCustom ? customSchedule.trim() : presetSchedule;
  const scheduleLabel = isCustom
    ? `Personalizado (${customSchedule.trim() || '?'})`
    : SCHEDULE_PRESETS.find((preset) => preset.schedule === presetSchedule)?.label ?? presetSchedule;
  const estimatedMinutesSaved = estimatedMinutes.trim() === '' ? null : Math.max(0, Number(estimatedMinutes));

  const canSubmit = name.trim() && prompt.trim() && schedule;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      agent,
      prompt: prompt.trim(),
      clientId,
      schedule,
      scheduleLabel,
      estimatedMinutesSaved,
    });
  }

  /** Recalcula a cada tecla no campo cron: a pergunta é sobre o que está escrito AGORA. */
  const previa = useMemo(() => proximasDoCron(schedule, new Date(), 3), [schedule]);

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="automation-name" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
          Nome
        </label>
        <input
          id="automation-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex: Briefing da manhã"
          className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
        />
      </div>

      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">Agente</p>
        <div className="flex gap-2">
          {FEATURED_AGENTS.map((option) => {
            const meta = AGENT_META[option];
            const active = agent === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setAgent(option)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm transition-colors',
                  active
                    ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                    : 'border-grafite-elevado bg-carbono text-nevoa hover:text-branco-cru',
                )}
              >
                <AgentAvatar agent={option} size="sm" />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="automation-prompt" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
          O que pedir
        </label>
        <textarea
          id="automation-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder="Ex: Olhe o ClickUp e me diga o que precisa ser feito hoje e quais clientes estão sem resposta."
          className="w-full resize-none rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
        />
      </div>

      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">Projeto (opcional)</p>
        <ClientSelector value={clientId} onChange={setClientId} />
      </div>

      <div>
        <label htmlFor="automation-schedule" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
          Quando disparar
        </label>
        <select
          id="automation-schedule"
          value={presetSchedule}
          onChange={(event) => setPresetSchedule(event.target.value)}
          className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
        >
          {SCHEDULE_PRESETS.map((preset) => (
            <option key={preset.schedule} value={preset.schedule}>
              {preset.label}
            </option>
          ))}
        </select>
        {isCustom && (
          <input
            value={customSchedule}
            onChange={(event) => setCustomSchedule(event.target.value)}
            placeholder="0 8 * * * (minuto hora dia mês dia-da-semana)"
            aria-label="Expressão cron personalizada"
            className="mt-2 w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 font-mono text-xs text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
          />
        )}

        {/*
          * O QUE ESTE PADRÃO SIGNIFICA, enquanto a pessoa ainda está decidindo.
          *
          * Escolher "0 8 * * *" num seletor e descobrir no dia seguinte que o
          * briefing não chegou é caro. A prévia responde "então isso dispara
          * quando?" na hora.
          *
          * E ela se anuncia como PRÉVIA DO PADRÃO, não como próxima execução.
          * A resposta autoritativa é o `next` do repeatable do BullMQ e só
          * existe depois de salvar, porque quem decide é o agendador. As duas
          * divergem justamente quando importa: fuso diferente no servidor,
          * repeatable que não foi registrado, automação desligada. Chamar esta
          * conta de "próxima execução" seria uma segunda opinião sobre o mesmo
          * cron, com a confiança de um dado medido.
          */}
        <div className="mt-2 rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Este padrão dispara</p>
          {previa.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {previa.map((quando) => (
                <li key={quando.toISOString()} className="font-mono text-xs text-branco-cru">
                  {FORMATO_DA_PREVIA.format(quando)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-aviso">
              Não consegui ler este padrão. Confira a expressão antes de salvar: sem leitura, não dá para dizer quando
              ela dispararia.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-nevoa">
            Prévia do padrão, calculada aqui. O horário valendo é o que o agendador registrar ao salvar.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="automation-estimated" className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
          Minutos economizados por execução (opcional)
        </label>
        <input
          id="automation-estimated"
          type="number"
          min={0}
          value={estimatedMinutes}
          onChange={(event) => setEstimatedMinutes(event.target.value)}
          placeholder="Ex: 20"
          className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
        />
        <p className="mt-1 text-xs text-nevoa">Usado no cálculo de economia de tempo.</p>
      </div>

      {Boolean(error) && (
        <p className="text-xs text-erro">
          {error instanceof ApiRequestError ? error.message : 'Não foi possível salvar a automação.'}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-sm text-nevoa transition-colors hover:text-branco-cru">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending || !canSubmit}
          className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          {isPending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
