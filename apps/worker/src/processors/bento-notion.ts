/**
 * bento-notion.ts — `@notion` manda o que acabou de sair pro Notion da pessoa.
 *
 * Pedido da operação (28/09/2026): "só quando o colaborador quiser e solicitar
 * no chat, ou colocando @notion; aí sim ele gera um arquivo no Notion".
 *
 * Duas coisas nisso, e as duas são do pedido:
 *
 *   1. É SOB DEMANDA. Nada vai pro Notion sozinho. Sem `@notion` (ou um pedido
 *      explícito), este módulo nem é chamado — o turno segue exatamente como
 *      antes. Uma integração que exporta por conta própria vira lixo no
 *      workspace de todo mundo em uma semana.
 *   2. É O NOTION DA PESSOA. O token vem de `integration_connections`, por
 *      usuário, via OAuth (ver notion-oauth.ts). A página nasce no workspace
 *      de quem pediu, assinada por quem pediu — e não conectou ainda, a
 *      resposta é o convite pra conectar, não um erro técnico.
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { criarPaginaNotion, decryptToken, listarDestinosNotion } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

export const NOTION_PROVIDER = 'notion';

/**
 * A menção. Aceita `@notion` em qualquer posição e também o pedido escrito por
 * extenso — a pessoa que digita "manda isso pro notion" está pedindo a mesma
 * coisa que quem digita o arroba, e recusar por falta de sintaxe seria ensinar
 * sintaxe em vez de atender.
 */
const MENCAO_RE = /(^|\s)@notion\b/i;
const PEDIDO_ESCRITO_RE = /\b(mand[ae]|envi[ae]|sob[ae]|exporta?r?|cria?r?|salva?r?|joga)\b[^.!?]{0,40}\b(pro|para o|no|na)\s+notion\b/i;

export function pedeNotion(mensagem: string): boolean {
  return MENCAO_RE.test(mensagem) || PEDIDO_ESCRITO_RE.test(mensagem);
}

/** Tira o `@notion` do texto: ele endereça, não faz parte do pedido. */
export function semMencaoNotion(mensagem: string): string {
  return mensagem.replace(MENCAO_RE, '$1').replace(/\s{2,}/g, ' ').trim();
}

/**
 * SÓ O TOKEN DA PESSOA. Não existe fallback, e a ausência é a decisão.
 *
 * Houve uma versão com token único da agência como rede de segurança, pra
 * `@notion` funcionar antes de a integração pública existir. A operação
 * recusou, e com razão: um workspace compartilhado é o lugar onde o arquivo de
 * todo mundo vira arquivo de ninguém. Cada pessoa conecta a própria conta e
 * gera na própria conta — quem não conectou recebe o convite, não a página no
 * Notion alheio.
 */
export async function escolherToken(userId: string, logger: Logger): Promise<string | null> {
  return userId ? tokenDoUsuario(userId, logger) : null;
}

async function tokenDoUsuario(userId: string, logger: Logger): Promise<string | null> {
  const [linha] = await db
    .select({ token: schema.integrationConnections.accessTokenEncrypted, status: schema.integrationConnections.status })
    .from(schema.integrationConnections)
    .where(
      and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, NOTION_PROVIDER)),
    )
    .limit(1)
    .catch(() => []);
  if (!linha || linha.status !== 'connected') return null;
  try {
    return decryptToken(linha.token);
  } catch (error) {
    logger.warn({ error, userId }, '[bento-notion] token gravado não pôde ser decifrado');
    return null;
  }
}

export interface ResultadoNotion {
  /** Texto pra acrescentar à resposta do turno. Nunca substitui o que o Bento já fez. */
  linha: string;
  url: string | null;
}

/**
 * Exporta um conteúdo já PRONTO (um briefing, uma análise) pro Notion de quem
 * pediu. Nunca gera conteúdo novo: o que vai pro Notion é o que a pessoa
 * acabou de ver no chat, e é por isso que o parâmetro é o markdown, não o
 * pedido.
 */
export async function exportarParaNotion(params: {
  userId: string;
  titulo: string;
  markdown: string;
  logger: Logger;
}): Promise<ResultadoNotion> {
  const token = await escolherToken(params.userId, params.logger);
  if (!token) {
    return {
      linha:
        '📄 Pra mandar isso pro Notion eu preciso da sua conta conectada — é uma vez só: **Configurações → Integrações → Conectar Notion**. Depois disso, `@notion` funciona direto.',
      url: null,
    };
  }
  const destinos = await listarDestinosNotion(token, 5).catch((error: unknown) => {
    params.logger.warn({ error }, '[bento-notion] não consegui listar destinos');
    return [];
  });
  const destino = destinos[0];
  if (!destino) {
    // Conectar sem liberar página é o erro silencioso mais provável aqui: o
    // Notion aceita a conexão e a integração não enxerga lugar nenhum.
    return {
      linha:
        '📄 Sua conta do Notion está conectada, mas a integração não tem acesso a nenhuma página. No Notion, abra a página onde isso deve nascer → **•••** → **Conexões** → adicione o Desigual OS. Aí eu mando.',
      url: null,
    };
  }

  try {
    const pagina = await criarPaginaNotion({ token, parentId: destino.id, titulo: params.titulo, markdown: params.markdown });
    params.logger.info({ userId: params.userId, destino: destino.title, pagina: pagina.id }, '[bento-notion] página criada');
    const aviso = pagina.blocosOmitidos > 0 ? ` (as últimas ${pagina.blocosOmitidos} linhas não couberam e ficaram de fora)` : '';
    return { linha: `📄 No seu Notion, em **${destino.title}**: ${pagina.url}${aviso}`, url: pagina.url };
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error);
    params.logger.warn({ error: detalhe }, '[bento-notion] falha ao criar página');
    return { linha: `📄 Não consegui criar a página no Notion: ${detalhe}`, url: null };
  }
}

/**
 * Título da página. Sai do PEDIDO, não da resposta: é o que a pessoa
 * reconhece ao ver a lista do Notion depois. Sem o `@notion`, sem verbo de
 * envio, e curto o bastante pra caber na lateral.
 */
export function tituloParaNotion(mensagem: string, clientName: string | null): string {
  const limpo = semMencaoNotion(mensagem)
    .replace(PEDIDO_ESCRITO_RE, ' ')
    .replace(/^\s*(bento|ô bento|oi bento)[,:\s]+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const base = limpo.length >= 6 ? limpo.slice(0, 90) : 'Conteúdo do Desigual OS';
  return clientName ? `${base} — ${clientName}` : base;
}
