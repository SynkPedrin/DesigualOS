import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'worker:cerebro-do-bento' });

/**
 * O CÉREBRO DO BENTO NA CONVERSA (09/11/2026).
 *
 * O Bento tem um vault próprio (`cerebro-desigual`, Mac Mini da agência: ~600 notas, uma pasta por cliente, com os
 * dados canônicos, o estado atual e a linha do tempo de cada um). O chat do DesigualOS nunca consultava esse vault:
 * só a menção ao Bento no ClickUp fazia isso (`apps/api/src/lib/bento-mention.ts`). O Pedro: "não está tendo acesso
 * aos brains dele no seu próprio cérebro".
 *
 * Agora toda pergunta ao Bento também busca no vault, pela memory-api do Mac Mini (`POST /memory/search`), e o que
 * vier entra no pacote como uma fonte própria, logo depois da ficha do cliente.
 *
 * NUNCA SEGURA A RESPOSTA. A busca depende da RTX para gerar o embedding da pergunta; com a RTX desligada (medido em
 * 09/11/2026: dois dias fora), a memory-api cai a cada busca e a conexão fica pendurada. Por isso: teto de 4 s e, depois
 * de uma falha, 2 min sem tentar. O turno segue com o resto do contexto, e a busca volta sozinha quando a RTX voltar.
 */

const TETO_MS = 4_000;
const PAUSA_DEPOIS_DE_FALHA_MS = 2 * 60_000;
const RESULTADOS = 5;
const CHARS_POR_NOTA = 1_200;

let pausadoAte = 0;

export interface NotaDoCerebro {
  path: string;
  content: string;
}

/** Só para testes. */
export function esquecerPausaDoCerebro(): void {
  pausadoAte = 0;
}

export async function buscarNoCerebroDoBento(pergunta: string, opcoes: { cliente?: string | null; fetchImpl?: typeof fetch } = {}): Promise<NotaDoCerebro[]> {
  const url = process.env.BENTO_MEMORY_API_URL;
  const token = process.env.BENTO_MEMORY_API_TOKEN;
  if (!url || !token || !pergunta.trim() || Date.now() < pausadoAte) return [];
  const consulta = opcoes.cliente ? `${pergunta} (${opcoes.cliente})` : pergunta;
  try {
    const resposta = await (opcoes.fetchImpl ?? fetch)(`${url}/memory/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: consulta, top_k: RESULTADOS }),
      signal: AbortSignal.timeout(TETO_MS),
    });
    if (!resposta.ok) throw new Error(`memory-api respondeu ${resposta.status}`);
    const corpo = (await resposta.json()) as { results?: Array<{ path?: string; content?: string }> };
    return (corpo.results ?? [])
      .filter((r) => (r.content ?? '').trim().length > 0)
      .map((r) => ({ path: r.path ?? 'sem caminho', content: (r.content ?? '').trim() }));
  } catch (error) {
    pausadoAte = Date.now() + PAUSA_DEPOIS_DE_FALHA_MS;
    logger.warn({ erro: error instanceof Error ? error.message : String(error) }, 'Cérebro do Bento fora (memory-api): turno segue sem ele por 2 min');
    return [];
  }
}

/** O bloco do pacote de contexto. Vazio quando a busca não trouxe nada. */
export function formatarBlocoDoCerebro(notas: readonly NotaDoCerebro[]): string {
  if (notas.length === 0) return '';
  return [
    'CEREBRO DO BENTO (notas do vault da agencia, achadas por semelhanca com a pergunta; o caminho diz de qual cliente e qual nota e):',
    ...notas.map((n, i) => `[${i + 1}] ${n.path}\n${n.content.slice(0, CHARS_POR_NOTA)}`),
  ].join('\n\n');
}
