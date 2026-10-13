'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Maximize2, X } from 'lucide-react';
import type { ExecutionStatus } from '@desigual-os/types';
import { MarkdownLite } from '@/lib/markdown-lite';
import { realtimeClient, type MessageDeltaPayload } from '@/lib/realtime/ws-client';
import { useConversationMessages } from '@/hooks/use-conversations';
import { useExecution } from '@/hooks/use-executions';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMe } from '@/hooks/use-me';
import { useMyWorkspace } from '@/hooks/use-my-workspace';
import { useSendChatMessage } from '@/hooks/use-send-chat-message';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

/**
 * A BOLHA DO BENTO — o chat a um clique, de qualquer tela.
 *
 * O Bento sempre existiu em /chat, e chegar nele custava sair do que se estava
 * fazendo: a pergunta que alguém faz enquanto olha uma tela ("de quem é essa
 * demanda?", "o que ficou combinado com a Colormaq?") morre no caminho até
 * outra rota. A bolha existe para essa pergunta — a que não vale uma troca de
 * contexto.
 *
 * O QUE ELA NÃO É: uma segunda implementação do chat. Sem seleção de agente
 * (é o Bento, sempre), sem cliente, sem anexo, sem projeto, sem histórico de
 * conversas. Uma conversa por sessão, e o botão de expandir leva à thread
 * inteira em /chat com a MESMA conversa aberta — nada do que foi dito aqui
 * fica preso aqui, porque tudo já está no banco desde o primeiro turno.
 *
 * A MECÂNICA DE ENVIO É A MESMA DA THREAD (chat-thread.tsx), reduzida ao
 * essencial: um par otimista local enquanto o banco não alcança, o status real
 * vindo do poll da execution, o texto vindo do WS (`message.delta`) assim que
 * existe, e o histórico persistido assumindo a renderização quando chega. Sem
 * isso, a resposta aparecia só no refetch e a bolha parecia travada.
 */

/** Se a execution seguir ativa além disto, o worker provavelmente morreu no
 *  meio: o balão vira falha honesta em vez de "pensando" eterno. Mesmo teto da
 *  thread grande. */
const WATCHDOG_MS = 6 * 60 * 1000;

interface EmAndamento {
  conversationId: string | null;
  executionId: string | null;
  status: ExecutionStatus;
  pergunta: string;
  resposta: string;
  enviadaEm: number;
  watchdogDisparou?: boolean;
}

