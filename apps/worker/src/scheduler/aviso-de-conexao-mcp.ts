import { db, schema } from '@desigual-os/database';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Logger } from '@desigual-os/logging';
import { ehContaDeQa } from '../processors/environment.js';

/**
 * aviso-de-conexao-mcp.ts — alguém acabou de plugar o Claude no Desigual OS, e
 * quem cuida do sistema fica sabendo.
 *
 * O servidor MCP já emite `CONNECTION_CREATED` em `operational_events` a cada
 * sessão nova (o par desta feature, do outro lado). O que faltava era o
 * caminho até a pessoa: o evento existia no banco e ninguém era avisado.
 *
 * TRÊS COISAS QUE A MEDIÇÃO MUDOU NO DESENHO, e nenhuma delas era óbvia antes
 * de olhar o dado real (30/09/2026, 6 eventos no banco):
 *
 * 1. UMA CONEXÃO HUMANA NÃO É UM EVENTO. Os 6 eventos são da MESMA pessoa,
 *    dentro de 5 SEGUNDOS — o cliente abre várias sessões ao conectar. Um aviso
 *    por evento teria gerado 6 notificações × 4 masters = 24 linhas para um
 *    único ato humano. Por isso o agrupamento é por PESSOA, com silêncio
 *    posterior: quem conectou agora não gera outro aviso tão cedo.
 *
 * 2. O BACKLOG NÃO É NOTÍCIA. Na primeira vez que isto rodar, os eventos
 *    antigos já estarão fora da janela e não viram aviso nenhum. Anunciar como
 *    "acabou de conectar" algo de ontem é mentir sobre o tempo — e o histórico
 *    já tem lugar: a tela de MCP mostra `conexoes_recentes` inteiro.
 *
 * 3. CONTA DE TESTE NÃO É OPERAÇÃO. Ela não gera aviso (ninguém precisa saber
 *    que a bateria de aceite conectou) e não recebe aviso. É a mesma regra que
 *    já decide `environment`, aplicada ao mesmo problema numa roupa nova.
 */

/**
 * Quão longe atrás o vigia olha. Ele roda de 2 em 2 minutos, então 15 minutos
 * cobrem com folga uma parada curta do worker. Mais que isso começaria a
 * ressuscitar conexão velha como se fosse agora.
 */
export const JANELA_DE_OLHAR_MS = 15 * 60 * 1000;

/**
 * Depois de avisar sobre uma pessoa, silêncio sobre ELA por este tempo.
 *
 * Cobre a rajada de sessões do próprio cliente (5s medidos) com margem enorme,
 * e também a reconexão de quem está com a internet instável — que é ruído pra
 * quem lê, não informação.
 */
export const SILENCIO_POR_PESSOA_MS = 60 * 60 * 1000;

/** O tipo que identifica estas notificações. Serve pro de-duplicador se achar. */
export const TIPO_DE_AVISO = 'mcp_connection';

export interface EventoDeConexao {
  id: string;
  userId: string | null;
  actor: string | null;
  occurredAt: Date | null;
}

export interface AvisoDeConexao {
  /** Quem conectou. */
  userId: string;
  nome: string;
  /** O começo da rajada — quando a pessoa de fato conectou. */
  quando: Date;
  /** Quantas sessões vieram na mesma rajada. Não é ruído: é o que o cliente faz. */
  sessoes: number;
}

/**
 * Decide, a partir dos eventos crus, sobre QUEM avisar — e não sobre o quê.
 *
 * Pura de propósito: é aqui que mora a regra que a medição corrigiu, e regra
 * dessas envelhece mal quando só pode ser verificada contra o banco.
 */
export function agruparConexoes(
  eventos: readonly EventoDeConexao[],
  /** userId → quando a última notificação sobre essa pessoa foi criada. */
  avisadosRecentemente: ReadonlyMap<string, Date>,
  agora: Date,
  opcoes: { janelaMs?: number; silencioMs?: number } = {},
): AvisoDeConexao[] {
  const janela = opcoes.janelaMs ?? JANELA_DE_OLHAR_MS;
  const silencio = opcoes.silencioMs ?? SILENCIO_POR_PESSOA_MS;
  const limite = agora.getTime() - janela;

  const porPessoa = new Map<string, AvisoDeConexao>();

  for (const e of eventos) {
    if (!e.userId || !e.occurredAt) continue;
    if (e.occurredAt.getTime() < limite) continue;

    const ultimoAviso = avisadosRecentemente.get(e.userId);
    if (ultimoAviso && agora.getTime() - ultimoAviso.getTime() < silencio) continue;

    const atual = porPessoa.get(e.userId);
    if (!atual) {
      porPessoa.set(e.userId, {
        userId: e.userId,
        nome: e.actor ?? 'Alguém',
        quando: e.occurredAt,
        sessoes: 1,
      });
      continue;
    }
    atual.sessoes += 1;
    // O COMEÇO da rajada é a hora de conectar. A última sessão é consequência.
    if (e.occurredAt.getTime() < atual.quando.getTime()) atual.quando = e.occurredAt;
    if (atual.nome === 'Alguém' && e.actor) atual.nome = e.actor;
  }

  return [...porPessoa.values()].sort((a, b) => b.quando.getTime() - a.quando.getTime());
}

