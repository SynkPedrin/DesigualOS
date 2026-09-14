'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, FileText, Forward, RotateCcw } from 'lucide-react';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Chip } from '@/components/ui/chip';
import { MarkdownLite } from '@/lib/markdown-lite';
import { AGENT_META } from '@/lib/agent-meta';
import { ThinkingSteps } from './thinking-steps';
import { useTypewriter } from '@/hooks/use-typewriter';
import { formatClockTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AgentName, ExecutionStatus } from '@desigual-os/types';
import type { TeamMember } from '@/lib/api/contracts';

/** Anexo de mensagem persistida (attachment_url/type/filename do backend). */
export interface ChatUiAttachment {
  url: string;
  type: string | null;
  filename: string | null;
}

export interface ChatUiMessage {
  id: string;
  role: 'user' | 'assistant';
  agent?: AgentName | undefined;
  content: string;
  status?: ExecutionStatus | undefined;
  sources?: string[];
  clientName?: string | null;
  /** @deprecated usar `attachments`; mantido pra não quebrar quem só manda um. */
  attachment?: ChatUiAttachment | null | undefined;
  attachments?: ChatUiAttachment[] | undefined;
  /** Fases REAIS do agent loop (eventos agent.phase do WS, Agentic V2).
   * Presentes, o ThinkingSteps mostra o que o backend reportou de verdade
   * em vez das etapas genéricas por intervalo. */
  liveSteps?: string[] | undefined;
  createdAt?: string | undefined;
}

/** Anexo no balão: imagem vira thumbnail clicável; qualquer outro tipo vira
 * chip com ícone + nome + link (abre numa aba nova). */
function ChatAttachmentView({ attachment }: { attachment: ChatUiAttachment }) {
  if (attachment.type?.startsWith('image/')) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
        <img
          src={attachment.url}
          alt={attachment.filename ?? 'imagem anexada'}
          className="h-auto max-w-[240px] rounded-md border border-white/10 object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-[240px] items-center gap-2 rounded-md border border-white/10 bg-carbono/40 px-3 py-2 text-xs text-branco-cru/80 transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
    >
      <FileText size={14} className="shrink-0" />
      <span className="truncate">{attachment.filename ?? 'arquivo'}</span>
    </a>
  );
}

/** Quebra a mensagem em blocos (mesma fronteira do MarkdownLite: linha em
 * branco). Cada bloco vira um balão próprio, estilo WhatsApp - durante o
 * streaming os balões vão aparecendo conforme os parágrafos se completam. */
function splitChatBlocks(text: string): string[] {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function ChatMessage({
  message,
  forwardTargets = [],
  onForward,
  onRetry,
}: {
  message: ChatUiMessage;
  /** Colaboradores pra quem esta resposta pode ser encaminhada como DM. */
  forwardTargets?: TeamMember[];
  onForward?: (recipientId: string) => void;
  /** Só vem no balão falho do exchange ainda pendente: reenvia a pergunta. */
  onRetry?: (() => void) | undefined;
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
    const blocks = splitChatBlocks(message.content);
    return (
      <div className="flex justify-end">
        <div className="flex max-w-xl flex-col items-end gap-1">
          {(message.attachments?.length ? message.attachments : message.attachment ? [message.attachment] : []).map(
            (attachment, index) => (
              <ChatAttachmentView key={`${attachment.url}-${index}`} attachment={attachment} />
            ),
          )}
          {blocks.map((block, index) => {
            const isLast = index === blocks.length - 1;
            return (
              <div
                key={index}
                className={cn(
                  'rounded-lg border border-roxo-eletrico/30 bg-roxo-eletrico/15 px-4 py-3 text-sm text-branco-cru',
                  isLast && 'rounded-tr-sm',
                )}
              >
                <span className="whitespace-pre-wrap">{block}</span>
                {isLast && message.createdAt && (
                  <span className="ml-2 font-mono text-[10px] text-roxo-eletrico/70">
                    {formatClockTime(message.createdAt)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const pending = message.status === 'queued' || message.status === 'running';
  const meta = message.agent ? AGENT_META[message.agent] : null;
  const blocks = splitChatBlocks(streamedContent);

  async function handleCopy() {
    await navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex gap-3" data-testid={message.role === 'assistant' ? 'chat-assistant-message' : 'chat-user-message'}>
      {message.agent && <AgentAvatar agent={message.agent} />}
      <div className="min-w-0 flex-1">
        {meta && (
          <p className={`mb-1.5 font-mono text-xs font-semibold uppercase tracking-wider ${meta.textClass}`}>
            {meta.label}
          </p>
        )}

        {pending ? (
          <ThinkingSteps
            status={message.status ?? 'queued'}
            clientName={message.clientName ?? null}
            liveSteps={message.liveSteps}
          />
        ) : message.status === 'failed' ? (
          // O worker JÁ grava o motivo real da falha no step ("Não consegui responder agora:
          // fetch failed", "job stalled", etc — ver failExecution em execute-job.ts) e o balão
          // jogava fora, trocando por um texto genérico que manda o usuário "reformular a
          // pergunta" mesmo quando a pergunta não tinha nada de errado (medido no frontend em
          // 10/09/2026: agente indisponível virava "reformule"). Quem está operando precisa
          // saber SE o problema é a pergunta ou é o sistema — são reações opostas.
          <div>
            <p className="rounded-lg border border-erro/30 bg-erro/10 px-4 py-3 text-sm text-erro">
              {message.content?.trim()
                ? message.content
                : 'Não consegui concluir essa resposta. Tente reformular a pergunta.'}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
              >
                <RotateCcw size={12} />
                Tentar novamente
              </button>
            )}
          </div>
        ) : (
          <div className="flex max-w-xl flex-col gap-1">
            {blocks.map((block, index) => {
              const isLast = index === blocks.length - 1;
              return (
                <div
                  key={index}
                  className={cn(
                    'rounded-lg border border-grafite-elevado bg-grafite px-4 py-3 text-sm leading-relaxed text-branco-cru',
                    isLast && 'rounded-tl-sm',
                  )}
                >
                  <MarkdownLite text={block} />

                  {isLast && message.sources && message.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-grafite-elevado pt-3">
                      {message.sources.map((source) => (
                        <Chip key={source} label={source} />
                      ))}
                    </div>
                  )}

                  {isLast && (
                    <div className="mt-3 flex items-center gap-1 border-t border-grafite-elevado pt-2 text-nevoa">
                      <button
                        type="button"
                        onClick={handleCopy}
                        aria-label="Copiar resposta"
                        className="flex items-center gap-1 rounded p-1.5 text-xs transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
                      >
                        <Copy size={13} />
                        {copied ? 'Copiado' : ''}
                      </button>

                      {message.createdAt && (
                        <span className="ml-auto font-mono text-[10px] text-nevoa">
                          {formatClockTime(message.createdAt)}
                        </span>
                      )}

                      {forwardTargets.length > 0 && (
                        <div ref={forwardRef} className={cn('relative', !message.createdAt && 'ml-auto')}>
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
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
