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
 * A conta que roda a bateria de aceite. Mesmo critério do guard de escrita
 * (`ehQaBot`), replicado aqui só pra não criar dependência circular entre
 * environment.ts e bento-action-guard.ts — o VALOR vem da mesma variável, que
 * é o que impede as duas de divergirem.
 */
export function ehContaDeQa(email: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!email) return false;
  const configurado = (env.BENTO_QA_BOT_EMAIL ?? 'qa-bot@institutoalmada.org').trim().toLowerCase();
  return email.trim().toLowerCase() === configurado;
}
