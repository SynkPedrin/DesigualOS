import { db, schema } from '@desigual-os/database';
import { desc, eq, sql } from 'drizzle-orm';
import type { Logger } from '@desigual-os/logging';

/**
 * integration-health.ts — o silêncio de uma fonte vira estado observável.
 *
 * Incidente que obriga isto (16/09/2026): o webhook do ClickUp apontava para uma
 * URL de ngrok extinta. O ClickUp suspendeu após 102 falhas e parou de entregar
 * evento em 11/09. Por CINCO DIAS o sistema respondeu sobre a operação com
 * naturalidade total, sem receber uma única mudança — e nada no produto
 * distinguia "nada mudou" de "não estou mais recebendo".
 *
 * Aqui o monitor: lê a saúde REAL no ClickUp, mede o último evento recebido,
 * marca degradado e dispara reconciliação de fallback. Frescor deixa de ser
 * suposição.
 */

const FONTE = 'clickup.webhook';
/** Sem evento por mais que isto, numa agência ativa, é sintoma — não calmaria. */
const JANELA_DE_SILENCIO_MIN = 360;

export interface SaudeDaIntegracao {
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  lastEventAt: Date | null;
  minutosSemEvento: number | null;
  failureCount: number;
  detail: string | null;
}

/** Consulta a saúde do webhook no próprio ClickUp: é ele quem suspende. */
async function saudeNoClickUp(): Promise<{ suspenso: boolean; falhas: number; endpoint: string | null } | null> {
  const apiKey = process.env.CLICKUP_API_KEY;
  const teamId = process.env.CLICKUP_TEAM_ID;
  if (!apiKey || !teamId) return null;
  const r = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/webhook`, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { webhooks?: Array<{ endpoint?: string; health?: { status?: string; fail_count?: number } }> } | null;
  const w = j?.webhooks?.[0];
  if (!w) return { suspenso: true, falhas: 0, endpoint: null };
  return {
    suspenso: (w.health?.status ?? '') !== 'active',
    falhas: Number(w.health?.fail_count ?? 0),
    endpoint: w.endpoint ?? null,
  };
}

export async function checkIntegrationHealth(logger: Logger): Promise<SaudeDaIntegracao> {
  const agora = new Date();

  const [ultimo] = await db
    .select({ occurredAt: schema.operationalEvents.occurredAt })
    .from(schema.operationalEvents)
    .where(eq(schema.operationalEvents.source, 'clickup'))
    .orderBy(desc(schema.operationalEvents.occurredAt))
    .limit(1)
    .catch(() => []);

  const lastEventAt = ultimo?.occurredAt ?? null;
  const minutosSemEvento = lastEventAt
    ? Math.round((agora.getTime() - lastEventAt.getTime()) / 60_000)
    : null;

  const noClickUp = await saudeNoClickUp();

  let status: SaudeDaIntegracao['status'] = 'ok';
  const motivos: string[] = [];

  if (noClickUp === null) {
    status = 'unknown';
    motivos.push('não consegui ler a saúde do webhook no ClickUp');
  } else if (noClickUp.suspenso) {
    // Suspenso é DOWN, não degradado: nada chega, e o ClickUp não volta sozinho.
    status = 'down';
    motivos.push(`webhook suspenso no ClickUp após ${noClickUp.falhas} falhas (endpoint: ${noClickUp.endpoint ?? 'ausente'})`);
  }

  if (minutosSemEvento === null) {
    if (status === 'ok') status = 'degraded';
    motivos.push('nenhum evento do ClickUp jamais recebido');
  } else if (minutosSemEvento > JANELA_DE_SILENCIO_MIN && status === 'ok') {
    status = 'degraded';
    motivos.push(`sem evento há ${minutosSemEvento} min`);
  }

  const detail = motivos.length > 0 ? motivos.join('; ') : null;

  await db
    .insert(schema.integrationHealth)
    .values({
      source: FONTE,
      status,
      lastEventAt,
      lastCheckedAt: agora,
      failureCount: noClickUp?.falhas ?? 0,
      staleAfterMinutes: JANELA_DE_SILENCIO_MIN,
      detail,
      metadata: { endpoint: noClickUp?.endpoint ?? null },
      updatedAt: agora,
    })
    .onConflictDoUpdate({
      target: schema.integrationHealth.source,
      set: {
        status, lastEventAt, lastCheckedAt: agora,
        failureCount: noClickUp?.falhas ?? 0, detail,
        metadata: { endpoint: noClickUp?.endpoint ?? null },
        updatedAt: agora,
      },
    })
    .catch(() => undefined);

  if (status !== 'ok') {
    logger.warn({ status, detail, minutosSemEvento }, '[integracao] ClickUp fora do esperado');
  }

  return { status, lastEventAt, minutosSemEvento, failureCount: noClickUp?.falhas ?? 0, detail };
}

/**
 * Frescor declarado para o prompt. O agente precisa poder dizer "meu
 * conhecimento da operação está atrasado" em vez de responder como se estivesse
 * em dia — que foi exatamente o que aconteceu durante os cinco dias do
 * incidente.
 */
export async function formatFreshnessWarning(): Promise<string> {
  const [h] = await db
    .select({ status: schema.integrationHealth.status, lastEventAt: schema.integrationHealth.lastEventAt, detail: schema.integrationHealth.detail })
    .from(schema.integrationHealth)
    .where(eq(schema.integrationHealth.source, FONTE))
    .catch(() => []);
  if (!h || h.status === 'ok') return '';
  const desde = h.lastEventAt ? h.lastEventAt.toISOString().slice(0, 16).replace('T', ' ') : 'nunca';
  return [
    'FRESCOR DO CONHECIMENTO: ATRASADO.',
    `A sincronização com o ClickUp está "${h.status}" (${h.detail ?? 'sem detalhe'}). Último evento recebido: ${desde}.`,
    'Tarefas e comentários criados depois disso podem não estar aqui. Quando a resposta depender do',
    'estado ATUAL da operação, diga que o dado pode estar atrasado. NÃO afirme que nada mudou.',
  ].join('\n');
}

/** Quantos clientes existem, para o fallback decidir se vale reconciliar. */
export async function contarClientesComLista(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.clients)
    .where(sql`${schema.clients.clickupListId} is not null and ${schema.clients.deletedAt} is null`)
    .catch(() => []);
  return r?.n ?? 0;
}
