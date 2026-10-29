/**
 * Marcação com @ no WhatsApp (pedido do Pedro, 29/10/2026). Na caixa a pessoa vê "@Nome"; no envio o texto leva
 * "@<número>" de cada marcada e a lista `mentions` com os ids — é assim que o WhatsApp desenha a marcação e avisa a
 * pessoa. Funções puras, separadas da tela, para dar para testar.
 */

export interface PessoaMarcavel {
  id: string;
  token: string;
  nome: string;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

/** O "@algo" que está sendo digitado bem antes do cursor (no início ou depois de espaço), ou nada. */
export function consultaDeMarcacao(texto: string, cursor: number): { inicio: number; termo: string } | null {
  const antes = texto.slice(0, cursor);
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(antes);
  if (!m) return null;
  return { inicio: cursor - m[2]!.length - 1, termo: m[2]! };
}

export function filtrarMarcaveis(pessoas: PessoaMarcavel[], termo: string, limite = 8): PessoaMarcavel[] {
  const t = semAcento(termo);
  if (!t) return pessoas.slice(0, limite);
  const comeca = pessoas.filter((p) => semAcento(p.nome).split(/\s+/).some((parte) => parte.startsWith(t)) || p.token.startsWith(t));
  const contem = pessoas.filter((p) => !comeca.includes(p) && semAcento(p.nome).includes(t));
  return [...comeca, ...contem].slice(0, limite);
}

/** Troca o "@termo" sendo digitado por "@Nome " e diz onde o cursor fica. */
export function inserirMarcacao(texto: string, consulta: { inicio: number; termo: string }, pessoa: PessoaMarcavel): { texto: string; cursor: number } {
  const fim = consulta.inicio + 1 + consulta.termo.length;
  const inserido = `@${pessoa.nome} `;
  return { texto: texto.slice(0, consulta.inicio) + inserido + texto.slice(fim), cursor: consulta.inicio + inserido.length };
}

/**
 * Texto da caixa → o que vai ao WhatsApp. Só vale a marcação que continua no texto (apagou o "@Nome", não marca).
 * Nomes mais longos primeiro, para "@Ana Paula" não virar "@Ana" + " Paula".
 */
export function paraEnvio(texto: string, marcadas: PessoaMarcavel[]): { texto: string; mentions: string[] } {
  let saida = texto;
  const mentions: string[] = [];
  for (const p of [...marcadas].sort((a, b) => b.nome.length - a.nome.length)) {
    const alvo = `@${p.nome}`;
    if (!saida.includes(alvo)) continue;
    saida = saida.split(alvo).join(`@${p.token}`);
    if (!mentions.includes(p.id)) mentions.push(p.id);
  }
  return { texto: saida, mentions };
}

/** Na bolha, "@5518..." (como o WhatsApp guarda) aparece como "@Nome" quando a gente conhece a pessoa. */
export function comNomes(texto: string, pessoas: PessoaMarcavel[]): string {
  if (!pessoas.length || !texto.includes('@')) return texto;
  const porToken = new Map(pessoas.map((p) => [p.token, p.nome]));
  return texto.replace(/@(\d{5,20})\b/g, (todo, token: string) => (porToken.has(token) ? `@${porToken.get(token)}` : todo));
}
