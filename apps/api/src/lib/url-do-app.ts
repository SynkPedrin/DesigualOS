/**
 * url-do-app.ts — a fonte canônica de "qual é o endereço do front".
 *
 * `FRONTEND_URL` é, desde 24/09/2026, uma LISTA separada por vírgula. Ela
 * nasceu assim para o CORS: o front local de dev e o front publicado na Vercel
 * são os dois legítimos, e o `origin` do plugin de CORS aceita um array (ver
 * server.ts). O problema é que o resto do código nunca soube disso. Seis
 * lugares faziam, cada um por conta própria:
 *
 *     `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/convite`
 *
 * Com o valor real de produção, isso produz:
 *
 *     http://localhost:3000,https://desigual-os.vercel.app/convite
 *
 * que não é endereço de lugar nenhum. Era o `redirect_to` do link mágico de
 * convite, o da redefinição de senha, o callback do OAuth do ClickUp e do
 * Meta, e o botão "Abrir o Desigual OS" do e-mail. A variável tem uma forma, e
 * a forma estava documentada só no comentário ao lado do CORS — a regra morava
 * num arquivo e era aplicada errado em outros seis. É a mesma classe de defeito
 * que `escopo-de-organizacao.ts` descreve no cabeçalho dele: regra de negócio
 * sem fonte canônica vira cópia divergente.
 *
 * A PRIMEIRA ENTRADA É A CANÔNICA. Em produção a lista começa pelo endereço de
 * produção; em dev, por localhost. Quem precisa da lista inteira (só o CORS)
 * usa `origensDoFront()`.
 */

const PADRAO_DE_DEV = 'http://localhost:3000';

/** Todas as origens permitidas, na ordem em que foram declaradas. Só o CORS
 *  precisa disto — um link só pode apontar para um lugar. */
export function origensDoFront(): string[] {
  const bruto = process.env.FRONTEND_URL ?? PADRAO_DE_DEV;
  const origens = bruto
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origens.length > 0 ? origens : [PADRAO_DE_DEV];
}

/** O endereço do front, sem barra no fim. */
export function urlDoApp(): string {
  return origensDoFront()[0]!;
}

/**
 * O endereço do front com um caminho — o jeito certo de montar qualquer link
 * que saia daqui para o navegador de alguém (convite, redefinição, callback de
 * OAuth). `caminho` começa com barra.
 */
export function urlDoAppCom(caminho: string): string {
  return `${urlDoApp()}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
}
