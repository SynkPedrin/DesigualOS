import { and, asc, eq, gt } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AuthenticatedUser } from '../auth/middleware';
import { submitChatTurn, type LogDoTurno } from '../chat/turn-service';

/**
 * A PONTE PARA O BRAIN EXISTENTE — sem um segundo Bento.
 *
 * O turno do WhatsApp entra por `submitChatTurn`, a mesma função que serve o
 * `POST /chat` da web: mesma resolução de cliente e de conversa, mesmo
 * contexto operacional com o recorte de carteira DESTE usuário, mesmo
 * despacho para a fila do Bento no worker, mesma persona, mesmos modelos,
 * mesmas ações com a mesma política de confirmação. O agente é fixado em
 * Bento (`agent_hint: 'BENTO'`), igual a escolher o Bento no seletor da web:
 * o número é dele.
 *
 * A resposta é lida de `messages`, que é onde o worker grava o que a web
 * mostra. Não há texto produzido aqui.
 */

export interface AnexoDoTurno {
  url: string;
  filename: string;
  contentType: string;
}

export interface PedidoAoBrain {
  user: AuthenticatedUser;
  conversationId: string | null;
  mensagem: string;
  anexos?: AnexoDoTurno[];
}

export type RespostaDoBrain =
  | { tipo: 'resposta'; texto: string; conversationId: string; executionId: string | null }
  | { tipo: 'falhou'; motivo: string; conversationId: string | null; executionId: string | null }
  | { tipo: 'demorou'; conversationId: string; executionId: string | null }
  | { tipo: 'indisponivel'; motivo: string }
  | { tipo: 'conversa_invalida'; motivo: string }
  | { tipo: 'duplicado' };

export interface Despacho {
  conversationId: string;
  executionId: string | null;
}

export interface BrainDoBento {
  perguntar(
    pedido: PedidoAoBrain,
    opcoes: { prazoMs: number; aoDespachar?: (despacho: Despacho) => Promise<void> | void },
  ): Promise<RespostaDoBrain>;
  /** Retoma a espera de um turno já despachado (recuperação depois de reinício). */
  aguardar(despacho: Despacho & { desde: Date }, prazoMs: number): Promise<RespostaDoBrain>;
}

const ESTADOS_FINAIS = new Set(['completed', 'failed', 'timeout', 'cancelled']);
const INTERVALO_MS = 1_500;
const FOLGA_APOS_TERMINAL_MS = 20_000;

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function respostasDepoisDe(conversationId: string, desde: Date): Promise<string[]> {
  const linhas = await db
    .select({ content: schema.messages.content })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.role, 'assistant'),
        gt(schema.messages.createdAt, desde),
      ),
    )
    .orderBy(asc(schema.messages.createdAt));
  return linhas.map((linha) => linha.content).filter((texto) => texto.trim().length > 0);
}

async function estadoDaExecucao(executionId: string): Promise<string | null> {
  const [linha] = await db
    .select({ status: schema.executions.status })
    .from(schema.executions)
    .where(eq(schema.executions.executionId, executionId));
  return linha?.status ?? null;
}

/**
 * Espera a execução terminar e a resposta aparecer na conversa.
 *
 * Execução terminada com falha também grava mensagem do assistente (o worker
 * escreve o aviso de falha na última tentativa — ver execute-job.ts); se ela
 * vier, é ela que vai. Sem mensagem, o canal declara a falha em vez de
 * inventar uma resposta.
 */
