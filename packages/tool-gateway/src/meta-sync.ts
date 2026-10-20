import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { getMetaAdAccounts, getMetaBusinesses, type MetaAdAccount } from './meta-oauth';
import { markMetaCentralSynced } from './meta-system-connection';
import { resolveMetaAccess, resolveMetaSystemAccess, getMetaSystemConnection, type MetaAccess } from './meta-access-resolver';

/**
 * meta-sync.ts — AUTO-SYNC de contas Meta Ads (16/10/2026).
 *
 * Até aqui, vincular Ad Account a cliente era 100% manual (Cliente → Mídia →
 * escolher conta). Esta sync faz o caminho automático: lê TODAS as contas
 * visíveis às Business Managers da conexão do colaborador (owned + client,
 * via getMetaAdAccounts, que já cobre os dois) e vincula por NOME aos
 * clientes ativos de produção — com relatório do que foi vinculado, do que
 * já estava vinculado e do que ficou pendente de revisão manual.
 *
 * A confiança do vínculo automático é DELIBERADAMENTE conservadora: só
 * vincula quando EXATAMENTE UM cliente casa com o nome da conta. Nome que
 * não casa com ninguém vira pendente 'sem_match'; nome que casa com mais de
 * um vira pendente 'ambigua' com os candidatos nomeados — a decisão final
 * continua sendo de uma pessoa, na mesma tela de antes.
 */

// ── Matching puro (sem banco, sem rede — unit-testável) ────────────────────

/**
 * Termos que não distinguem uma conta de outra. Formas SEM acento, porque a
 * normalização tira os diacríticos ANTES de remover os termos — e frases mais
 * longas primeiro, pra "conta de anuncios" não sobrar "de anuncios" depois de
 * remover "conta".
 */
const TERMOS_GENERICOS = ['conta de anuncios', 'ad account', 'ads', 'conta', 'midia', 'gestao', 'trafego'];

/**
 * Normaliza um nome (de conta de anúncio ou de cliente) pra comparação:
 * NFD + sem diacríticos, minúsculo, sem termos genéricos, só alfanumérico,
 * espaços colapsados. "Cosentino — Ads [Tráfego]" e "COSENTINO" viram a
 * mesma chave.
 */
