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

/**
 * Nome de cliente como a operação REALMENTE escreve.
 *
 * Na carteira o cliente é "D. Carvalho". A Tammy escreve "D Carvalho" e
 * "DCarvalho" — as duas formas aparecem nos chats reais de 15 e 17/09/2026.
 * O casamento era literal sobre o nome cadastrado, então "na lista da D
 * Carvalho" devolvia `no_client_referenced`: a única entidade que a mensagem
 * declarava em voz alta era jogada fora por causa de um ponto final.
 *
 * Três chaves por cliente, da mais conservadora pra mais tolerante:
 *   1. o nome normalizado (acento/caixa);
 *   2. sem pontuação, espaços colapsados  — "d carvalho";
 *   3. sem espaço nenhum                  — "dcarvalho".
 * A chave 3 só vale a partir de 5 caracteres, pra um nome curto não casar
 * dentro de outra palavra.
 */
export function chavesDoCliente(nome: string): string[] {
  const base = dobra(nome).trim();
  const semPontuacao = base.replace(/[.,'’-]/g, ' ').replace(/\s+/g, ' ').trim();
  const semEspaco = semPontuacao.replace(/\s+/g, '');
  const chaves = [base, semPontuacao];
  // A chave sem espaço só existe pra nome COMPOSTO ("D. Carvalho" ->
  // "dcarvalho"). Gerá-la pra nome de palavra única não acrescenta nada e só
  // abriria espaço pra casar dentro de outra palavra.
  if (semEspaco.length >= 5 && semEspaco !== semPontuacao) chaves.push(semEspaco);
  return [...new Set(chaves.filter((c) => c.length >= 3))];
}

/** O texto da mensagem nas mesmas três formas, pra comparar chave com chave. */
function formasDaMensagem(message: string): { comEspaco: string; semEspaco: string } {
  const comEspaco = dobra(message).replace(/[.,'’-]/g, ' ').replace(/\s+/g, ' ');
  return { comEspaco, semEspaco: comEspaco.replace(/\s+/g, '') };
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A mensagem cita este cliente, em qualquer das formas que a equipe usa? */
export function mensagemCitaCliente(message: string, nomeDoCliente: string): boolean {
  const { comEspaco, semEspaco } = formasDaMensagem(message);
  return chavesDoCliente(nomeDoCliente).some((chave) => {
    // Na forma sem espaço não existe fronteira pra cobrar — a mensagem inteira
    // virou uma palavra só. O piso de 5 caracteres e a exigência de nome
    // composto é o que segura o falso positivo aqui.
    if (!chave.includes(' ')) {
      if (new RegExp(`(^|[^a-z0-9])${escaparRegex(chave)}([^a-z0-9]|$)`).test(comEspaco)) return true;
      return chave.length >= 5 && semEspaco.includes(chave);
    }
    // Fronteira explícita: sem isto "3net" casaria dentro de "13netos".
    return new RegExp(`(^|[^a-z0-9])${escaparRegex(chave)}([^a-z0-9]|$)`).test(comEspaco);
  });
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
    const alvoCitado = chavesDoCliente(citado)[1] ?? dobra(citado);
    const exatos = clientes.filter((c) => chavesDoCliente(c.name).includes(alvoCitado));
    if (exatos.length === 1) return finalizar(exatos[0]!, `cliente citado na mensagem: ${exatos[0]!.name}`);

    // Parciais: quem contém o que foi citado. Mais de um = ambíguo de verdade
    // ("Colpar QA" com Alpha e Beta na carteira).
    const parciais = clientes.filter((c) => chavesDoCliente(c.name).some((k) => k.includes(alvoCitado)));
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
  const encontrados = clientes.filter((c) => {
    const nome = dobra(c.name).trim();
    if (nome.length < 3 || RUIDO.has(nome)) return false;
    return mensagemCitaCliente(params.message, c.name);
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
 * TÍTULO DE UMA TASK DE ENTREGÁVEL: "Criar layout das placas — D. Carvalho".
 *
 * Quando o pedido nomeia o entregável (layout, texto, vídeo), o título sai
 * dele, e não do verbo genérico. O ASSUNTO vem dos itens enumerados na
 * solicitação colada — no caso real, quatro linhas começando com "Placa", que
 * viram "placas". É o que faz a task dizer o trabalho sem precisar abrir o
 * briefing.
 */
export function buildDeliverableTitle(params: {
  deliverable: string;
  items: string[];
  clientName: string | null;
}): string {
  const assunto = assuntoDosItens(params.items);
  const sufixo = params.clientName ? ` — ${params.clientName}` : '';
  // "Criar placas das placas" é o que sai quando o entregável e o assunto são
  // a mesma coisa. Nesse caso o entregável já diz tudo.
  const qualificador = assunto && dobra(assunto) !== dobra(params.deliverable) ? ` das ${assunto}` : '';
  return `Criar ${params.deliverable}${qualificador}${sufixo}`.slice(0, 120);
}

/**
 * TÍTULO DE UMA TASK DE ITEM: o item É o trabalho.
 *
 * Quando o pedido enumerou "Placa Estacione de Ré", o título da task é isso —
 * não "Criar placas (1 de 4)". Quem abre o ClickUp precisa saber qual das
 * quatro é a sua sem abrir nenhuma.
 */
export function buildItemTitle(params: { item: string; clientName: string | null }): string {
  // Já vem nomeado como trabalho ("Placa X", "Layout Y")? Então só qualifica.
  // Aspas são delimitador da citação, não parte do nome: sem tirar TODAS,
  // sobrava a aspa de abertura no meio do título (`Placa "Estacione de Ré`).
  const limpo = params.item.replace(/["“”'‘’]/g, '').replace(/\s+/g, ' ').trim();
  const flat = dobra(limpo);
  const jaTemSubstantivo = /^(placa|pe[cç]a|layout|arte|video|post|banner|card|criativo|roteiro|texto|copy|reels|stories)/.test(flat);
  const titulo = jaTemSubstantivo ? limpo : `Criar ${limpo}`;
  const sufixo = params.clientName ? ` — ${params.clientName}` : '';
  return `${titulo}${sufixo}`.slice(0, 120);
}

/** Substantivo comum às linhas enumeradas ("Placa X", "Placa Y" -> "placas"). */
function assuntoDosItens(items: string[]): string | null {
  if (items.length === 0) return null;
  const primeiras = items.map((i) => dobra(i).split(/\s+/)[0] ?? '').filter((w) => w.length >= 4);
  if (primeiras.length === 0) return null;
  const cabeca = primeiras[0]!;
  // Só vira assunto se a MAIORIA das linhas começa igual — senão é uma lista
  // heterogênea e um rótulo único mentiria sobre o que tem dentro.
  if (primeiras.filter((w) => w === cabeca).length * 2 <= primeiras.length) return null;
  return cabeca.endsWith('s') ? cabeca : `${cabeca}s`;
}

/**
 * TÍTULO OPERACIONAL: responde "o que precisa ser feito", não repete o que a
 * pessoa escreveu. Copiar a mensagem crua foi o que produziu a task chamada
 * "Peças que você confia, você tem" — que é o nome da CAMPANHA, não do trabalho.
 */
/**
 * O QUE é o trabalho, lido do próprio pedido.
 *
 * Antes existiam três saídas: "peças da campanha", "campanha" e "demanda".
 * Qualquer pedido fora desses três virava "Executar demanda — Cliente" — e
 * isso tem uma consequência que só apareceu no aceite pelo frontend: como a
 * idempotência usa o TÍTULO como chave, dois pedidos diferentes ("cartaz da
 * recepção" e "folder de julho") colidiam no mesmo título genérico e o segundo
 * era barrado como duplicata. O título ruim não era só feio: bloqueava
 * trabalho legítimo em silêncio.
 *
 * A lista é o vocabulário de entrega da agência. O primeiro que aparecer no
 * texto vence, porque é assim que a pessoa enuncia a demanda.
 */
const SUBSTANTIVOS_DE_TRABALHO: Array<[RegExp, string]> = [
  [/\bcartaz(es)?\b/, 'cartaz'],
  [/\bplacas?\b/, 'placas'],
  [/\bbanners?\b/, 'banner'],
  [/\b(folder|flyer|panfleto)s?\b/, 'folder'],
  [/\bcat[aá]logos?\b/, 'catálogo'],
  [/\bapresenta[cç][aã]o|\bdeck\b/, 'apresentação'],
  [/\blanding ?page|\blp\b|\bsite\b/, 'landing page'],
  [/\b(v[ií]deos?|reels?|stories)\b/, 'vídeo'],
  [/\bcarross[eé]l|\bcarrossel\b/, 'carrossel'],
  [/\bposts?\b/, 'post'],
  [/\blayouts?\b/, 'layout'],
  [/\b(identidade visual|logo(tipo)?|marca)\b/, 'identidade visual'],
  [/\broteiros?\b/, 'roteiro'],
  [/\b(legenda|copy|texto)s?\b/, 'texto'],
  [/\b(e-?mail|newsletter)s?\b/, 'e-mail'],
  [/\bbriefings?\b/, 'briefing'],
  [/\bpe[çc]as?\b/, 'peças da campanha'],
  [/\bcampanha\b/, 'campanha'],
];

function substantivoDoTrabalho(flat: string): string | null {
  const achados = SUBSTANTIVOS_DE_TRABALHO.map(([re, rotulo]) => ({ rotulo, at: flat.search(re) })).filter((x) => x.at >= 0);
  if (achados.length === 0) return null;
  return achados.sort((a, b) => a.at - b.at)[0]!.rotulo;
}

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
  const objeto = entreAspas ? `campanha ${entreAspas}` : substantivoDoTrabalho(flat) ?? 'demanda';

  const sufixo = params.clientName ? ` — ${params.clientName}` : '';
  return `${acao} ${objeto}${sufixo}`.slice(0, 120);
}
