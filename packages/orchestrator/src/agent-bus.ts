import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * agent-bus.ts — A2A TIPADO, mediado, limitado e auditável.
 *
 * O que este módulo recusa a ser: dois modelos conversando. Chat livre entre
 * agentes gera loop, custo sem teto e, pior, verdade construída em consenso
 * entre dois que estavam ambos adivinhando. O que ele é: um envelope com tipo,
 * escopo e limite de salto, em que o pedido é atendido por um PROVEDOR DE
 * DOMÍNIO — dado consultado na fonte, não texto gerado pelo outro agente.
 *
 * A consequência prática é a que a operação pediu: quem está falando com o Otto
 * não precisa abrir o Bento para saber prazo, e quem está com o Bento não
 * precisa abrir o Otto para saber o que foi decidido na campanha.
 */

export type TipoDeMensagemA2A =
  | 'CONTEXT_REQUEST'
  | 'CONTEXT_RESPONSE'
  | 'HANDOFF'
  | 'REVIEW_REQUEST'
  | 'KNOWLEDGE_UPDATE'
  | 'CONFLICT_FOUND';

/** Teto de saltos por execução. Dois basta para pedir e responder. */
export const MAX_SALTOS_A2A = 2;

export interface EnvelopeA2A {
  executionId: string;
  fromAgent: string;
  toAgent: string;
  type: TipoDeMensagemA2A;
  clientId?: string | null;
  campaignId?: string | null;
  requestedContext?: string[];
  facts?: string[];
  sourceRefs?: string[];
  environment?: string;
}

export interface ResultadoA2A {
  ok: boolean;
  motivo?: string;
  hop: number;
}

/** Quantos saltos esta execução já gastou. */
export async function saltosDaExecucao(executionId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.executionId, executionId))
    .catch(() => []);
  return r?.n ?? 0;
}

/**
 * Registra uma mensagem A2A. Recusa quando o teto de saltos foi atingido — o
 * corte é do MEDIADOR, não da boa vontade dos agentes.
 */
export async function enviarMensagemA2A(envelope: EnvelopeA2A): Promise<ResultadoA2A> {
  const jaGastos = await saltosDaExecucao(envelope.executionId);
  if (jaGastos >= MAX_SALTOS_A2A) {
    return { ok: false, motivo: `teto de ${MAX_SALTOS_A2A} saltos A2A atingido nesta execução`, hop: jaGastos };
  }
  const hop = jaGastos + 1;
  await db
    .insert(schema.agentMessages)
    .values({
      executionId: envelope.executionId,
      fromAgent: envelope.fromAgent,
      toAgent: envelope.toAgent,
      type: envelope.type,
      clientId: envelope.clientId ?? null,
      campaignId: envelope.campaignId ?? null,
      requestedContext: envelope.requestedContext ?? [],
      facts: envelope.facts ?? [],
      sourceRefs: envelope.sourceRefs ?? [],
      hop,
      status: 'sent',
      environment: envelope.environment ?? 'production',
    })
    .catch(() => undefined);
  return { ok: true, hop };
}

/** Mensagens da execução, para trace e para o relatório de observabilidade. */
export async function mensagensDaExecucao(executionId: string): Promise<
  Array<{ fromAgent: string; toAgent: string; type: string; hop: number; facts: string[] }>
> {
  const rows = await db
    .select({
      fromAgent: schema.agentMessages.fromAgent,
      toAgent: schema.agentMessages.toAgent,
      type: schema.agentMessages.type,
      hop: schema.agentMessages.hop,
      facts: schema.agentMessages.facts,
    })
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.executionId, executionId))
    .catch(() => []);
  return rows.map((r) => ({ ...r, facts: r.facts ?? [] }));
}

// ---------------------------------------------------------------------------
// BLACKBOARD
// ---------------------------------------------------------------------------

export interface FatoDoBlackboard {
  text: string;
  sourceRef: string;
  agent: string;
}

