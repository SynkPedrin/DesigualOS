import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from './env';
import * as schema from './schema/index';

const connectionString = requireEnv('DATABASE_URL');

// prepare: false porque o Supabase pode estar atrás do connection pooler
// (pgbouncer em modo transaction), que não suporta prepared statements.
const client = postgres(connectionString, { ssl: 'require', prepare: false });

export const db = drizzle(client, { schema });

export type Database = typeof db;
