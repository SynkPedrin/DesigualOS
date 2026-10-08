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
 * O endereço do front com um caminho, DENTRO desta instalação — o callback de
 * OAuth que volta pro navegador que acabou de sair daqui. `caminho` começa
 * com barra.
 *
 * Para link que vai num E-MAIL, use `urlPublicaDoAppCom`. A diferença é quem
 * abre: aqui é o mesmo navegador, na mesma máquina; lá é outra pessoa.
 */
export function urlDoAppCom(caminho: string): string {
  return `${urlDoApp()}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
}

/**
 * ─── O ENDEREÇO QUE PODE VIAJAR ─────────────────────────────────────────
 *
 * O DEFEITO (08/10/2026, relatado como "o e-mail de acesso não funciona"): o
 * link de convite saía com `redirect_to=http://localhost:3000/convite`. Quem
 * recebe o e-mail clica, o Supabase valida o token e manda o navegador DELE
 * para localhost:3000 — a máquina dele, onde não há nada. O convite chegava,
 * o token era válido, e o acesso era impossível.
 *
 * A causa é uma suposição minha que não se sustentou. `urlDoApp` devolve a
 * PRIMEIRA entrada de FRONTEND_URL, e eu escrevi que "em produção a lista
 * começa pelo endereço de produção". A lista real começa por localhost, porque
 * ela nasceu para o CORS — e lá a ordem não significa nada.
 *
 * A regra que vale aqui não depende de ordem: UM LINK QUE SAI DESTA MÁQUINA
 * NÃO PODE APONTAR PARA ESTA MÁQUINA. Então entre as origens declaradas,
 * prefere-se a primeira que não seja local. Se só existe localhost (dev puro,
 * sem front publicado), ela continua valendo — aí o e-mail é para você mesmo.
 */
const LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function ehLocal(origem: string): boolean {
  try {
    // `new URL('http://[::1]:3000').hostname` devolve "[::1]", COM colchetes —
    // o teste pegou isso. Sem tirar, o IPv6 local passava por endereço público.
    return LOCAIS.has(new URL(origem).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

/** O endereço do front que faz sentido para quem está FORA desta máquina. */
export function urlPublicaDoApp(): string {
  const origens = origensDoFront();
  return origens.find((o) => !ehLocal(o)) ?? origens[0]!;
}

/** `urlPublicaDoApp` com um caminho — para link de e-mail (convite, senha). */
export function urlPublicaDoAppCom(caminho: string): string {
  return `${urlPublicaDoApp()}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
}