export function normalizarNomeMeta(nome: string): string {
  let normalizado = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (const termo of TERMOS_GENERICOS) {
    const padrao = new RegExp(`\\b${termo.replace(/ /g, '\\s+')}\\b`, 'g');
    normalizado = normalizado.replace(padrao, ' ');
  }
  return normalizado
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ClienteParaMatch {
  id: string;
  name: string;
}

export type MetaMatchResult =
  | { tipo: 'vincular'; cliente: ClienteParaMatch }
  | { tipo: 'sem_match' }
  | { tipo: 'ambigua'; candidatos: ClienteParaMatch[] };

/**
 * ALTA CONFIANÇA = os nomes normalizados são iguais OU um contém o outro, E
 * exatamente um cliente candidato. Mais de um candidato é AMBÍGUO (nunca
 * escolher por ordem — o resolver de conta primária já trata escolha
 * implícita como erro, mesma filosofia); nenhum é SEM MATCH.
 */
export function matchAdAccountToClient(conta: { name: string | null }, clientes: ClienteParaMatch[]): MetaMatchResult {
  const nomeConta = normalizarNomeMeta(conta.name ?? '');
  if (!nomeConta) return { tipo: 'sem_match' };

  const candidatos = clientes.filter((cliente) => {
    const nomeCliente = normalizarNomeMeta(cliente.name);
    if (!nomeCliente) return false;
    return nomeConta === nomeCliente || nomeConta.includes(nomeCliente) || nomeCliente.includes(nomeConta);
  });

  if (candidatos.length === 1) return { tipo: 'vincular', cliente: candidatos[0]! };
  if (candidatos.length > 1) return { tipo: 'ambigua', candidatos };
  return { tipo: 'sem_match' };
}

// ── Sync (banco + Graph API) ───────────────────────────────────────────────

export interface MetaSyncVinculo {
  clientId: string;
  clientName: string;
  /** Com o prefixo "act_" — mesmo formato gravado pelo vínculo manual (clients/routes.ts). */
  accountId: string;
  accountName: string;
}

export interface MetaSyncPendente {
  accountId: string;
  accountName: string | null;
  businessName: string | null;
  motivo: 'sem_match' | 'ambigua';
  /** Nomes dos clientes candidatos, quando ambígua — é o que a revisão manual precisa ver. */
  candidatos?: string[];
}

export type MetaSyncReport =
  | { status: 'not_connected' }
  | {
      status: 'ok';
      vinculadas: MetaSyncVinculo[];
      jaVinculadas: MetaSyncVinculo[];
      pendentes: MetaSyncPendente[];
    };

/**
 * Sincroniza as contas Meta Ads visíveis à conexão deste colaborador,
 * vinculando por nome aos clientes ativos de produção.
 *
 * Idempotente: re-rodar não duplica vínculo (onConflictDoNothing na unique
 * (client_id, account_id)) e não rebaixa isPrimary — conta recém-vinculada só
 * vira primária se o cliente não tinha NENHUMA linha ainda.
 *
 * A auditoria é escrita AQUI (integration.meta.sync) e não nas camadas que
 * chamam — API (botão "Sincronizar contas" e callback do OAuth) e worker
 * (job diário) passam pela mesma função, e o pacote já escreve auditLogs
 * direto em outras operações (senior-operation.ts).
 */
export async function syncMetaAdAccountsForUser(userId: string, origem?: 'web' | 'worker'): Promise<MetaSyncReport> {
  const access = await resolveMetaAccess(userId);
  if (!access) return { status: 'not_connected' };
  return syncMetaAdAccounts(access, userId, origem);
}

/**
 * Sync da conexão CENTRAL, sem usuário na frente (job diário do worker). A
 * auditoria usa o dono da linha da conexão, que é quem a estabeleceu.
 */
export async function syncMetaCentralAccounts(origem: 'web' | 'worker' = 'worker'): Promise<MetaSyncReport> {
  const connection = await getMetaSystemConnection();
  if (!connection) return { status: 'not_connected' };
  const access = await resolveMetaSystemAccess();
  if (!access) return { status: 'not_connected' };
  return syncMetaAdAccounts(access, connection.userId, origem);
}

async function syncMetaAdAccounts(access: MetaAccess, userId: string, origem?: 'web' | 'worker'): Promise<MetaSyncReport> {
  // TODAS as BMs (owned + client accounts) + o fallback /me/adaccounts, que
  // enxerga conta solta fora de BM. Dedup por id (act_...) — a mesma conta
  // aparece em mais de um caminho quando a BM é dona E parceira dela.
  const porId = new Map<string, MetaAdAccount>();
  // Usuário do sistema não lista BMs em /me/businesses: parte da BM configurada.
  const businesses =
    access.kind === 'system' && access.businessId
      ? [{ id: access.businessId, name: access.businessId }]
      : await getMetaBusinesses(access.token);
  for (const bm of businesses) {
    for (const conta of await getMetaAdAccounts(access.token, bm.id)) porId.set(conta.id, conta);
  }
  for (const conta of await getMetaAdAccounts(access.token)) porId.set(conta.id, conta);
  const contas = [...porId.values()];

  // Só clientes que uma pessoa vincularia de verdade: ativos, de produção,
  // não apagados. Cliente de QA casando por nome contaminaria a operação.
  const clientes = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.status, 'active'),
        eq(schema.clients.environment, 'production'),
        isNull(schema.clients.deletedAt),
      ),
    );

  const existentes = await db
    .select({ clientId: schema.clientMetaAccounts.clientId, accountId: schema.clientMetaAccounts.accountId })
    .from(schema.clientMetaAccounts);
  const vinculosExistentes = new Set(existentes.map((linha) => `${linha.clientId}:${linha.accountId}`));
  const clientesComVinculo = new Set(existentes.map((linha) => linha.clientId));

  const vinculadas: MetaSyncVinculo[] = [];
  const jaVinculadas: MetaSyncVinculo[] = [];
  const pendentes: MetaSyncPendente[] = [];

  for (const conta of contas) {
    const match = matchAdAccountToClient(conta, clientes);

    if (match.tipo === 'sem_match') {
      pendentes.push({
        accountId: conta.id,
        accountName: conta.name,
        businessName: conta.businessName,
        motivo: 'sem_match',
      });
      continue;
    }
    if (match.tipo === 'ambigua') {
      pendentes.push({
        accountId: conta.id,
        accountName: conta.name,
        businessName: conta.businessName,
        motivo: 'ambigua',
        candidatos: match.candidatos.map((c) => c.name),
      });
      continue;
    }

    const { cliente } = match;
    const vinculo: MetaSyncVinculo = {
      clientId: cliente.id,
      clientName: cliente.name,
      accountId: conta.id,
      accountName: conta.name ?? conta.id,
    };

    if (vinculosExistentes.has(`${cliente.id}:${conta.id}`)) {
      jaVinculadas.push(vinculo);
      continue;
    }

    await db
      .insert(schema.clientMetaAccounts)
      .values({
        clientId: cliente.id,
        accountId: conta.id,
        businessId: conta.businessId,
        connectionId: access.connectionId,
        isPrimary: !clientesComVinculo.has(cliente.id),
        label: conta.name,
      })
      .onConflictDoNothing();

    vinculosExistentes.add(`${cliente.id}:${conta.id}`);
    clientesComVinculo.add(cliente.id);
    vinculadas.push(vinculo);
  }

  await db.insert(schema.auditLogs).values({
    userId,
    action: 'integration.meta.sync',
    result: 'completed',
    source: origem ?? null,
    metadata: {
      contasVistas: contas.length,
      vinculadas: vinculadas.length,
      jaVinculadas: jaVinculadas.length,
      pendentes: pendentes.length,
      conexao: access.kind,
    },
  });

  if (access.kind === 'system') await markMetaCentralSynced();

  return { status: 'ok', vinculadas, jaVinculadas, pendentes };
}
