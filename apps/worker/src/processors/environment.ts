import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';

/**
 * environment.ts — o ambiente da execução, resolvido uma vez e propagado.
 *
 * O `environment` existia nos schemas com default 'production' e os caminhos de
 * escrita não o propagavam. Resultado medido em 16/09/2026: 41 registros de
 * cognição nascidos de clientes de TESTE gravados como produção — episódios,
 * memórias e blackboards recuperáveis num turno real.
 *
 * Default silencioso é o problema: onde o ambiente É conhecido, ele tem que
 * viajar. Aqui ele é resolvido no começo do turno, a partir do cliente, e
 * carregado por tudo que a execução escreve.
 */

export type Ambiente = 'production' | 'qa';

/**
 * QUEM PERGUNTA TAMBÉM DECIDE O AMBIENTE (30/09/2026).
 *
 * A primeira versão resolvia só pelo CLIENTE, e isso deixava um buraco que a
 * medição encontrou: a conta de QA conversando SEM cliente selecionado caía no
 * default 'production'. Foi assim que 11 episódios de aceite nasceram como
 * conhecimento da operação real — frases do tipo "Bento, guarda esta
 * referência da conversa: marco-029857" listadas como decisão da agência.
 *
 * Consertar a frase no teste trataria o sintoma. A classe do erro é outra:
 * ambiente derivado de UMA dimensão quando duas o determinam. A cerca de
 * escrita do ClickUp já usava a identidade de quem pede (`ehQaBot`, ver
 * bento-action-guard.ts); a cognição não usava, e por isso divergiam.
 *
 * Ordem: QA vence produção. Errar pra QA esconde um dado real do acervo e
 * alguém reclama; errar pra produção injeta dado falso no acervo e ninguém
 * percebe — como não se percebeu por duas semanas.
 */
export async function resolveEnvironment(
  clientId: string | null | undefined,
  userId?: string | null,
): Promise<Ambiente> {
  if (userId) {
    const [u] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .catch(() => []);
    if (ehContaDeQa(u?.email ?? null)) return 'qa';
  }

  if (!clientId) return 'production';
  const [c] = await db
    .select({ environment: schema.clients.environment })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .catch(() => []);
  return c?.environment === 'qa' ? 'qa' : 'production';
}

/**
 * As contas que rodam bateria de aceite. Mesmo critério do guard de escrita
 * (`ehQaBot`), replicado aqui só pra não criar dependência circular entre
 * environment.ts e bento-action-guard.ts — o VALOR vem da mesma variável, que
 * é o que impede as duas de divergirem.
 *
 * É uma LISTA desde 30/09/2026, e não por gosto de generalizar: ao contar quem
 * é master no banco real apareceu `qa-motion@agenciadesigual.com.br`, criada
 * pro e2e do motion, master, e classificada como produção em tudo que escreve.
 * Exatamente o buraco que o parágrafo acima descreve — fechado pra uma conta e
 * aberto pra outra, porque a regra só cabia uma.
 *
 * `BENTO_QA_BOT_EMAIL` continua valendo sozinha pra quem já a define; quando
 * configurada, ela SUBSTITUI o padrão, senão um ambiente que aponta a conta de
 * QA pra outra org herdaria as nossas de brinde.
 */
const CONTAS_DE_QA_PADRAO = ['qa-bot@institutoalmada.org', 'qa-motion@agenciadesigual.com.br'];

export function ehContaDeQa(email: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!email) return false;
  const configurado = env.BENTO_QA_BOT_EMAIL?.trim();
  const contas = configurado
    ? configurado.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : CONTAS_DE_QA_PADRAO;
  return contas.includes(email.trim().toLowerCase());
}
