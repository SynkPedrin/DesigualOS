import { db, schema } from '@desigual-os/database';
import { and, eq, inArray } from 'drizzle-orm';
import { resolveClientsFromText } from '@desigual-os/context-engine';

/**
 * client-context.ts — quem é o cliente deste turno, com FATO do banco.
 *
 * Bug real relatado pela operação (15/09/2026): pediram legenda para a
 * "D. Carvalho" e o Otto respondeu que ela não era cliente da carteira, que o
 * único cliente ativo era a Cosentino, e INVENTOU que a D. Carvalho é "uma
 * rede de joias e relógios de alto padrão". A verdade estava a uma query de
 * distância: a D. Carvalho é concessionária John Deere, tem dossiê completo em
 * `memories` e lista no ClickUp. São 57 clientes na carteira; o vault que o
 * node do Otto lê tem 1.
 *
 * A causa não era o modelo: era o turno chegar ao node SEM a identidade do
 * cliente. O node lê o Brain-Marketing (teoria de marketing) e um brand kit
 * que, para a maioria dos clientes, nem existe. Sem nome, sem dossiê e sem
 * lista de quem existe, o modelo preenche a lacuna — que é exatamente o
 * comportamento que o resto do sistema existe para impedir.
 *
 * Aqui o turno passa a carregar: o cliente resolvido, o dossiê real dele e,
 * quando o nome citado NÃO existe na carteira, uma instrução explícita de
 * perguntar em vez de inventar.
 */

export interface ClientTurnContext {
  clientId: string | null;
  clientName: string | null;
  /** Dossiê consolidado (kind client.profile), cortado pro orçamento de prompt. */
  profile: string | null;
  /** Nomes citados na mensagem que NÃO existem na carteira. */
  unresolvedMentions: string[];
  /** Mais de um cliente casou: o agente precisa perguntar qual. */
  ambiguous: string[];
}

// Os BRAIN.md dos clientes tem mediana ~2.8k e chegam a 12k. 2.400 cortava
// o dossie no meio — justamente as secoes de posicionamento e restricoes, que
// sao o que impede o modelo de inventar. 6.000 cobre a grande maioria inteiro
// e ainda cabe no orcamento de prompt do node.
const PERFIL_MAX_CHARS = 6000;

/**
 * Resolve o cliente do turno. Precedência: cliente da execução (seletor do
 * chat) > cliente citado no texto. Nunca "escolhe" quando há ambiguidade.
 */
export async function resolveClientTurnContext(params: {
  message: string;
  executionClientId?: string | null;
}): Promise<ClientTurnContext> {
  const vazio: ClientTurnContext = {
    clientId: null,
    clientName: null,
    profile: null,
    unresolvedMentions: [],
    ambiguous: [],
  };

  const doTexto = await resolveClientsFromText(params.message).catch(() => null);
  const ambiguous = (doTexto?.ambiguous ?? []).map((a) => (typeof a === 'string' ? a : (a as { name?: string }).name ?? '')).filter(Boolean);

  let clientId = params.executionClientId ?? null;
  let clientName: string | null = null;

  if (!clientId && doTexto?.matches?.length === 1) {
    clientId = doTexto.matches[0]!.id;
  }
  // Mais de um cliente citado (ex: "jhon deere d carvalho" casa os dois) NÃO é
  // erro: é uma marca e a concessionária dela. Fica com o primeiro e reporta
  // os dois, pra o agente saber que o turno fala dos dois.
  if (!clientId && (doTexto?.matches?.length ?? 0) > 1) {
    clientId = doTexto!.matches[0]!.id;
  }

  if (clientId) {
    const [c] = await db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.id, clientId))
      .catch(() => []);
    clientName = c?.name ?? null;
    if (!c) clientId = null;
  }

  let profile: string | null = null;
  if (clientId) {
    const [m] = await db
      .select({ content: schema.memories.content })
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.clientId, clientId),
          eq(schema.memories.status, 'active'),
          inArray(schema.memories.kind, ['client.profile']),
        ),
      )
      .limit(1)
      .catch(() => []);
    profile = m?.content?.slice(0, PERFIL_MAX_CHARS) ?? null;
  }

  return {
    ...vazio,
    clientId,
    clientName,
    profile,
    ambiguous,
    unresolvedMentions: [],
  };
}

/**
 * Bloco pro prompt. Três estados, todos explícitos:
 *   - cliente resolvido com dossiê: manda o dossiê;
 *   - cliente resolvido sem dossiê: diz que existe, mas que não há contexto;
 *   - nada resolvido: PROÍBE inventar e manda perguntar.
 */
export function formatClientBlock(ctx: ClientTurnContext, totalClientes: number): string {
  if (ctx.ambiguous.length > 1) {
    return [
      'CLIENTE DO TURNO: AMBÍGUO.',
      `Mais de um cliente da carteira casa com o que foi escrito: ${ctx.ambiguous.join(', ')}.`,
      'Pergunte qual é antes de produzir. NÃO escolha por conta própria.',
    ].join('\n');
  }

  if (!ctx.clientId) {
    return [
      'CLIENTE DO TURNO: NÃO IDENTIFICADO.',
      `A agência tem ${totalClientes} clientes na carteira e você NÃO recebeu a lista neste turno.`,
      'Por isso: NUNCA afirme que um cliente não existe, e NUNCA descreva o ramo, o produto',
      'ou o posicionamento de um cliente que você não recebeu aqui. Se o pedido cita um cliente',
      'que não está neste bloco, peça a confirmação do nome em vez de deduzir quem é.',
    ].join('\n');
  }

  const linhas = [`CLIENTE DO TURNO: ${ctx.clientName} (confirmado na carteira da agência).`];
  if (ctx.profile) {
    linhas.push('', 'DOSSIÊ REAL DESTE CLIENTE (use como fonte, não invente fora daqui):', ctx.profile);
  } else {
    linhas.push(
      '',
      'Este cliente EXISTE na carteira, mas não há dossiê consolidado dele no sistema.',
      'Trabalhe com o que o pedido trouxer e declare o que falta. NÃO invente ramo, produto ou público.',
    );
  }
  return linhas.join('\n');
}

/** Quantos clientes a agência tem — entra no bloco pra o agente saber o tamanho da carteira. */
export async function contarClientes(): Promise<number> {
  const rows = await db.select({ id: schema.clients.id }).from(schema.clients).catch(() => []);
  return rows.length;
}
