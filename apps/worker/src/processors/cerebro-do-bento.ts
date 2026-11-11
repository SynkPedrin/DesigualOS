import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'worker:cerebro-do-bento' });

/**
 * O CÉREBRO DO BENTO NA CONVERSA (09/11/2026).
 *
 * O Bento tem um vault próprio (`cerebro-desigual`, Mac Mini da agência: ~600 notas, uma pasta por cliente em
 * `clientes/<slug>/`, com os dados canônicos, o estado atual e a linha do tempo de cada um). O chat do DesigualOS
 * nunca consultava esse vault: só a menção ao Bento no ClickUp fazia isso (`apps/api/src/lib/bento-mention.ts`).
 * O Pedro: "não está tendo acesso aos brains dele no seu próprio cérebro".
 *
 * Agora toda pergunta ao Bento também busca no vault, pela memory-api do Mac Mini (`POST /memory/search`), e o que
 * vier entra no pacote como uma fonte própria, logo depois da ficha do cliente.
 *
 * O CAMPO É `text` (11/11/2026). A primeira versão lia `content`, que a memory-api não manda: a busca achava as notas
 * certas e o Bento recebia zero, porque resultado sem conteúdo era descartado. O teste simulava a resposta com
 * `content` e passava. Agora o formato do teste é o que a memory-api devolve de verdade (medido da VPS).
 *
 * A PASTA DO CLIENTE PRIMEIRO. A busca solta, para "CRM do responsável da DCS", devolvia três cópias de um dossiê de
 * pesquisa de 2025 guardado no arquivo. Com o cliente do turno conhecido, uma segunda busca corre em paralelo restrita
 * a `clientes/<slug>/` (filtro `path_prefix` da memory-api), e o que vem de lá abre o bloco. O arquivo morto
 * (`04_Arquivo`, `09_Arquivo`, `perplexity-bruto`) fica de fora: é registro velho, não fato atual.
 *
 * NUNCA SEGURA A RESPOSTA. A busca depende da RTX para gerar o embedding da pergunta; com a RTX desligada (medido em
 * 09/11/2026: dois dias fora), a memory-api cai a cada busca e a conexão fica pendurada. Por isso: teto de 4 s e, depois
 * de uma falha, 2 min sem tentar. O turno segue com o resto do contexto, e a busca volta sozinha quando a RTX voltar.
 */

const TETO_MS = 4_000;
const PAUSA_DEPOIS_DE_FALHA_MS = 2 * 60_000;
const RESULTADOS_GERAIS = 12;
const RESULTADOS_DA_PASTA = 8;
const NOTAS_NO_BLOCO = 6;
const CHARS_POR_NOTA = 1_500;
const ARQUIVO_MORTO = /(^|\/)(\d+_)?arquivo(\/|$)|perplexity-bruto/i;

let pausadoAte = 0;

export interface NotaDoCerebro {
  path: string;
  content: string;
}

interface ResultadoDaMemoryApi {
  path?: string;
  heading?: string | null;
  text?: string;
  /** Formato antigo; mantido para não depender de uma versão só da memory-api. */
  content?: string;
}

/** Só para testes. */
export function esquecerPausaDoCerebro(): void {
  pausadoAte = 0;
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Pastas candidatas do cliente no vault. "DCS - Diagnostico por imagem" → `dcs`, `dcs-diagnostico-por-imagem`. As
 * pastas do vault usam o nome curto (`dcs`, `facil-seguros`, `elite`), então a primeira candidata é a que costuma casar;
 * a segunda cobre cliente cujo nome não tem o " - ".
 */
export function pastasDoCliente(cliente: string): string[] {
  const curto = slug(cliente.split(/\s+[-–—]\s+/)[0] ?? '');
  const inteiro = slug(cliente);
  return [...new Set([curto, inteiro].filter((s) => s.length >= 2))].map((s) => `clientes/${s}/`);
}

async function buscar(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  corpo: Record<string, unknown>,
): Promise<ResultadoDaMemoryApi[]> {
  const resposta = await fetchImpl(`${url}/memory/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TETO_MS),
  });
  if (!resposta.ok) throw new Error(`memory-api respondeu ${resposta.status}`);
  const json = (await resposta.json()) as { results?: ResultadoDaMemoryApi[] };
  return json.results ?? [];
}

/** Junta os trechos da mesma nota (a memory-api devolve pedaços), na ordem em que vieram. */
function agruparPorNota(resultados: readonly ResultadoDaMemoryApi[]): NotaDoCerebro[] {
  const porNota = new Map<string, string[]>();
  for (const r of resultados) {
    const texto = (r.text ?? r.content ?? '').trim();
    if (!texto) continue;
    const path = r.path ?? 'sem caminho';
    if (ARQUIVO_MORTO.test(path)) continue;
    const trecho = r.heading && !texto.startsWith('#') ? `## ${r.heading}\n${texto}` : texto;
    const trechos = porNota.get(path) ?? [];
    if (!trechos.includes(trecho)) trechos.push(trecho);
    porNota.set(path, trechos);
  }
  return [...porNota].map(([path, trechos]) => ({ path, content: trechos.join('\n…\n') }));
}

export async function buscarNoCerebroDoBento(pergunta: string, opcoes: { cliente?: string | null; fetchImpl?: typeof fetch } = {}): Promise<NotaDoCerebro[]> {
  const url = process.env.BENTO_MEMORY_API_URL;
  const token = process.env.BENTO_MEMORY_API_TOKEN;
  if (!url || !token || !pergunta.trim() || Date.now() < pausadoAte) return [];
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const consulta = opcoes.cliente ? `${pergunta} (${opcoes.cliente})` : pergunta;
  const pastas = opcoes.cliente ? pastasDoCliente(opcoes.cliente) : [];

  const buscas = await Promise.allSettled([
    ...pastas.map((prefixo) => buscar(fetchImpl, url, token, { query: pergunta, top_k: RESULTADOS_DA_PASTA, filters: { path_prefix: prefixo } })),
    buscar(fetchImpl, url, token, { query: consulta, top_k: RESULTADOS_GERAIS }),
  ]);

  if (buscas.every((b) => b.status === 'rejected')) {
    pausadoAte = Date.now() + PAUSA_DEPOIS_DE_FALHA_MS;
    const erro = (buscas[0] as PromiseRejectedResult | undefined)?.reason;
    logger.warn({ erro: erro instanceof Error ? erro.message : String(erro) }, 'Cérebro do Bento fora (memory-api): turno segue sem ele por 2 min');
    return [];
  }
  // A pasta do cliente vem antes da busca geral: é o que o vault sabe DESTE cliente.
  const resultados = buscas.flatMap((b) => (b.status === 'fulfilled' ? b.value : []));
  return agruparPorNota(resultados).slice(0, NOTAS_NO_BLOCO);
}

/** O bloco do pacote de contexto. Vazio quando a busca não trouxe nada. */
export function formatarBlocoDoCerebro(notas: readonly NotaDoCerebro[]): string {
  if (notas.length === 0) return '';
  return [
    'CEREBRO DO BENTO (notas do vault da agencia, achadas por semelhanca com a pergunta; o caminho diz de qual cliente e qual nota e):',
    ...notas.map((n, i) => `[${i + 1}] ${n.path}\n${n.content.slice(0, CHARS_POR_NOTA)}`),
  ].join('\n\n');
}
