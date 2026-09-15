import { db, schema } from '@desigual-os/database';
import { isNull } from 'drizzle-orm';

/**
 * write-target.ts — RESOLVER O CLIENTE ANTES DE ESCREVER.
 *
 * No caso real do deploy anterior a task foi criada na lista errada porque o
 * destino era um fallback: sem cliente resolvido, caía na lista da agência em
 * silêncio. Aqui o destino é uma DECISÃO explícita, e "não sei" é uma resposta
 * válida que bloqueia a escrita.
 *
 * Três recusas possíveis, todas melhores que escrever no lugar errado:
 * cliente não encontrado, cliente ambíguo e cliente sem lista no ClickUp.
 */

export type WriteTargetStatus = 'resolved' | 'unknown_client' | 'ambiguous_client' | 'missing_list' | 'no_client_referenced';

export interface WriteTarget {
  status: WriteTargetStatus;
  clientId: string | null;
  clientName: string | null;
  listId: string | null;
  /** Candidatos quando ambíguo — a pergunta de desambiguação sai daqui. */
  candidates: string[];
  reason: string;
}

function dobra(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Palavras que nunca são nome de cliente, pra não casar lixo. */
const RUIDO = new Set(['task', 'tarefa', 'campanha', 'cliente', 'time', 'equipe', 'hoje', 'amanha', 'isso', 'aquilo']);

/**
 * Acha o cliente citado na mensagem comparando com a carteira REAL. Não tenta
 * adivinhar: casa nome completo (sem acento/caixa) contido no texto.
 */
/** Nome do cliente CITADO explicitamente ("para o cliente X", "do cliente X"). */
export function extractCitedClient(message: string): string | null {
  const m = /\b(?:para|pro|pra|do|da|de|no|na)\s+(?:o\s+|a\s+)?cliente\s+([^,.;:!?\n]{2,60})/i.exec(message);
  const bruto = m?.[1]?.trim();
  if (!bruto) return null;
  // Corta o que vem depois de conectivo: "cliente X e depois crie...".
  return bruto.split(/\s+(?:e|com|que|para|pra)\s+/i)[0]?.trim() ?? bruto;
}

export async function resolveWriteTarget(params: {
  message: string;
  /** Cliente já vinculado à execução (seletor do chat). */
  executionClientId?: string | null;
}): Promise<WriteTarget> {
  const clientes = await db
    .select({ id: schema.clients.id, name: schema.clients.name, listId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(isNull(schema.clients.deletedAt))
    .catch(() => [] as Array<{ id: string; name: string; listId: string | null }>);

  const finalizar = (c: { id: string; name: string; listId: string | null }, motivo: string): WriteTarget =>
    c.listId
      ? { status: 'resolved', clientId: c.id, clientName: c.name, listId: c.listId, candidates: [], reason: motivo }
      : { status: 'missing_list', clientId: c.id, clientName: c.name, listId: null, candidates: [], reason: `o cliente ${c.name} não tem lista do ClickUp vinculada` };

  // 1. CITAÇÃO EXPLÍCITA manda em tudo. Se a pessoa escreveu "para o cliente
  //    X", o destino é X — e se X não existe, a escrita PARA. Deixar o
  //    client_id da execução vencer aqui foi o que mandaria a task pro cliente
  //    errado quando o texto cita outro.
  const citado = extractCitedClient(params.message);
  if (citado) {
    const alvoCitado = dobra(citado);
    const exatos = clientes.filter((c) => dobra(c.name) === alvoCitado);
    if (exatos.length === 1) return finalizar(exatos[0]!, `cliente citado na mensagem: ${exatos[0]!.name}`);

    // Parciais: quem contém o que foi citado. Mais de um = ambíguo de verdade
    // ("Colpar QA" com Alpha e Beta na carteira).
    const parciais = clientes.filter((c) => dobra(c.name).includes(alvoCitado));
    if (parciais.length === 1) return finalizar(parciais[0]!, `cliente citado na mensagem: ${parciais[0]!.name}`);
    if (parciais.length > 1) {
      return {
        status: 'ambiguous_client',
        clientId: null,
        clientName: null,
        listId: null,
        candidates: parciais.map((c) => c.name),
        reason: `mais de um cliente casa com "${citado}": ${parciais.map((c) => c.name).join(", ")}`,
      };
    }
    return { status: 'unknown_client', clientId: null, clientName: null, listId: null, candidates: [], reason: `não existe cliente "${citado}" na carteira` };
  }

  // 2. Sem citação: o cliente da execução (seletor do chat).
  if (params.executionClientId) {
    const c = clientes.find((x) => x.id === params.executionClientId);
    if (c) return finalizar(c, 'cliente da execução (selecionado no chat)');
  }

  // 3. Nome de cliente solto no texto, sem a palavra "cliente". MAIS ESPECÍFICO
  //    vence: "Colpar QA" contém "Colpar", e quem escreveu quis o primeiro.
  const flat = dobra(params.message);
  const encontrados = clientes.filter((c) => {
    const nome = dobra(c.name).trim();
    if (nome.length < 3 || RUIDO.has(nome)) return false;
    return new RegExp(`(^|[^a-z0-9])${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(flat);
  });
  if (encontrados.length === 0) {
    return { status: 'no_client_referenced', clientId: null, clientName: null, listId: null, candidates: [], reason: 'nenhum cliente citado na mensagem' };
  }
  const maisEspecifico = [...encontrados].sort((a, b) => b.name.length - a.name.length);
  const topo = maisEspecifico[0]!;
  const empatados = maisEspecifico.filter((c) => c.name.length === topo.name.length);
  if (empatados.length > 1) {
    return {
      status: 'ambiguous_client',
      clientId: null,
      clientName: null,
      listId: null,
      candidates: empatados.map((c) => c.name),
      reason: `mais de um cliente casa com a mensagem: ${empatados.map((c) => c.name).join(", ")}`,
    };
  }
  return finalizar(topo, `cliente identificado na mensagem: ${topo.name}`);
}
/**
 * TÍTULO OPERACIONAL: responde "o que precisa ser feito", não repete o que a
 * pessoa escreveu. Copiar a mensagem crua foi o que produziu a task chamada
 * "Peças que você confia, você tem" — que é o nome da CAMPANHA, não do trabalho.
 */
export function buildOperationalTitle(params: {
  message: string;
  explicitName: string | null;
  clientName: string | null;
}): string {
  // Nome dito entre aspas continua mandando: quando a pessoa nomeia a task,
  // ela sabe o que quer.
  if (params.explicitName && params.explicitName.trim().length >= 3) return params.explicitName.trim();

  const turno = (params.message.split(/\n-{3,}\n/)[0] ?? params.message).replace(/\s+/g, ' ').trim();
  const flat = dobra(turno);

  // Verbo operacional a partir do que foi pedido.
  const acao = /\brevis|ajust|corrig|analis|avali/.test(flat)
    ? 'Revisar e ajustar'
    : /\bproduz|produc|cria(r|)\b|desenvolv/.test(flat)
      ? 'Produzir'
      : /\bpublic|subir|agendar/.test(flat)
        ? 'Publicar'
        : 'Executar';

  // Objeto do trabalho: o que está entre aspas (campanha/peça) ou o substantivo.
  const entreAspas = /["“']([^"”']{3,80})["”']/.exec(turno)?.[1]?.trim() ?? null;
  const objeto = entreAspas
    ? `campanha ${entreAspas}`
    : /\bpe[çc]as?\b/.test(flat)
      ? 'peças da campanha'
      : /\bcampanha\b/.test(flat)
        ? 'campanha'
        : 'demanda';

  const sufixo = params.clientName ? ` — ${params.clientName}` : '';
  return `${acao} ${objeto}${sufixo}`.slice(0, 120);
}
