import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { MetaGraphError, graphGetRetry } from './meta-media-graph';
import { getMetaSystemUserConfig, inspectMetaToken } from './meta-system-user';

/**
 * media-actions.ts — execução de ações em campanha, SEMPRE depois de aprovação humana.
 *
 * Cinco travas, todas independentes:
 *   1. `MEDIA_ACTIONS_ENABLED=true` no servidor (padrão: desligado). Com ele
 *      desligado, aprovar um pedido o marca `blocked`, sem chamar o Meta.
 *   2. O token precisa ter `ads_management` (conferido ao vivo, não suposto).
 *   3. O pedido precisa estar `approved` por uma pessoa.
 *   4. A entidade precisa existir na conta do pedido (nada de id solto).
 *   5. Estado ANTES e DEPOIS são lidos do Meta e gravados: o registro diz o que
 *      realmente mudou, não o que se pretendia mudar.
 *
 * Só campanha, só os três verbos: pausar, reativar, definir orçamento diário.
 * Testes automatizados usam `fetch` simulado; nenhum teste altera conta real.
 */

const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function mediaActionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MEDIA_ACTIONS_ENABLED === 'true';
}

export type ActionKind = 'pause_campaign' | 'resume_campaign' | 'set_budget';

interface Campaign {
  id: string;
  name: string;
  status: string | null;
  dailyBudget: number | null;
  account: string | null;
}

async function readCampaign(token: string, id: string): Promise<Campaign> {
  const url = new URL(`${GRAPH_BASE}/${id}`);
  url.searchParams.set('fields', 'id,name,status,effective_status,daily_budget,account_id');
  url.searchParams.set('access_token', token);
  const raw = await graphGetRetry(url);
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    status: (raw.status as string | undefined) ?? null,
    dailyBudget: raw.daily_budget === undefined ? null : Number(raw.daily_budget) / 100,
    account: raw.account_id ? `act_${String(raw.account_id)}` : null,
  };
}

async function postCampaign(token: string, id: string, fields: Record<string, string>): Promise<void> {
  const body = new URLSearchParams({ ...fields, access_token: token });
  const response = await fetch(`${GRAPH_BASE}/${id}`, { method: 'POST', body, signal: AbortSignal.timeout(30_000) });
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number }; success?: boolean };
  if (!response.ok || json.error) {
    throw new MetaGraphError(`Meta recusou a alteração (${response.status}${json.error?.code ? `/${json.error.code}` : ''}): ${json.error?.message ?? 'sem mensagem'}`, response.status, json.error?.code ?? null, false);
  }
}

export type ExecutionOutcome =
  | { status: 'executed'; before: Record<string, unknown>; after: Record<string, unknown> }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; reason: string };

/** Executa um pedido JÁ aprovado. Grava o resultado no próprio pedido. */
export async function executeApprovedAction(requestId: string): Promise<ExecutionOutcome> {
  const [req] = await db.select().from(schema.mediaActionRequests).where(eq(schema.mediaActionRequests.id, requestId));
  if (!req) return { status: 'failed', reason: 'Pedido não encontrado.' };
  const finish = async (o: ExecutionOutcome): Promise<ExecutionOutcome> => {
    await db
      .update(schema.mediaActionRequests)
      .set({
        status: o.status,
        blockedReason: o.status === 'executed' ? null : o.reason,
        stateBefore: o.status === 'executed' ? o.before : null,
        stateAfter: o.status === 'executed' ? o.after : null,
      })
      .where(eq(schema.mediaActionRequests.id, requestId));
    return o;
  };

  if (req.status !== 'approved') return { status: 'failed', reason: `Só pedido aprovado executa (estado atual: ${req.status}).` };
  if (!mediaActionsEnabled()) return finish({ status: 'blocked', reason: 'A execução de ações em campanha está desligada neste servidor (MEDIA_ACTIONS_ENABLED).' });

  const config = getMetaSystemUserConfig();
  if (!config) return finish({ status: 'blocked', reason: 'Conexão central do Meta não configurada.' });
  try {
    const inspection = await inspectMetaToken(config);
    if (!inspection.valid || !inspection.scopes.includes('ads_management')) {
      return finish({ status: 'blocked', reason: 'O token não tem a permissão ads_management; só leitura é possível.' });
    }

    const before = await readCampaign(config.token, req.targetExternalId);
    if (before.account !== req.accountExternalId) return finish({ status: 'failed', reason: 'A campanha não pertence à conta do pedido.' });

    const payload = req.payload as { dailyBudget?: number };
    if (req.action === 'pause_campaign') await postCampaign(config.token, before.id, { status: 'PAUSED' });
    else if (req.action === 'resume_campaign') await postCampaign(config.token, before.id, { status: 'ACTIVE' });
    else if (req.action === 'set_budget') {
      if (typeof payload.dailyBudget !== 'number' || !(payload.dailyBudget > 0)) return finish({ status: 'failed', reason: 'Orçamento inválido.' });
      if (before.dailyBudget === null) return finish({ status: 'failed', reason: 'Esta campanha não tem orçamento diário próprio (orçamento fica nos conjuntos).' });
      await postCampaign(config.token, before.id, { daily_budget: String(Math.round(payload.dailyBudget * 100)) });
    } else return finish({ status: 'failed', reason: `Ação desconhecida: ${req.action}` });

    const after = await readCampaign(config.token, before.id);
    return finish({ status: 'executed', before: { status: before.status, dailyBudget: before.dailyBudget, name: before.name }, after: { status: after.status, dailyBudget: after.dailyBudget } });
  } catch (error) {
    return finish({ status: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
}
