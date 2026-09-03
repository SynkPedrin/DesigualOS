import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createLogger } from '@desigual-os/logging';
import { requireEnv } from './env';

const logger = createLogger({ service: 'database:migrate' });

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const client = postgres(connectionString, { ssl: 'require', prepare: false, max: 1 });
  const db = drizzle(client);

  logger.info('Running migrations against Supabase Postgres');
  await migrate(db, { migrationsFolder: '../../database/migrations' });
  logger.info('Migrations applied');

  await client.end();
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Migration failed');
  process.exit(1);
});
