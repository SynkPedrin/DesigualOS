/**
 * formato.ts: dinheiro e datas da Gestão Empresarial no navegador.
 *
 * Dinheiro é SEMPRE inteiro em centavos, igual à API. Nunca `Number('12,50') * 100` (dá 1249,99999
 * em alguns casos) e nunca float guardado em estado. Datas financeiras são DIA ("AAAA-MM-DD"), sem
 * fuso: `new Date('2026-10-22')` vira o dia 21 em São Paulo, e foi assim que o PDF do relatório
 * já mostrou datas um dia atrás.
 */

export class ValorInvalido extends Error {}

/** 123456 → "R$ 1.234,56". Sem Intl: o resultado é igual em qualquer máquina e idioma. */
export function formatarCentavos(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const reais = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

/** O que a pessoa digita ("1.234,56", "R$ 12", "12,5", "1234.56") → centavos. Lança em texto que não é dinheiro. */
export function centavosDeTexto(texto: string): number {
  const limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!limpo) throw new ValorInvalido('Informe um valor.');
  const negativo = limpo.startsWith('-');
  const corpo = negativo ? limpo.slice(1) : limpo;
  if (!/^\d[\d.,]*$/.test(corpo)) throw new ValorInvalido('Use só números, ponto e vírgula. Exemplo: 1.234,56');
  const m = /^(.*?)[.,](\d{1,2})$/.exec(corpo);
  const inteiros = (m ? m[1]! : corpo).replace(/[.,]/g, '');
  const fracao = m ? m[2]!.padEnd(2, '0') : '00';
  if (!/^\d+$/.test(inteiros)) throw new ValorInvalido('Valor inválido.');
  const centavos = Number(inteiros) * 100 + Number(fracao);
  if (!Number.isSafeInteger(centavos)) throw new ValorInvalido('Valor grande demais.');
  return negativo ? -centavos : centavos;
}

/** Centavos de volta para o campo de edição ("1234,56"), sem milhar, para reeditar sem perder nada. */
export const centavosParaCampo = (centavos: number): string => `${centavos < 0 ? '-' : ''}${Math.trunc(Math.abs(centavos) / 100)},${String(Math.abs(centavos) % 100).padStart(2, '0')}`;

/** "2026-10-22" → "22/10/2026". Só reordena o texto: nenhum `Date`, nenhum fuso. */
export function formatarDia(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** "Hoje" no fuso da agência, no mesmo formato que a API usa. */
export function hojeIso(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export const SITUACAO: Record<string, { rotulo: string; classe: string }> = {
  aberto: { rotulo: 'Em aberto', classe: 'bg-roxo-eletrico/15 text-roxo-eletrico' },
  vencido: { rotulo: 'Vencido', classe: 'bg-red-500/15 text-red-500' },
  quitado: { rotulo: 'Quitado', classe: 'bg-sucesso/15 text-sucesso' },
  cancelado: { rotulo: 'Cancelado', classe: 'bg-grafite-elevado text-nevoa line-through' },
};

export const AVISO_HISTORICO_PARCIAL = 'Histórico importado parcialmente. Indicadores financeiros consolidados podem não representar a operação completa.';
