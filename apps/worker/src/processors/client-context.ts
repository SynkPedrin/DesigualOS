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
// sao o que impede o modelo de inventar. 6.000 cobria uma fonte inteira; com
// DUAS fontes por cliente (ver abaixo) o teto passa a valer para o conjunto.
const PERFIL_MAX_CHARS = 9000;

/**
 * Um cliente tem mais de um registro, e eles NAO se substituem:
 *   - brain  = registro criativo (posicionamento, persona, tom de voz);
 *   - dossie = registro operacional (contrato, servicos, historico, lacunas).
 * A consulta antiga lia `.limit(1)` sem `orderBy`. Enquanto so existia o brain
 * isso funcionava por acidente; com as duas fontes o turno passaria a receber
 * UMA DELAS ao acaso, e a que faltasse viraria exatamente a lacuna que o modelo
 * preenche inventando. Por isso: le todas, ordena e rotula.
 */
const ORDEM_DAS_FONTES = ['brain', 'dossie', 'aprendizado'] as const;
type FonteDePerfil = (typeof ORDEM_DAS_FONTES)[number] | 'outra';

const ROTULO_DA_FONTE: Record<FonteDePerfil, string> = {
  brain: 'REGISTRO CRIATIVO (posicionamento, publico, tom de voz)',
  dossie: 'REGISTRO OPERACIONAL (contrato, servicos, historico, lacunas)',
  // Vem por ultimo de proposito: e o mais RECENTE. O que a equipe contou depois
  // corrige o que a ficha dizia antes, e o modelo le a correcao por ultimo.
  //
  // O rotulo diz JA GRAVADO porque a primeira versao ("dito pela equipe no
  // chat") fez o modelo tratar o fato como rascunho: ele respondeu usando o
  // dado e no fim pediu "registre formalmente no sistema para eu poder usar",
  // sendo que o dado ja estava em memoria permanente. Procedencia visivel, sim;
  // duvida sobre a validade do proprio registro, nao.
  aprendizado:
    'REGISTRO APRENDIDO (ensinado pela equipe e JA GRAVADO em memoria permanente; e o mais recente, e corrige as fichas acima quando divergir)',
  outra: 'REGISTRO ADICIONAL',
};

/** Piso por fonte: uma fonte longa nunca zera a outra dentro do orcamento. */
const MIN_CHARS_POR_FONTE = 2000;

/**
 * `cliente:<uuid>:brain` -> 'brain'; `cliente:<uuid>:aprendizado:decisor` ->
 * 'aprendizado'. Varre os segmentos em vez de olhar so o ultimo: o subject do
 * fato aprendido termina no ASPECTO, nao na fonte. Subject desconhecido cai em
 * 'outra' — entra rotulado, nunca some.
 */
export function fonteDoPerfil(subject: unknown): FonteDePerfil {
  if (typeof subject !== 'string') return 'outra';
  const achada = subject.split(':').find((seg) => (ORDEM_DAS_FONTES as readonly string[]).includes(seg));
  return (achada as FonteDePerfil | undefined) ?? 'outra';
}

/**
 * Junta as fontes num bloco unico, rotulado e dentro do orcamento. Reparte o
 * espaco reservando o piso para as fontes ainda nao escritas, entao a ordem
 * (criativo antes de operacional) nao faz a segunda chegar vazia.
 */
export function comporPerfil(
  fontes: Array<{ fonte: FonteDePerfil; content: string }>,
  orcamento = PERFIL_MAX_CHARS,
): string | null {
  const uteis = fontes.filter((f) => f.content.trim().length > 0);
  if (uteis.length === 0) return null;

  // Agrupa antes de repartir: 'aprendizado' chega como VARIOS registros (um por
  // aspecto), e trata-los como fontes separadas daria a cada fato um cabecalho
  // proprio e faria o piso por fonte ser cobrado N vezes, espremendo o dossie.
  const porFonte = new Map<FonteDePerfil, string[]>();
  for (const f of uteis) {
    const atual = porFonte.get(f.fonte) ?? [];
    atual.push(f.content.trim());
    porFonte.set(f.fonte, atual);
  }

  const ordenadas = [...porFonte.entries()].sort((a, b) => indiceDaFonte(a[0]) - indiceDaFonte(b[0]));
  const blocos: string[] = [];
  let restante = orcamento;

  ordenadas.forEach(([fonte, partes], i) => {
    const aindaPorEscrever = ordenadas.length - i - 1;
    const teto = Math.max(0, restante - MIN_CHARS_POR_FONTE * aindaPorEscrever);
    const texto = partes.join('\n').slice(0, teto);
    if (texto.length === 0) return;
    blocos.push(`[${ROTULO_DA_FONTE[fonte]}]\n${texto}`);
    restante -= texto.length;
  });

  return blocos.length > 0 ? blocos.join('\n\n') : null;
}

function indiceDaFonte(f: FonteDePerfil): number {
  const i = (ORDEM_DAS_FONTES as readonly string[]).indexOf(f);
  return i === -1 ? ORDEM_DAS_FONTES.length : i;
}

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
    const rows = await db
      .select({ content: schema.memories.content, metadata: schema.memories.metadata })
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.clientId, clientId),
          eq(schema.memories.status, 'active'),
          inArray(schema.memories.kind, ['client.profile']),
        ),
      )
      .catch(() => []);
    profile = comporPerfil(
      rows.map((r) => ({
        fonte: fonteDoPerfil((r.metadata as { subject?: unknown } | null)?.subject),
        content: r.content ?? '',
      })),
    );
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
  // O registro é VIVO, e o agente precisa saber disso. Sem esta instrução ele
  // trata a lacuna como parede: lista o que falta e encerra, e a resposta da
  // equipe se perde no histórico do chat em vez de virar conhecimento. O que
  // fecha o ciclo do outro lado é client-fact.ts, que grava o que for dito com
  // verbo de registro.
  linhas.push(
    '',
    'ESTE REGISTRO É VIVO, e mantê-lo é parte do seu trabalho:',
    '- O que estiver marcado como lacuna, [FALTA] ou "a coletar" é pergunta em aberto. Ao terminar a entrega, PEÇA o que faltou e diga por que aquilo muda o trabalho.',
    '- Quando a equipe responder, peça para registrar com "anota que..." ou "registra que...". Só assim vira conhecimento permanente; contado de passagem, se perde.',
    '- Nunca preencha lacuna por dedução para parecer completo. Declarar o que falta é resposta certa; inventar é o erro mais caro que você pode cometer aqui.',
  );
  return linhas.join('\n');
}

/** Quantos clientes a agência tem — entra no bloco pra o agente saber o tamanho da carteira. */
export async function contarClientes(): Promise<number> {
  const rows = await db.select({ id: schema.clients.id }).from(schema.clients).catch(() => []);
  return rows.length;
}
