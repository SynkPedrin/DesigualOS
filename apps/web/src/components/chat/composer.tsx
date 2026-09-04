'use client';

import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { agentSelectionLabel } from '@/lib/agent-meta';
import type { AgentSelection } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/**
 * Os botões de anexo e microfone foram REMOVIDOS (2026-09): não tinham handler
 * nenhum e POST /chat não aceita anexo nem áudio — botão morto na home nova
 * seria promessa falsa. Quando o backend suportar, eles voltam aqui.
 */
export function Composer({
  onSend,
  disabled,
  agentSelection,
  variant = 'docked',
  showDisclaimer = true,
  textareaRef,
}: {
  onSend: (message: string) => void;
  disabled: boolean;
  agentSelection: AgentSelection;
  /** hero = protagonista da tela vazia (superfície elevada, glow no foco);
   * docked = rodapé da thread (visual original). Só casca — a lógica é a mesma. */
  variant?: 'hero' | 'docked';
  /** A home do chat renderiza o disclaimer dela ("Desigual OS pode...") fora do
   * composer pra ele sair de cena junto com a saudação; aí este fica desligado. */
  showDisclaimer?: boolean;
  /** Ref da textarea: o "Novo chat" da sidebar foca o composer depois do reset. */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const [value, setValue] = useState('');
  const hero = variant === 'hero';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <form onSubmit={handleSubmit} className="shrink-0">
      <div
        className={cn(
          'flex items-end gap-2 border transition-[border-color,box-shadow] duration-300',
          hero
            ? 'rounded-xl border-white/10 bg-white/[0.04] p-3 shadow-elevated backdrop-blur-md focus-within:border-roxo-eletrico/60 focus-within:shadow-glow'
            : 'rounded-lg border-grafite-elevado bg-grafite p-2 focus-within:border-roxo-eletrico/60',
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event);
            }
          }}
          rows={hero ? 2 : 1}
          placeholder={`Pergunte para ${agentSelectionLabel(agentSelection)}...`}
          className={cn(
            'max-h-40 flex-1 resize-none bg-transparent text-branco-cru placeholder:text-nevoa focus:outline-none',
            hero ? 'min-h-12 py-2 text-base' : 'min-h-9 py-1.5 text-sm',
          )}
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40 disabled:hover:shadow-none',
            hero ? 'size-10' : 'size-9',
          )}
          aria-label="Enviar mensagem"
        >
          <ArrowUp size={17} />
        </button>
      </div>
      {showDisclaimer && (
        <p className="mt-2 text-center text-xs text-nevoa">
          {agentSelectionLabel(agentSelection)} pode cometer erros. Sempre valide informações críticas.
        </p>
      )}
    </form>
  );
}