/** O texto que a pessoa lê no sino. Separado pra poder ser conferido sem banco. */
export function redigirAviso(aviso: AvisoDeConexao): { title: string; body: string; link: string } {
  return {
    title: `${aviso.nome} conectou o Claude ao Desigual OS`,
    body:
      aviso.sessoes > 1
        ? `${aviso.sessoes} sessões abertas de uma vez — é o que o cliente faz ao conectar, não são ${aviso.sessoes} pessoas.`
        : 'Uma nova sessão de MCP foi autorizada. Os escopos concedidos estão na tela de MCP.',
    link: `/mcp?conectou=${aviso.userId}`,
  };
}

/**
 * Lê os eventos, decide e grava. Roda a cada 2 minutos.
 */
export async function avisarDeConexoesMcp(logger: Logger, agora = new Date()): Promise<number> {
  const desde = new Date(agora.getTime() - JANELA_DE_OLHAR_MS);

  const eventos = await db
    .select({
      id: schema.operationalEvents.id,
      userId: schema.operationalEvents.userId,
      actor: schema.operationalEvents.actor,
      occurredAt: schema.operationalEvents.occurredAt,
    })
    .from(schema.operationalEvents)
    .where(
      and(eq(schema.operationalEvents.type, 'CONNECTION_CREATED'), gte(schema.operationalEvents.occurredAt, desde)),
    )
    .orderBy(desc(schema.operationalEvents.occurredAt))
    .limit(200);

  if (eventos.length === 0) return 0;

  /**
   * QUEM JÁ FOI ANUNCIADO, lido do próprio acervo de notificações.
   *
   * Marca d'água em memória seria mais barata e mentiria a cada restart do
   * worker: reiniciou, reanuncia tudo. O estado real de "já avisei" é a
   * notificação existir, então é dela que a resposta sai.
   */
  const recentes = await db
    .select({ link: schema.notifications.link, createdAt: schema.notifications.createdAt })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.type, TIPO_DE_AVISO),
        gte(schema.notifications.createdAt, new Date(agora.getTime() - SILENCIO_POR_PESSOA_MS)),
      ),
    );

  const avisadosRecentemente = new Map<string, Date>();
  for (const n of recentes) {
    const quem = n.link?.match(/conectou=([0-9a-f-]{36})/i)?.[1];
    if (!quem || !n.createdAt) continue;
    const anterior = avisadosRecentemente.get(quem);
    if (!anterior || n.createdAt > anterior) avisadosRecentemente.set(quem, n.createdAt);
  }

  const avisos = agruparConexoes(eventos, avisadosRecentemente, agora);
  if (avisos.length === 0) return 0;

  /**
   * Os destinatários: master, menos as contas de teste.
   *
   * O papel `super` do briefing não existe como papel neste banco — `super` é
   * uma PESSOA, master, como o Pedro. Notificar por papel alcança os dois sem
   * depender de nome, que muda.
   */
  const masters = await db
    .select({ userId: schema.userRoles.userId, email: schema.users.email })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(eq(schema.roles.name, 'master'));

  const destinatarios = masters.filter((m) => !ehContaDeQa(m.email));
  if (destinatarios.length === 0) return 0;

  /**
   * QUEM CONECTOU é conta de teste? A resposta está no e-mail, e o evento só
   * carrega nome ("QA Bot"). Decidir por nome seria heurística sobre string
   * digitada; o e-mail é o mesmo critério que já classifica `environment`.
   */
  const quemConectou = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, avisos.map((a) => a.userId)));
  const deTeste = new Set(quemConectou.filter((u) => ehContaDeQa(u.email)).map((u) => u.id));

  const linhas = avisos
    // Conta de teste conectando não é notícia de operação.
    .filter((a) => !deTeste.has(a.userId))
    .flatMap((aviso) => {
      const texto = redigirAviso(aviso);
      return (
        destinatarios
          // Ninguém precisa ser avisado da própria conexão.
          .filter((d) => d.userId !== aviso.userId)
          .map((d) => ({ userId: d.userId, type: TIPO_DE_AVISO, ...texto }))
      );
    });

  if (linhas.length === 0) return 0;

  await db.insert(schema.notifications).values(linhas);
  logger.info(
    { pessoas: avisos.length, notificacoes: linhas.length },
    'Aviso de conexao MCP entregue',
  );
  return linhas.length;
}
