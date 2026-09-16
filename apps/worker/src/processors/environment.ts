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
 * Ambiente da execução. O cliente manda: um turno sobre cliente de QA é QA,
 * independentemente de quem perguntou ou de onde veio a requisição.
 */
export async function resolveEnvironment(clientId: string | null | undefined): Promise<Ambiente> {
  if (!clientId) return 'production';
  const [c] = await db
    .select({ environment: schema.clients.environment })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .catch(() => []);
  return c?.environment === 'qa' ? 'qa' : 'production';
}
