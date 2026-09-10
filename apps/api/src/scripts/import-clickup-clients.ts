import '../env.js';
import { createLogger } from '@desigual-os/logging';
import { resolveSharedClickUpAccess } from '../integrations/access';
import { syncClickUpClients } from '../integrations/clickup-sync';

/**
 * Importa os clientes do ClickUp pela linha de comando (`pnpm clickup:import`),
 * usando a MESMA função que a rota POST /integrations/clickup/sync - não há
 * uma segunda implementação pra divergir.
 *
 * Serve pra popular o sistema sem depender de alguém logar no browser, e pra
 * rodar de novo quando a estrutura do ClickUp mudar (é idempotente).
 */
const logger = createLogger({ service: 'clickup-import' });

async function main(): Promise<void> {
  const access = resolveSharedClickUpAccess();
  if (!access) {
    logger.error('CLICKUP_API_KEY/CLICKUP_TEAM_ID não configurados no .env');
    process.exit(1);
  }

  logger.info({ teamId: access.teamId }, 'Importando clientes do ClickUp');
  const result = await syncClickUpClients(access);
  logger.info(result, 'Importação concluída');
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Importação falhou');
  process.exit(1);
});
