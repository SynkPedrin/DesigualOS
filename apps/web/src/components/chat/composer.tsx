'use client';

import { useState } from 'react';
import { ArrowUp, Mic, Paperclip } from 'lucide-react';
import { agentSelectionLabel } from '@/lib/agent-meta';
import type { AgentSelection } from '@/lib/api/contracts';

export function Composer({
  onSend,
  disabled,
  agentSelection,
}: {
  onSend: (message: string) => void;
  disabled: boolean;
  agentSelection: AgentSelection;
}) {
  const [value, setValue] = useState('');

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <form onSubmit={handleSubmit} className="shrink-0">
      <div className="flex items-end gap-2 rounded-lg border border-grafite-elevado bg-grafite p-2 focus-within:border-roxo-eletrico/60">
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
          aria-label="Anexar arquivo"
        >
          <Paperclip size={17} />
        </button>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event);
            }
          }}
          rows={1}
          placeholder={`Pergunte para ${agentSelectionLabel(agentSelection)}...`}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm text-branco-cru placeholder:text-nevoa focus:outline-none"
        />
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
          aria-label="Gravar áudio"
        >
          <Mic size={17} />
        </button>
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40 disabled:hover:shadow-none"
          aria-label="Enviar mensagem"
        >
          <ArrowUp size={17} />
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-nevoa">
        {agentSelectionLabel(agentSelection)} pode cometer erros. Sempre valide informações críticas.
      </p>
    </form>
  );
}
