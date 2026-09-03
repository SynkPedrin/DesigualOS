import { createLogger } from '@desigual-os/logging';
import { loadConfig } from './config';
import { registerWithOrchestrator } from './register';
import { startHeartbeatLoop } from './heartbeat/index';
import { buildServer } from './server/index';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: `node:${config.NODE_ID}` });

  const app = buildServer(config);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'Desigual Node Agent listening');

  await registerWithOrchestrator(config, logger);
  startHeartbeatLoop(config, logger);
}

main().catch((error: unknown) => {
  console.error('Fatal error starting Desigual Node Agent:', error);
  process.exit(1);
});
