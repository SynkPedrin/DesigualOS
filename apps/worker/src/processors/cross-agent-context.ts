import { db, schema } from '@desigual-os/database';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { enviarMensagemA2A, recallEpisodes } from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';

/**
 * cross-agent-context.ts — o domínio do outro agente, servido por DADO.
 *
 * A operação pediu que ninguém precise trocar de agente para ter contexto: quem
 * está com o Otto não deveria abrir o Bento para saber prazo, e quem está com o
 * Bento não deveria abrir o Otto para saber o que foi decidido na campanha.
 *
 * A tentação óbvia é fazer um agente chamar o outro. Recusado: dois modelos
 * conversando custa dois turnos, arrisca loop e produz verdade construída em
 * consenso entre dois que estavam adivinhando. Aqui o pedido é registrado como
 * envelope A2A (auditável, com teto de salto) e ATENDIDO PELA FONTE — ClickUp e
 * registro de campanha para o lado operacional, memória criativa e episódios
 * para o lado criativo.
 */

/** O turno pede estado da operação? (prazo, responsável, status, atraso) */
const PEDE_OPERACIONAL =
  /\b(prazo|deadline|vence|venceu|atras|respons[áa]vel|quem (est[áa]|vai) (fazendo|faz)|status|andamento|entreg(a|ou)|pendenc|pend[êe]ncia|aprovad|em aberto)\b/i;

/** O turno pede o que foi decidido/criado? (briefing, conceito, feedback) */
const PEDE_CRIATIVO =
  /\b(briefing|conceito|dire[çc][ãa]o|decidimo|decidiu|feedback|aprovou|reprovou|tom de voz|posicionamento|o que mudou (na|nessa) campanha)\b/i;

export interface ContextoCruzado {
  bloco: string;
  /** Para observabilidade: houve A2A neste turno e de que tipo. */
  chamadas: Array<{ de: string; para: string; tipo: string; hop: number }>;
}

const VAZIO: ContextoCruzado = { bloco: '', chamadas: [] };

/**
 * Snapshot OPERACIONAL de uma campanha: o que o Bento saberia. Sai do registro
 * de campanhas (derivado do ClickUp), não de texto gerado.
 */
