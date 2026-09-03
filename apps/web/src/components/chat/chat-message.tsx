'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Forward, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Chip } from '@/components/ui/chip';
import { MarkdownLite } from '@/lib/markdown-lite';
import { AGENT_META } from '@/lib/agent-meta';
import { ThinkingSteps } from './thinking-steps';
import { useTypewriter } from '@/hooks/use-typewriter';
import type { AgentName, ExecutionStatus } from '@desigual-os/types';
import type { TeamMember } from '@/lib/api/contracts';

export interface ChatUiMessage {
  id: string;
  role: 'user' | 'assistant';
  agent?: AgentName | undefined;
  content: string;
  status?: ExecutionStatus | undefined;
  sources?: string[];
  clientName?: string | null;
}

export function ChatMessage({
  message,
  forwardTargets = [],
  onForward,
}: {
  message: ChatUiMessage;
  /** Colaboradores pra quem esta resposta pode ser encaminhada como DM. */
  forwardTargets?: TeamMember[];
  onForward?: (recipientId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwarded, setForwarded] = useState(false);
  const forwardRef = useRef<HTMLDivElement>(null);
  const streamedContent = useTypewriter(message.content, message.status === 'completed');

  useEffect(() => {
    if (!forwardOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (forwardRef.current && !forwardRef.current.contains(event.target as Node)) setForwardOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [forwardOpen]);

  function handleForwardTo(recipientId: string) {
    onForward?.(recipientId);
    setForwardOpen(false);
    setForwarded(true);
    setTimeout(() => setForwarded(false), 1500);
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-lg rounded-tr-sm bg-roxo-eletrico/15 border border-roxo-eletrico/30 px-4 py-3 text-sm text-branco-cru">
          {message.content}
        </div>
      </div>
    );
  }

  const pending = message.status === 'queued' || message.status === 'running';
  const meta = message.agent ? AGENT_META[message.agent] : null;

  async function handleCopy() {
    await navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex gap-3">
      {message.agent && <AgentAvatar agent={message.agent} />}
      <div className="min-w-0 flex-1">
        {meta && (
          <p className={`mb-1.5 font-mono text-xs font-semibold uppercase tracking-wider ${meta.textClass}`}>
            {meta.label}
          </p>
        )}

        {pending ? (
          <ThinkingSteps status={message.status ?? 'queued'} clientName={message.clientName ?? null} />
        ) : message.status === 'failed' ? (
          <p className="rounded-lg border border-erro/30 bg-erro/10 px-4 py-3 text-sm text-erro">
            Não consegui concluir essa resposta. Tente reformular a pergunta.
          </p>
        ) : (
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-3 text-sm leading-relaxed text-branco-cru">
            <MarkdownLite text={streamedContent} />

            {message.sources && message.sources.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-grafite-elevado pt-3">
                {message.sources.map((source) => (
                  <Chip key={source} label={source} />
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center gap-1 border-t border-grafite-elevado pt-2 text-nevoa">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded p-1.5 text-xs transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
              >
                <Copy size={13} />
                {copied ? 'Copiado' : ''}
              </button>
              <button
                type="button"
                className="rounded p-1.5 transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
              >
                <RotateCcw size={13} />
              </button>
              <button
                type="button"
                className="rounded p-1.5 transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
              >
                <ThumbsUp size={13} />
              </button>
              <button
                type="button"
                className="rounded p-1.5 transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
              >
                <ThumbsDown size={13} />
              </button>

              {forwardTargets.length > 0 && (
                <div ref={forwardRef} className="relative ml-auto">
                  <button
                    type="button"
                    onClick={() => setForwardOpen((current) => !current)}
                    className="flex items-center gap-1 rounded p-1.5 text-xs transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
                  >
                    <Forward size={13} />
                    {forwarded ? 'Encaminhado' : 'Encaminhar'}
                  </button>

                  {forwardOpen && (
                    <div className="absolute bottom-full right-0 z-10 mb-1 max-h-56 w-56 overflow-y-auto rounded-md border border-grafite-elevado bg-grafite-elevado p-1 shadow-elevated">
                      <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">
                        Encaminhar para
                      </p>
                      {forwardTargets.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => handleForwardTo(member.id)}
                          className="block w-full truncate rounded px-2 py-1.5 text-left text-sm text-branco-cru transition-colors hover:bg-carbono"
                        >
                          {member.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
