import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from './env';
import * as schema from './schema/index';

const connectionString = requireEnv('DATABASE_URL');

// postgres-js abre até 10 conexões por processo por padrão. O Supabase
// (pooler em session mode) trava em pool_size:15 pro projeto inteiro -
// com api+worker+studio-node+outros nodes rodando ao mesmo tempo, isso
// estourava sozinho (EMAXCONNSESSION real, mesmo sem nenhum leak) bem
// antes de qualquer processo sozinho chegar perto de 10 conexões.
// DATABASE_POOL_MAX permite afinar por serviço em produção; o default
// baixo é o que sobra de espaço dividindo 15 entre os processos locais.
const poolMax = Number(process.env.DATABASE_POOL_MAX) || 3;

// prepare: false porque o Supabase pode estar atrás do connection pooler
// (pgbouncer em modo transaction), que não suporta prepared statements.
const client = postgres(connectionString, { ssl: 'require', prepare: false, max: poolMax });

export const db = drizzle(client, { schema });

export type Database = typeof db;
