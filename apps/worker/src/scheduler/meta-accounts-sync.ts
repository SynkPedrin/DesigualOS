import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { META_PROVIDER, syncMetaAdAccountsForUser, syncMetaCentralAccounts } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';

/**
 * Sync DIÁRIA de contas Meta Ads (16/10/2026) — a mesma auto-sync que roda no
 * callback do OAuth e no botão "Sincronizar contas", agora pra TODAS as
 * conexões Meta ativas. Conta nova aparece na BM (ou cliente novo aparece no
 * cadastro) e o vínculo por nome se refaz sozinho, sem ninguém lembrar de
 * apertar botão.
 *
 * UMA CONEXÃO FALHAR NUNCA DERRUBA AS OUTRAS — mesmo princípio do
 * google-calendar-sync.ts: token revogado de um colaborador não pode impedir
 * a sync de todo mundo.
 */
export async function syncAllMetaAdAccounts(logger: Logger): Promise<void> {
  const conexoes = await db
    .select({ userId: schema.integrationConnections.userId })
    .from(schema.integrationConnections)
    .where(and(eq(schema.integrationConnections.provider, META_PROVIDER), eq(schema.integrationConnections.status, 'connected')));
  await syncMetaCentral(logger);
  if (conexoes.length === 0) return;

  let sucesso = 0;
  let falha = 0;
  let naoConectado = 0;
  for (const { userId } of conexoes) {
    try {
      const relatorio = await syncMetaAdAccountsForUser(userId, 'worker');
      if (relatorio.status === 'not_connected') {
        // status='connected' no banco mas token recusado pelo Meta — a
        // conexão morreu de verdade e só a checagem ao vivo viu.
        naoConectado += 1;
        logger.warn({ userId }, 'Sync de contas Meta: conexão marcada como connected mas o token não vale mais');
        continue;
      }
      sucesso += 1;
      logger.info(
        { userId, vinculadas: relatorio.vinculadas.length, jaVinculadas: relatorio.jaVinculadas.length, pendentes: relatorio.pendentes.length },
        'Contas Meta Ads sincronizadas',
      );
    } catch (error) {
      falha += 1;
      // `error` como objeto saía {} no log (Error não serializa assim) —
      // mesma correção do google-calendar-sync.ts (14/10/2026).
      logger.error({ userId, motivo: error instanceof Error ? error.message : String(error) }, 'Falha ao sincronizar contas Meta de um colaborador — seguindo pras próximas');
    }
  }
  logger.info({ total: conexoes.length, sucesso, falha, naoConectado }, 'Sync diária de contas Meta Ads concluída');
}

/**
 * Sync da conexão CENTRAL (usuário do sistema). Roda junto da diária: conta
 * nova na BM ou cliente novo no cadastro se vincula sem ninguém apertar botão.
 */
export async function syncMetaCentral(logger: Logger): Promise<void> {
  try {
    const relatorio = await syncMetaCentralAccounts('worker');
    if (relatorio.status === 'not_connected') return;
    logger.info(
      { vinculadas: relatorio.vinculadas.length, jaVinculadas: relatorio.jaVinculadas.length, pendentes: relatorio.pendentes.length },
      'Contas Meta Ads da conexão central sincronizadas',
    );
  } catch (error) {
    logger.error({ motivo: error instanceof Error ? error.message : String(error) }, 'Falha ao sincronizar a conexão Meta central');
  }
}
