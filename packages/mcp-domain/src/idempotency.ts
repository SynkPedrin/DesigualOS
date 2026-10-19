import { createHash } from 'node:crypto';

/**
 * idempotency.ts — a defesa contra o defeito mais caro deste sistema.
 *
 * Histórico real, medido na auditoria forense de 26/09/2026: o agente criava
 * uma task nova quando deveria ATUALIZAR uma existente, e criava a mesma task
 * duas vezes quando o job era re-tentado. A §13 da missão do MCP eleva isso a
 * requisito crítico, e com razão — quem lê "criei a task" para de cobrar.
 *
 * São três defesas independentes, e elas não se substituem:
 *
 *  1. CHAVE DE IDEMPOTÊNCIA — o mesmo pedido, repetido, devolve o mesmo
 *     resultado em vez de agir de novo. Cobre retry de rede e clique duplo.
 *  2. RECONCILE-FIRST — antes de criar, procurar o que já existe. Cobre o caso
 *     em que o retry veio de OUTRA sessão, com outra chave.
 *  3. POSSIBLE_DUPLICATE — quando há candidato parecido mas não idêntico, NÃO
 *     criar e NÃO escolher: devolver os candidatos e deixar a decisão com quem
 *     pediu. Cobre o caso em que só um humano sabe se é a mesma coisa.
 *
 * A terceira é a que faltava no sistema antigo, e é a que a missão pede por
 * nome.
 */

/**
 * Chave estável para um pedido de escrita.
 *
 * Deriva do CONTEÚDO, não do relógio: dois pedidos idênticos na mesma sessão
 * colidem de propósito. O cliente pode mandar a dele em `idempotency_key`; sem
 * isso, esta é a rede de segurança.
 */
export function chaveDeIdempotencia(input: {
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;
}): string {
  const argsOrdenados = JSON.stringify(input.args, Object.keys(input.args).sort());
  return createHash('sha256')
    .update(`${input.sessionId}\u0000${input.tool}\u0000${argsOrdenados}`)
    .digest('hex')
    .slice(0, 48);
}

/** Dobra o texto para comparação: sem acento, sem caixa, sem pontuação, sem espaço duplo. */
export function normalizarTitulo(titulo: string): string {
  return (titulo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Similaridade por tokens (Jaccard). Escolhida em vez de distância de edição
 * porque o caso real é reordenação e acréscimo — "Carrossel Outubro Envu" vs
 * "Envu, carrossel de outubro" — e não erro de digitação.
 */
export function similaridade(a: string, b: string): number {
  const ta = new Set(normalizarTitulo(a).split(' ').filter(Boolean));
  const tb = new Set(normalizarTitulo(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersecao = 0;
  for (const t of ta) if (tb.has(t)) intersecao += 1;
  return intersecao / (ta.size + tb.size - intersecao);
}

export interface CandidatoDeDuplicata {
  id: string;
  title: string;
  status?: string | null;
  assignees?: string[];
  url?: string | null;
  /** 0..1 — quanto o título se parece com o pedido. */
  similaridade: number;
}

export type VeredictoDeDuplicata =
  /** Nada parecido. Pode criar. */
  | { decisao: 'CRIAR' }
  /** Idêntico já existe. Não cria: devolve o que existe. */
  | { decisao: 'JA_EXISTE'; existente: CandidatoDeDuplicata }
  /** Parecido o bastante para parar, não o bastante para decidir sozinho. */
  | { decisao: 'POSSIBLE_DUPLICATE'; candidatos: CandidatoDeDuplicata[] };

/**
 * Limiares. Dois números, e cada um tem um motivo:
 *
 *  - 0.92 = "é a mesma coisa". Só chega aqui título que difere em pontuação,
 *    acento ou uma palavra vazia. Devolver o existente é seguro.
 *  - 0.55 = "merece uma pergunta". Abaixo disso, pedir confirmação a cada
 *    criação transforma o agente em burocracia e as pessoas param de usar.
 *
 * A assimetria é deliberada e é a mesma regra da casa: não criar custa uma
 * frase repetida; criar duplicata custa uma task errada na conta de um cliente.
 */
export const LIMIAR_IDENTICO = 0.92;
export const LIMIAR_SUSPEITO = 0.55;

export function avaliarDuplicata(
  tituloPedido: string,
  existentes: ReadonlyArray<{ id: string; title: string; status?: string | null; assignees?: string[]; url?: string | null }>,
): VeredictoDeDuplicata {
  const comScore: CandidatoDeDuplicata[] = existentes
    .map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status ?? null,
      assignees: e.assignees ?? [],
      url: e.url ?? null,
      similaridade: similaridade(tituloPedido, e.title),
    }))
    .sort((a, b) => b.similaridade - a.similaridade);

  const melhor = comScore[0];
  if (!melhor || melhor.similaridade < LIMIAR_SUSPEITO) return { decisao: 'CRIAR' };
  if (melhor.similaridade >= LIMIAR_IDENTICO) return { decisao: 'JA_EXISTE', existente: melhor };
  return {
    decisao: 'POSSIBLE_DUPLICATE',
    candidatos: comScore.filter((c) => c.similaridade >= LIMIAR_SUSPEITO).slice(0, 5),
  };
}