/**
 * Estado compartilhado da execução. Uma linha por execução; os agentes somam
 * fatos e perguntas pendentes sem reescrever a identidade do escopo — quem
 * define cliente e campanha é a resolução de entidade, não o agente.
 *
 * NÃO ESTÁ EM USO no release atual, e isto é decisão consciente. Medido em
 * 16/09/2026: 27 blackboards gravados, zero com fatos, zero com saída de
 * agente, e nenhum chamador de `lerBlackboard`. A razão é estrutural: cada
 * execução tem UM agente, e o contexto do outro domínio chega pelo A2A
 * source-backed, que lê a fonte direto — não existe o segundo agente que
 * entraria na mesma execução para ler o que o primeiro deixou.
 *
 * Fica como infraestrutura para execução multiagente real, quando houver.
 * Manter a escrita ligada faria o componente parecer vivo numa auditoria
 * futura, que é pior do que não tê-lo.
 */
export async function upsertBlackboard(params: {
  executionId: string;
  clientId?: string | null;
  campaignId?: string | null;
  objective?: string | null;
  facts?: FatoDoBlackboard[];
  sources?: string[];
  decisions?: string[];
  pendingQuestions?: string[];
  agentOutput?: { agent: string; texto: string };
  environment?: string;
}): Promise<void> {
  const [atual] = await db
    .select({
      facts: schema.executionBlackboards.facts,
      sources: schema.executionBlackboards.sources,
      decisions: schema.executionBlackboards.decisions,
      pendingQuestions: schema.executionBlackboards.pendingQuestions,
      agentOutputs: schema.executionBlackboards.agentOutputs,
    })
    .from(schema.executionBlackboards)
    .where(eq(schema.executionBlackboards.executionId, params.executionId))
    .catch(() => []);

  const facts = [...(atual?.facts ?? []), ...(params.facts ?? [])];
  const sources = [...new Set([...(atual?.sources ?? []), ...(params.sources ?? [])])];
  const decisions = [...new Set([...(atual?.decisions ?? []), ...(params.decisions ?? [])])];
  const pendingQuestions = [...new Set([...(atual?.pendingQuestions ?? []), ...(params.pendingQuestions ?? [])])];
  const agentOutputs = { ...(atual?.agentOutputs ?? {}) };
  if (params.agentOutput) agentOutputs[params.agentOutput.agent] = params.agentOutput.texto.slice(0, 4_000);

  const valores = {
    executionId: params.executionId,
    clientId: params.clientId ?? null,
    campaignId: params.campaignId ?? null,
    objective: params.objective ?? null,
    facts, sources, decisions, pendingQuestions, agentOutputs,
    environment: params.environment ?? 'production',
    updatedAt: new Date(),
  };

  await db
    .insert(schema.executionBlackboards)
    .values(valores)
    .onConflictDoUpdate({
      target: schema.executionBlackboards.executionId,
      set: {
        facts, sources, decisions, pendingQuestions, agentOutputs,
        // Identidade do escopo só é preenchida, nunca sobrescrita com nulo.
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(params.campaignId ? { campaignId: params.campaignId } : {}),
        ...(params.objective ? { objective: params.objective } : {}),
        updatedAt: new Date(),
      },
    })
    .catch(() => undefined);
}

export async function lerBlackboard(executionId: string, environment = 'production'): Promise<{
  clientId: string | null;
  campaignId: string | null;
  objective: string | null;
  facts: FatoDoBlackboard[];
  pendingQuestions: string[];
  agentOutputs: Record<string, string>;
} | null> {
  const [r] = await db
    .select({
      clientId: schema.executionBlackboards.clientId,
      campaignId: schema.executionBlackboards.campaignId,
      objective: schema.executionBlackboards.objective,
      facts: schema.executionBlackboards.facts,
      pendingQuestions: schema.executionBlackboards.pendingQuestions,
      agentOutputs: schema.executionBlackboards.agentOutputs,
    })
    .from(schema.executionBlackboards)
    .where(
      and(
        eq(schema.executionBlackboards.executionId, executionId),
        // Ambiente REAL da execução, nunca 'production' fixo.
        eq(schema.executionBlackboards.environment, environment),
      ),
    )
    .catch(() => []);
  if (!r) return null;
  return {
    ...r,
    facts: r.facts ?? [],
    pendingQuestions: r.pendingQuestions ?? [],
    agentOutputs: r.agentOutputs ?? {},
  };
}