async function aguardarResposta(despacho: Despacho & { desde: Date }, prazoMs: number): Promise<RespostaDoBrain> {
  const limite = Date.now() + prazoMs;
  let estado: string | null = null;
  let finalizouEm: number | null = null;
  while (Date.now() < limite) {
    if (despacho.executionId) estado = await estadoDaExecucao(despacho.executionId);
    const respostas = await respostasDepoisDe(despacho.conversationId, despacho.desde);
    if (respostas.length && (!despacho.executionId || (estado && ESTADOS_FINAIS.has(estado)))) {
      return {
        tipo: 'resposta',
        texto: respostas.join('\n\n'),
        conversationId: despacho.conversationId,
        executionId: despacho.executionId,
      };
    }
    if (estado && ESTADOS_FINAIS.has(estado)) {
      // 'failed' NÃO é necessariamente o fim: o worker marca 'failed' em toda
      // tentativa (failExecution), e o BullMQ re-tenta o Bento uma vez — a
      // nova tentativa volta o status para 'running'. A folga cobre o backoff
      // (2s) e a retomada; na última tentativa o worker grava a mensagem de
      // falha na conversa, e é ela que vai para o WhatsApp.
      finalizouEm ??= Date.now();
      if (Date.now() - finalizouEm > FOLGA_APOS_TERMINAL_MS) {
        return {
          tipo: 'falhou',
          motivo: `execução terminou em '${estado}' sem resposta gravada`,
          conversationId: despacho.conversationId,
          executionId: despacho.executionId,
        };
      }
    }
    if (estado && !ESTADOS_FINAIS.has(estado)) finalizouEm = null;
    await esperar(INTERVALO_MS);
  }
  return { tipo: 'demorou', conversationId: despacho.conversationId, executionId: despacho.executionId };
}

/** Grava o status que `submitChatTurn` escolheria para a resposta HTTP. */
function gravadorDeStatus() {
  const gravado = { status: 200 };
  return {
    gravado,
    reply: {
      code(statusCode: number) {
        gravado.status = statusCode;
        return this;
      },
    },
  };
}

export function brainPeloChat(log: LogDoTurno): BrainDoBento {
  return {
    async perguntar(pedido, opcoes) {
      const { gravado, reply } = gravadorDeStatus();
      let mensagemDoUsuario: { createdAt: Date; conversationId: string } | null = null;
      let corpo: Record<string, unknown>;
      try {
        corpo = await submitChatTurn(
          pedido.user,
          {
            message: pedido.mensagem,
            conversation_id: pedido.conversationId,
            agent_hint: 'BENTO',
            ...(pedido.anexos?.length ? { attachments: pedido.anexos } : {}),
          },
          reply,
          log,
          { onUserMessage: (mensagem) => (mensagemDoUsuario = mensagem) },
        );
      } catch (error) {
        // Exceção dentro do turno (banco, Redis, ...). A web veria um 500.
        const motivo = error instanceof Error ? error.message : String(error);
        return { tipo: 'indisponivel', motivo };
      }

      const status = gravado.status;
      if (status === 503) return { tipo: 'indisponivel', motivo: String(corpo.error ?? 'agente indisponível') };
      if (status === 409) return { tipo: 'duplicado' };
      if (status === 403 || status === 404 || status === 400) {
        return { tipo: 'conversa_invalida', motivo: String(corpo.error ?? `HTTP ${status}`) };
      }
      if (status >= 400) return { tipo: 'indisponivel', motivo: String(corpo.error ?? `HTTP ${status}`) };

      const conversationId = String(corpo.conversation_id ?? '');
      const executionId = typeof corpo.execution_id === 'string' ? corpo.execution_id : null;
      if (!conversationId) return { tipo: 'indisponivel', motivo: 'turno sem conversa' };
      await opcoes.aoDespachar?.({ conversationId, executionId });

      // Reenvio idêntico dentro da janela de 15s do chat devolve a execução
      // original (`deduplicated`) sem gravar mensagem nova; a referência de
      // tempo vira "agora menos a janela", que cobre a resposta original.
      const desde: Date =
        (mensagemDoUsuario as { createdAt: Date } | null)?.createdAt ?? new Date(Date.now() - 20_000);
      return aguardarResposta({ conversationId, executionId, desde }, opcoes.prazoMs);
    },

    aguardar(despacho, prazoMs) {
      return aguardarResposta(despacho, prazoMs);
    },
  };
}