export function BentoBolha() {
  const queryClient = useQueryClient();
  const reduzirMovimento = useReducedMotion();
  const { data: me } = useMe();
  const { isMaster } = useIsMaster();
  const { data: workspace } = useMyWorkspace();
  const studioAberto = useUiStore((state) => state.studioModalOpen);

  const [aberta, setAberta] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [emAndamento, setEmAndamento] = useState<EmAndamento | null>(null);

  const enviar = useSendChatMessage();
  const { data: execution } = useExecution(
    emAndamento?.executionId && !emAndamento.watchdogDisparou ? emAndamento.executionId : null,
  );
  const { data: persistidas } = useConversationMessages(aberta ? conversationId : null);

  const campoRef = useRef<HTMLTextAreaElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  /**
   * MESMO GATE DA NAVEGAÇÃO (nav-visibility.ts): quem não tem o módulo `bento`
   * no workspace não vê o item "Bento" na barra, e uma bolha flutuante por
   * cima de tudo seria a segunda porta sem a regra da primeira. `null` = o
   * /me/workspace ainda não respondeu, e aí não se restringe nada (não é dado
   * sensível, é item de produto).
   */
  const temBento = isMaster || !workspace || workspace.modules.includes('bento');

  /**
   * PERMANENTE EM TODA ABA (pedido do usuário, 07/10/2026). A primeira versão
   * escondia a bolha em /chat, com o argumento de que lá ela seria uma segunda
   * caixa de texto para o mesmo agente. O argumento está certo e a conclusão
   * estava errada: um botão que existe em quase toda tela e some numa é um
   * botão em que não se confia — a pessoa para de contar com ele no canto da
   * visão, que é justamente a única coisa que um botão flutuante oferece.
   *
   * A ÚNICA exceção que sobra é o Studio, e ela não é sobre aba: é um overlay
   * de tela cheia, e flutuar por cima de um modal é cobrir a atenção de quem
   * está no meio de uma tarefa.
   */
  const fazSentidoAqui = temBento && !studioAberto;

  // Esc fecha. Só enquanto está aberta — senão a bolha roubaria o Esc de
  // qualquer modal da tela por baixo.
  useEffect(() => {
    if (!aberta) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAberta(false);
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberta]);

  // Abrir leva o cursor direto pro campo: a bolha existe para uma pergunta
  // rápida, e um clique a mais já é metade do custo que ela veio tirar.
  useEffect(() => {
    if (aberta) requestAnimationFrame(() => campoRef.current?.focus());
  }, [aberta]);

  // Status e resposta da execution (mesmo latch da thread: só 'completed' e
  // 'failed' são terminais, e a guarda de repintura evita realimentar o efeito).
  useEffect(() => {
    if (!execution || !emAndamento?.executionId) return;
    if (emAndamento.status === 'completed') return;
    if (execution.status === 'completed' || execution.status === 'failed') {
      const resposta = execution.steps.at(-1)?.answer ?? '';
      if (emAndamento.status === execution.status && emAndamento.resposta === resposta) return;
      setEmAndamento((atual) => (atual ? { ...atual, status: execution.status, resposta } : atual));
      if (emAndamento.conversationId) {
        queryClient.invalidateQueries({ queryKey: ['conversations', emAndamento.conversationId, 'messages'] });
      }
    } else if (execution.status !== emAndamento.status) {
      setEmAndamento((atual) => (atual ? { ...atual, status: execution.status } : atual));
    }
  }, [execution, emAndamento, queryClient]);

  // Texto ao vivo pelo WS: `delta` é sempre o texto ACUMULADO, então aplicar
  // direto é seguro mesmo fora de ordem ou duplicado.
  useEffect(() => {
    if (!emAndamento?.executionId) return;
    const executionId = emAndamento.executionId;
    return realtimeClient.subscribe((evento) => {
      if (evento.type !== 'message.delta') return;
      const payload = evento.payload as unknown as MessageDeltaPayload;
      if (payload.execution_id !== executionId) return;
      setEmAndamento((atual) =>
        atual && atual.executionId === executionId && atual.status !== 'completed'
          ? { ...atual, resposta: payload.delta, status: payload.done ? 'completed' : 'running' }
          : atual,
      );
      if (payload.done) {
        queryClient.invalidateQueries({ queryKey: ['conversations', payload.conversation_id, 'messages'] });
      }
    });
  }, [emAndamento?.executionId, queryClient]);

  // Worker morto não atualiza o status no servidor, e o poll voltaria "running"
  // para sempre. Passado o teto, falha honesta.
  useEffect(() => {
    if (!emAndamento || emAndamento.status === 'completed' || emAndamento.status === 'failed') return;
    const falhar = () =>
      setEmAndamento((atual) =>
        atual && atual.status !== 'completed' && atual.status !== 'failed'
          ? {
              ...atual,
              status: 'failed',
              resposta: 'O Bento demorou demais para responder. Tente de novo.',
              watchdogDisparou: true,
            }
          : atual,
      );
    const restante = emAndamento.enviadaEm + WATCHDOG_MS - Date.now();
    if (restante <= 0) {
      falhar();
      return;
    }
    const timer = setTimeout(falhar, restante);
    return () => clearTimeout(timer);
  }, [emAndamento?.enviadaEm, emAndamento?.status, emAndamento?.watchdogDisparou]);

  // Quando o banco alcança, o par otimista se aposenta e quem renderiza é o
  // histórico — por isso reabrir a bolha mostra tudo.
  useEffect(() => {
    if (!emAndamento || emAndamento.status !== 'completed' || !persistidas) return;
    const alcancou = persistidas.some(
      (m) => m.role === 'assistant' && new Date(m.createdAt).getTime() >= emAndamento.enviadaEm,
    );
    if (alcancou) setEmAndamento(null);
  }, [persistidas, emAndamento]);

  const historico = persistidas ?? [];
  const usuarioJaPersistido =
    emAndamento !== null &&
    historico.some((m) => m.role === 'user' && new Date(m.createdAt).getTime() >= emAndamento.enviadaEm);
  const agenteJaPersistido =
    emAndamento !== null &&
    historico.some((m) => m.role === 'assistant' && new Date(m.createdAt).getTime() >= emAndamento.enviadaEm);

  const ativo =
    emAndamento !== null && emAndamento.status !== 'completed' && emAndamento.status !== 'failed';

  // A resposta cresce via WS sem mudar a contagem de mensagens — por isso ela
  // entra nas deps, senão o scroll não acompanha o texto chegando.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [historico.length, emAndamento?.resposta, emAndamento?.status, aberta]);

  async function mandar() {
    const pergunta = texto.trim();
    if (!pergunta || ativo || enviar.isPending) return;
    setTexto('');
    const enviadaEm = Date.now();
    setEmAndamento({ conversationId, executionId: null, status: 'queued', pergunta, resposta: '', enviadaEm });

    try {
      const resultado = await enviar.mutateAsync({
        message: pergunta,
        clientId: null,
        agentSelection: 'bento',
        conversationId,
      });
      setConversationId(resultado.conversationId);
      setEmAndamento((atual) =>
        atual && atual.enviadaEm === enviadaEm
          ? { ...atual, conversationId: resultado.conversationId, executionId: resultado.executionId }
          : atual,
      );
      // O POST /chat já gravou a pergunta antes de responder.
      queryClient.invalidateQueries({ queryKey: ['conversations', resultado.conversationId, 'messages'] });
    } catch {
      // Sem execution id não há o que pollar: nada tiraria o balão de "queued".
      setEmAndamento((atual) => (atual ? { ...atual, status: 'failed' } : atual));
    }
  }

  if (!fazSentidoAqui) return null;

  const vazia = historico.length === 0 && emAndamento === null;
  const primeiroNome = me?.name?.trim().split(/\s+/)[0] ?? null;

  return (
    /*
     * CAMADA ABAIXO DA PALETA (⌘K abre em z-[60]) e acima do conteúdo. Um
     * botão flutuante que fica POR CIMA de um overlay de busca é o tipo de
     * detalhe que faz a tela parecer quebrada; o Studio (z-[70]) e os modais
     * (z-[90] pra cima) já passam por cima sozinhos, e o Studio ainda some
     * explicitamente mais acima porque toma a tela inteira.
     */
    <>
      <AnimatePresence>
        {aberta && (
          <motion.div
            role="dialog"
            aria-label="Conversa rápida com o Bento"
            className="fixed bottom-[6.75rem] right-6 z-[54] flex max-h-[min(560px,calc(100vh-9rem))] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-grafite-elevado bg-carbono shadow-elevated"
            initial={reduzirMovimento ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduzirMovimento ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <header className="flex items-center gap-2.5 border-b border-grafite-elevado px-3.5 py-3">
              <Image
                src="/agents/bento.png"
                alt=""
                width={28}
                height={28}
                unoptimized
                className="size-7 shrink-0 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-heading text-sm font-semibold text-branco-cru">Bento</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  {ativo ? 'pensando…' : 'Institucional'}
                </p>
              </div>
              {/* A conversa é a MESMA: expandir abre a thread inteira nela, não
                * começa outra. */}
              <Link
                href={conversationId ? `/chat?agent=bento&conversation=${conversationId}` : '/chat?agent=bento'}
                onClick={() => setAberta(false)}
                aria-label="Abrir a conversa inteira"
                title="Abrir a conversa inteira"
                className="flex size-7 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
              >
                <Maximize2 size={14} />
              </Link>
              <button
                type="button"
                onClick={() => setAberta(false)}
                aria-label="Fechar a conversa com o Bento"
                className="flex size-7 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
              >
                <X size={15} />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3.5">
              {vazia && (
                <div className="py-6 text-center">
                  <p className="font-heading text-sm font-semibold text-branco-cru">
                    {primeiroNome ? `Oi, ${primeiroNome}.` : 'Oi.'}
                  </p>
                  <p className="mx-auto mt-1.5 max-w-[260px] text-[13px] text-nevoa">
                    Pergunte sobre a agência, um cliente ou um processo — sem sair da tela em que você está.
                  </p>
                </div>
              )}

              {historico.map((m) => (
                <Balao key={m.id} dePessoa={m.role === 'user'}>
                  {m.role === 'user' ? <p className="whitespace-pre-wrap">{m.content}</p> : <MarkdownLite text={m.content} />}
                </Balao>
              ))}

              {emAndamento && !usuarioJaPersistido && (
                <Balao dePessoa>
                  <p className="whitespace-pre-wrap">{emAndamento.pergunta}</p>
                </Balao>
              )}

              {emAndamento && !agenteJaPersistido && (
                <Balao dePessoa={false} falhou={emAndamento.status === 'failed'}>
                  {emAndamento.resposta ? (
                    <MarkdownLite text={emAndamento.resposta} />
                  ) : (
                    <Pensando />
                  )}
                </Balao>
              )}

              <div ref={fimRef} />
            </div>

            <div className="border-t border-grafite-elevado p-2.5">
              <div className="flex items-end gap-2 rounded-lg border border-grafite-elevado bg-grafite px-2.5 py-2 focus-within:border-roxo-eletrico/50">
                <label className="sr-only" htmlFor="bento-bolha-campo">
                  Mensagem para o Bento
                </label>
                <textarea
                  id="bento-bolha-campo"
                  ref={campoRef}
                  rows={1}
                  value={texto}
                  disabled={ativo}
                  onChange={(evento) => setTexto(evento.target.value)}
                  onKeyDown={(evento) => {
                    if (evento.key === 'Enter' && !evento.shiftKey) {
                      evento.preventDefault();
                      void mandar();
                    }
                  }}
                  placeholder={ativo ? 'O Bento está respondendo…' : 'Pergunte alguma coisa'}
                  className="max-h-28 min-h-[22px] flex-1 resize-none bg-transparent text-[13px] text-branco-cru placeholder:text-nevoa/60 focus:outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void mandar()}
                  disabled={!texto.trim() || ativo}
                  aria-label="Enviar"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        * A MARCA SOZINHA, sem moldura (pedido do usuário, 07/10/2026). A versão
        * anterior punha o símbolo dentro de um círculo com borda e fundo
        * `grafite` — o resultado era uma marca de 32px espremida numa bola de
        * 56px, competindo com a própria moldura. A marca do OS já é uma forma
        * fechada e de alto contraste: ela não precisa de um prato embaixo.
        *
        * O `drop-shadow` é o que substitui a moldura — é o que garante que o
        * símbolo se destaque tanto do fundo claro quanto do escuro, sem
        * desenhar uma segunda borda em volta.
        *
        * E o botão não vira um "X" quando abre: o painel já tem o próprio botão
        * de fechar no cabeçalho, e trocar a marca por um ícone genérico fazia a
        * identidade sumir exatamente no momento em que a conversa começa.
        */}
      <motion.button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-label={aberta ? 'Fechar a conversa com o Bento' : 'Conversar com o Bento'}
        aria-expanded={aberta}
        title={aberta ? 'Fechar a conversa com o Bento' : 'Conversar com o Bento'}
        {...(reduzirMovimento ? {} : { whileHover: { scale: 1.06 }, whileTap: { scale: 0.94 } })}
        className="fixed bottom-6 right-6 z-[55] flex size-16 items-center justify-center rounded-xl transition-opacity hover:opacity-90"
      >
        {/*
          * `os-mark-icon.png`, não `os-mark.png`. O arquivo original é uma peça
          * de apresentação: 1536x1024, o ícone no meio e o resto preto. Toda
          * vez que ele era espremido num quadrado pequeno — aqui e no seletor
          * de agência da barra lateral — o que aparecia era uma TARJA PRETA com
          * um símbolo minúsculo dentro, que foi exatamente a leitura de
          * "comprimido". Este é o mesmo arquivo recortado no ícone, quadrado,
          * 256px.
          */}
        <Image
          src="/brand/os-mark-icon.png"
          alt=""
          width={128}
          height={128}
          unoptimized
          priority
          className={cn(
            'size-16 rounded-[22%] drop-shadow-[0_6px_16px_rgba(0,0,0,0.45)] transition-transform',
            aberta && 'scale-95',
          )}
        />
        {/* Pulso só enquanto o Bento responde de bolha FECHADA: é o único
          * momento em que há algo acontecendo que a pessoa não está vendo. */}
        {ativo && !aberta && (
          <span className="absolute right-0 top-0 flex size-3.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-roxo-eletrico/70" />
            <span className="relative inline-flex size-3.5 rounded-full border-2 border-carbono bg-roxo-eletrico" />
          </span>
        )}
      </motion.button>
    </>
  );
}

function Balao({
  dePessoa,
  falhou,
  children,
}: {
  dePessoa: boolean;
  falhou?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex', dePessoa ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed',
          dePessoa
            ? 'bg-roxo-eletrico text-branco-cru'
            : falhou
              ? 'border border-erro/30 bg-erro/10 text-erro'
              : 'border border-grafite-elevado bg-grafite text-branco-cru',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Três pontos, sem inventar etapa nenhuma: a bolha não tem espaço para
 *  mostrar as fases do agent loop, e etapa fabricada é pior que silêncio. */
function Pensando() {
  return (
    <span className="flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-nevoa"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
