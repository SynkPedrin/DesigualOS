/**
 * leitura.ts — o CONTRATO DE LEITURA, e o que ele existe pra impedir.
 *
 * Hoje, quando uma consulta deste sistema devolve `[]`, quem lê não tem como
 * saber qual das sete coisas aconteceu:
 *
 *   A) realmente não há dado
 *   B) a consulta falhou
 *   C) a fonte está indisponível
 *   D) o escopo estava errado
 *   E) o dado existe em outra tabela
 *   F) o dado foi filtrado como TEST
 *   G) a pessoa não tem permissão
 *
 * As sete pedem reações opostas — esperar, consertar a consulta, chamar quem
 * cuida da infra, trocar o filtro, pedir acesso — e todas viram a mesma tela
 * vazia. Este projeto já pagou por isso três vezes num dia:
 *
 *   - "quanto faturamos?" respondido com R$ 0,00 (ausência virando zero);
 *   - a tela de Decisões lendo `memories.kind='decision'`, kind que não existe,
 *     e anunciando "nenhuma decisão registrada" sobre um banco com 9;
 *   - a tela de MCP afirmando "não publicado" por constante, três horas depois
 *     de o servidor subir.
 *
 * A regra que o contrato impõe, e que é a única que importa: EMPTY só pode ser
 * devolvido quando a consulta REALMENTE RODOU e voltou sem linhas. Qualquer
 * outra coisa tem nome próprio.
 */

export type StatusDaLeitura =
  /** Rodou e trouxe dado. */
  | 'OK'
  /** Rodou, com sucesso, e não há linha. Só isto é "vazio". */
  | 'EMPTY'
  /** A fonte não respondeu (rede, timeout, serviço fora). Não é vazio. */
  | 'UNAVAILABLE'
  /** A pessoa não pode ver. Não é vazio, e não é erro. */
  | 'FORBIDDEN'
  /** A consulta quebrou. O dado pode existir; ninguém sabe. */
  | 'FAILED';

export interface Leitura<T> {
  status: StatusDaLeitura;
  /** Vazio em qualquer status que não seja OK — e o status diz por quê. */
  data: T[];
  /** De onde veio: 'clickup', 'postgres:memories', 'mcp:/tools'... */
  source: string;
  /** O recorte aplicado. Sem isto, "vazio" pode ser escopo errado e ninguém vê. */
  scope: string;
  generatedAt: string;
  /**
   * Quantos milissegundos o dado tem. `0` = agora. Serve pra tela dizer "há 3
   * minutos" em vez de apresentar cache como leitura ao vivo.
   */
  freshnessMs: number;
  /** Preenchido em UNAVAILABLE, FORBIDDEN e FAILED. Nunca em OK ou EMPTY. */
  errorCode?: string;
  /** Legível por gente, pra ir direto na tela. */
  detail?: string;
}

interface Base {
  source: string;
  scope: string;
  freshnessMs?: number;
}

function agora(): string {
  return new Date().toISOString();
}

/**
 * Rodou e trouxe (ou não trouxe) dado. A decisão entre OK e EMPTY é feita AQUI,
 * pelo tamanho do resultado — e não pelo chamador, que é onde ela costuma ser
 * esquecida.
 */
export function leu<T>(data: T[], base: Base): Leitura<T> {
  return {
    status: data.length > 0 ? 'OK' : 'EMPTY',
    data,
    source: base.source,
    scope: base.scope,
    generatedAt: agora(),
    freshnessMs: base.freshnessMs ?? 0,
  };
}

/** A fonte não respondeu. O dado pode existir inteiro do outro lado. */
export function indisponivel<T>(base: Base & { errorCode: string; detail: string }): Leitura<T> {
  return {
    status: 'UNAVAILABLE',
    data: [],
    source: base.source,
    scope: base.scope,
    generatedAt: agora(),
    freshnessMs: base.freshnessMs ?? 0,
    errorCode: base.errorCode,
    detail: base.detail,
  };
}

/** Existe e esta pessoa não pode ver. Diferente de não existir. */
export function proibido<T>(base: Base & { detail: string }): Leitura<T> {
  return {
    status: 'FORBIDDEN',
    data: [],
    source: base.source,
    scope: base.scope,
    generatedAt: agora(),
    freshnessMs: 0,
    errorCode: 'FORBIDDEN',
    detail: base.detail,
  };
}

/** A consulta quebrou. Ninguém sabe se há dado. */
export function falhou<T>(base: Base & { errorCode: string; detail: string }): Leitura<T> {
  return {
    status: 'FAILED',
    data: [],
    source: base.source,
    scope: base.scope,
    generatedAt: agora(),
    freshnessMs: 0,
    errorCode: base.errorCode,
    detail: base.detail,
  };
}

/**
 * A frase que a interface mostra quando não há dado.
 *
 * Existe aqui, e não em cada tela, porque a diferença entre os quatro "sem
 * dado" é o ponto inteiro deste arquivo — e reescrevê-la em dez componentes é
 * garantir que em algum deles ela volte a ser "sem dados".
 */
export function explicarAusencia(leitura: Pick<Leitura<unknown>, 'status' | 'detail' | 'scope'>): string | null {
  switch (leitura.status) {
    case 'OK':
      return null;
    case 'EMPTY':
      return `Nada em ${leitura.scope}. A consulta rodou e não há registro — não é falha.`;
    case 'UNAVAILABLE':
      return leitura.detail ?? 'A fonte não respondeu. O dado pode existir; não deu pra ler agora.';
    case 'FORBIDDEN':
      return leitura.detail ?? 'Você não tem acesso a este recorte. Não é ausência de dado.';
    case 'FAILED':
      return leitura.detail ?? 'A consulta falhou. Não dá pra afirmar que está vazio.';
  }
}

/** Só OK e EMPTY significam que a leitura aconteceu. Serve pra somar sem mentir. */
export function leituraAconteceu(status: StatusDaLeitura): boolean {
  return status === 'OK' || status === 'EMPTY';
}
