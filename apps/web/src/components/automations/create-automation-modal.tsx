'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { AgentName } from '@desigual-os/types';
import { AGENT_META, FEATURED_AGENTS } from '@/lib/agent-meta';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { ClientSelector } from '@/components/chat/client-selector';
import { useCreateAutomation } from '@/hooks/use-automations';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const SCHEDULE_PRESETS = [
  { schedule: '0 8 * * *', label: 'Todos os dias às 08:00' },
  { schedule: '0 12 * * *', label: 'Todos os dias às 12:00' },
  { schedule: '0 18 * * *', label: 'Todos os dias às 18:00' },
  { schedule: '0 * * * *', label: 'A cada hora' },
  { schedule: 'custom', label: 'Personalizado (cron)' },
] as const;

export function CreateAutomationModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [agent, setAgent] = useState<AgentName>('bento');
  const [prompt, setPrompt] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [presetSchedule, setPresetSchedule] = useState<string>(SCHEDULE_PRESETS[0].schedule);
  const [customSchedule, setCustomSchedule] = useState('');
  const createAutomation = useCreateAutomation();

  const isCustom = presetSchedule === 'custom';
  const schedule = isCustom ? customSchedule.trim() : presetSchedule;
  const scheduleLabel = isCustom
    ? `Personalizado (${customSchedule.trim() || '?'})`
    : SCHEDULE_PRESETS.find((p) => p.schedule === presetSchedule)?.label ?? presetSchedule;

  const canSubmit = name.trim() && prompt.trim() && schedule;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    createAutomation.mutate(
      { name: name.trim(), agent, prompt: prompt.trim(), client_id: clientId, schedule, schedule_label: scheduleLabel },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">
            Nova automação
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

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
                className="mt-2 w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 font-mono text-xs text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
              />
            )}
          </div>

          {createAutomation.isError && (
            <p className="text-xs text-erro">
              {createAutomation.error instanceof ApiRequestError ? createAutomation.error.message : 'Não foi possível criar a automação.'}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa transition-colors hover:text-branco-cru">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createAutomation.isPending || !canSubmit}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
            >
              {createAutomation.isPending ? 'Criando...' : 'Criar automação'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