async function snapshotOperacional(campaignId: string): Promise<string[]> {
  const [c] = await db
    .select({
      nome: schema.campaigns.canonicalName,
      status: schema.campaigns.status,
      total: schema.campaigns.taskCount,
      abertas: schema.campaigns.openTaskCount,
      atualizada: schema.campaigns.lastSourceUpdateAt,
      recentes: schema.campaigns.recentTasks,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .catch(() => []);
  if (!c) return [];

  const linhas = [
    `Situação operacional de "${c.nome}": ${c.abertas} de ${c.total} tarefas em aberto (${c.status === 'active' ? 'campanha ativa' : 'campanha encerrada'}).`,
  ];
  if (c.atualizada) linhas.push(`Última movimentação no ClickUp: ${c.atualizada.toISOString().slice(0, 10)}.`);
  const abertas = (c.recentes ?? []).filter((t) => !t.closed).slice(0, 8);
  if (abertas.length > 0) {
    linhas.push('Em aberto agora:');
    for (const t of abertas) linhas.push(`- ${t.name}${t.status ? ` [${t.status}]` : ''}`);
  }
  return linhas;
}

/**
 * Snapshot CRIATIVO de um cliente: o que o Otto saberia. Sai de feedback
 * registrado e de episódios de decisão — nunca de invenção.
 */
async function snapshotCriativo(clientId: string): Promise<string[]> {
  const linhas: string[] = [];

  const feedbacks = await db
    .select({ content: schema.memories.content, updatedAt: schema.memories.updatedAt })
    .from(schema.memories)
    .where(
      and(
        eq(schema.memories.clientId, clientId),
        eq(schema.memories.status, 'active'),
        eq(schema.memories.environment, 'production'),
        inArray(schema.memories.kind, ['otto.feedback', 'client.preference']),
      ),
    )
    .orderBy(desc(schema.memories.updatedAt))
    .limit(6)
    .catch(() => []);
  if (feedbacks.length > 0) {
    linhas.push('Direção criativa já registrada para este cliente:');
    for (const f of feedbacks) linhas.push(`- ${f.content.slice(0, 220)}`);
  }

  const episodios = await recallEpisodes({
    clientId,
    desde: new Date(Date.now() - 30 * 86_400_000),
    limit: 6,
  }).catch(() => []);
  const relevantes = episodios.filter((e) => e.eventType === 'decision' || e.eventType === 'feedback');
  if (relevantes.length > 0) {
    linhas.push('Decisões e feedbacks recentes:');
    for (const e of relevantes) {
      linhas.push(`- [${e.occurredAt.toISOString().slice(0, 10)}] ${e.summary.slice(0, 200)}`);
    }
  }
  return linhas;
}

/**
 * Monta o contexto do OUTRO domínio quando o turno precisa dele.
 *
 * Só dispara quando o texto pede — e só do domínio que o agente atual NÃO
 * cobre. Puxar sempre seria despejo; puxar do próprio domínio seria redundância.
 */
export async function resolveCrossAgentContext(params: {
  agent: string;
  message: string;
  executionId: string;
  clientId: string | null;
  campaignId: string | null;
  logger: Logger;
}): Promise<ContextoCruzado> {
  const { agent, message, executionId, clientId, campaignId, logger } = params;

  // Otto precisando de operação -> pede ao domínio do Bento.
  if (agent === 'otto' && campaignId && PEDE_OPERACIONAL.test(message)) {
    const r = await enviarMensagemA2A({
      executionId,
      fromAgent: 'otto',
      toAgent: 'bento',
      type: 'CONTEXT_REQUEST',
      clientId,
      campaignId,
      requestedContext: ['status', 'prazo', 'responsavel'],
    }).catch(() => ({ ok: false, hop: 0 }) as const);
    if (!r.ok) return VAZIO;

    const linhas = await snapshotOperacional(campaignId).catch(() => []);
    if (linhas.length === 0) return VAZIO;
    logger.info({ executionId, hop: r.hop }, '[a2a] otto -> bento: contexto operacional');
    return {
      bloco: [
        'CONTEXTO OPERACIONAL (fornecido pelo domínio do Bento, lido do ClickUp):',
        ...linhas,
        '',
        'Use como estado REAL da operação. NÃO invente prazo, responsável nem status.',
      ].join('\n'),
      chamadas: [{ de: 'otto', para: 'bento', tipo: 'CONTEXT_REQUEST', hop: r.hop }],
    };
  }

  // Bento precisando de criativo -> pede ao domínio do Otto.
  if (agent === 'bento' && clientId && PEDE_CRIATIVO.test(message)) {
    const r = await enviarMensagemA2A({
      executionId,
      fromAgent: 'bento',
      toAgent: 'otto',
      type: 'CONTEXT_REQUEST',
      clientId,
      campaignId,
      requestedContext: ['feedback', 'decisoes', 'direcao_criativa'],
    }).catch(() => ({ ok: false, hop: 0 }) as const);
    if (!r.ok) return VAZIO;

    const linhas = await snapshotCriativo(clientId).catch(() => []);
    if (linhas.length === 0) return VAZIO;
    logger.info({ executionId, hop: r.hop }, '[a2a] bento -> otto: contexto criativo');
    return {
      bloco: [
        'CONTEXTO CRIATIVO (fornecido pelo domínio do Otto, lido da memória registrada):',
        ...linhas,
        '',
        'Use como o que REALMENTE foi decidido. NÃO invente direção criativa.',
      ].join('\n'),
      chamadas: [{ de: 'bento', para: 'otto', tipo: 'CONTEXT_REQUEST', hop: r.hop }],
    };
  }

  return VAZIO;
}
