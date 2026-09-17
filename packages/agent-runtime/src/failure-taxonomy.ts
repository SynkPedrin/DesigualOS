/**
 * failure-taxonomy.ts — separar falha de INFRAESTRUTURA de falha COGNITIVA.
 *
 * O ciclo destrutivo medido em 16/09/2026:
 *
 *   GPU ocupada -> chamada ao node expira -> o loop trata como resposta ruim
 *   -> replaneja -> dispara OUTRA chamada -> GPU mais congestionada -> expira
 *   de novo -> replan_exhausted.
 *
 * Duas coisas erradas ao mesmo tempo. A primeira é o diagnóstico: o planner não
 * consegue "pensar melhor" para corrigir uma placa saturada, então replanejar é
 * esforço jogado fora. A segunda é o efeito: cada replan ACRESCENTA carga na
 * causa do problema. É avalanche, não recuperação.
 *
 * Aqui a falha ganha tipo. Falha de infraestrutura termina o turno com uma
 * mensagem honesta sobre capacidade; falha cognitiva continua replanejando,
 * que é onde replanejar ajuda.
 */

export type TipoDeFalha =
  /** Recusado pelo controle de admissão: a GPU não tinha vaga e a fila estava
   * cheia ou a espera estourou. Distinto de timeout de geração — aqui a
   * inferência nem começou, então nem a placa nem o modelo têm culpa. */
  | 'INFERENCE_CAPACITY_TIMEOUT'
  | 'INFERENCE_QUEUE_TIMEOUT'
  | 'INFERENCE_CONNECTION_TIMEOUT'
  | 'INFERENCE_TTFT_TIMEOUT'
  | 'INFERENCE_GENERATION_TIMEOUT'
  | 'INFERENCE_UPSTREAM_5XX'
  | 'INFERENCE_GPU_UNAVAILABLE'
  | 'INFERENCE_CANCELLED'
  | 'COGNITIVE';

/** Falha de infraestrutura NÃO se corrige pensando de novo. */
export function ehFalhaDeInfraestrutura(tipo: TipoDeFalha): boolean {
  return tipo !== 'COGNITIVE';
}

/**
 * Classifica pelo erro que voltou da borda. Conservador de propósito: só marca
 * infraestrutura quando o sinal é inequívoco, porque classificar falha
 * cognitiva como infra esconderia defeito de verdade do agente.
 */
export function classificarFalha(erro: string | null | undefined): TipoDeFalha {
  const e = (erro ?? '').toLowerCase();
  if (e.length === 0) return 'COGNITIVE';

  // Antes dos genéricos: o gateway devolve 503 COM o marcador, e o marcador é
  // mais informativo que "upstream 5xx" — diz que foi decisão de capacidade
  // nossa, não falha da placa.
  if (e.includes('inference_capacity_timeout')) return 'INFERENCE_CAPACITY_TIMEOUT';
  /**
   * O Bento atende uma pergunta por vez e recusa a segunda com "ocupado
   * respondendo outra pergunta". Isso é CAPACIDADE, não defeito de raciocínio —
   * mas caía em COGNITIVE, então o loop replanejava contra um serviço que só
   * precisava de tempo, e terminava em replan_exhausted. Medido em 17/09/2026
   * com duas perguntas seguidas ao mesmo agente.
   */
  if (/ocupado respondendo|já está respondendo|ja esta respondendo|\bbusy\b/.test(e)) return 'INFERENCE_CAPACITY_TIMEOUT';
  if (/\b(502|503|504|bad gateway|service unavailable|gateway time-?out)\b/.test(e)) return 'INFERENCE_UPSTREAM_5XX';
  if (/aborted due to timeout|abort(ed)?error|timeouterror|operation was aborted/.test(e)) return 'INFERENCE_CONNECTION_TIMEOUT';
  if (/\bnão respondeu em\b|\bdid not respond\b|\btimed? ?out\b|\btimeout\b/.test(e)) return 'INFERENCE_GENERATION_TIMEOUT';
  if (/econnrefused|enotfound|ehostunreach|econnreset|fetch failed|network|socket hang up/.test(e)) return 'INFERENCE_CONNECTION_TIMEOUT';
  if (/no healthy node|has no healthy node|gpu|out of memory|cuda|vram/.test(e)) return 'INFERENCE_GPU_UNAVAILABLE';
  if (/cancel/.test(e)) return 'INFERENCE_CANCELLED';

  return 'COGNITIVE';
}

/**
 * Mensagem para quem está esperando. Diz o que houve e o que fazer, sem culpar
 * a pergunta — o pedido estava certo; a capacidade é que faltou. O erro antigo
 * ("o agente não completou o objetivo") mandava a pessoa reformular uma
 * pergunta que não tinha nada de errado.
 */
export function mensagemDeFalhaDeInfra(tipo: TipoDeFalha): string {
  switch (tipo) {
    case 'INFERENCE_UPSTREAM_5XX':
    case 'INFERENCE_GENERATION_TIMEOUT':
    case 'INFERENCE_QUEUE_TIMEOUT':
    case 'INFERENCE_TTFT_TIMEOUT':
      return 'O servidor de inferência está sem capacidade livre agora e a resposta não voltou a tempo. Sua pergunta está certa: é a fila da GPU. Tente de novo em instantes.';
    case 'INFERENCE_CAPACITY_TIMEOUT':
      return 'A GPU está ocupada com outro trabalho e a fila está cheia. Sua pergunta está certa: não tem nada errado com ela. Repita em instantes que eu respondo.';
    case 'INFERENCE_CONNECTION_TIMEOUT':
      return 'Não consegui falar com o servidor de inferência agora. Não é a sua pergunta: é conexão. Tente de novo em instantes.';
    case 'INFERENCE_GPU_UNAVAILABLE':
      return 'A GPU de inferência está indisponível neste momento. Sua pergunta está certa; assim que houver capacidade eu respondo.';
    case 'INFERENCE_CANCELLED':
      return 'Essa execução foi cancelada antes de terminar.';
    default:
      return 'Não consegui concluir a resposta agora.';
  }
}
