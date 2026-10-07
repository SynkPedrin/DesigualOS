import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createLogger } from '@desigual-os/logging';
import { requireEnv } from './env';
import { sslDoDestino } from './ssl';

const logger = createLogger({ service: 'database:migrate' });

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const ssl = sslDoDestino(connectionString);
  const client = postgres(connectionString, { ssl, prepare: false, max: 1 });
  const db = drizzle(client);

  logger.info({ ssl: ssl === false ? 'disabled (destino local)' : 'require' }, 'Running migrations');
  await migrate(db, { migrationsFolder: '../../database/migrations' });
  logger.info('Migrations applied');

  await client.end();
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Migration failed');
  process.exit(1);
});
