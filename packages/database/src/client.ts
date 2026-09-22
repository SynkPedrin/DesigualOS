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

/**
 * Teto para ABRIR conexão.
 *
 * Sem ele, com o banco inalcançável (VPN caída, Supabase em manutenção, DNS
 * ruim), abrir conexão nova fica esperando o timeout de TCP do sistema
 * operacional - minutos, sem log e sem erro, com a requisição do usuário
 * pendurada junto. 15s é bem acima da ida e volta real medida daqui (~130ms
 * pro us-east-1) e bem abaixo do que qualquer pessoa tolera olhando a tela.
 *
 * SOBRE `statement_timeout`: medido em 18/09/2026 que NÃO adianta passá-lo
 * aqui. A conexão vai pelo Supavisor (o pooler do Supabase), que DESCARTA os
 * parâmetros de startup - a sonda mostrou `application_name` chegando como
 * "Supavisor" em vez do valor enviado, e `statement_timeout` ficando em `2min`
 * tanto via `connection: { statement_timeout }` quanto via
 * `options=-c statement_timeout=...`. Escrever isso aqui daria a FALSA
 * impressão de um teto que não existe, que é pior que não ter teto nenhum.
 *
 * O teto real, então, é o do próprio Supavisor: 2 minutos por consulta. Com
 * `max: 3` isso significa que três consultas travadas deixam a API sem banco
 * por até 2 minutos - ruim, mas LIMITADO, e portanto não é o buraco sem fundo
 * que parecia. Baixar esse número exige `ALTER ROLE ... SET statement_timeout`
 * no banco (persistente, afeta todo mundo que usa o papel) - decisão de
 * operação, registrada em docs, não algo pra esconder numa opção de cliente.
 *
 * prepare: false porque o Supabase pode estar atrás do connection pooler
 * (pgbouncer em modo transaction), que não suporta prepared statements.
 */
const CONNECT_TIMEOUT_S = Number(process.env.DATABASE_CONNECT_TIMEOUT_S) || 15;

const client = postgres(connectionString, {
  ssl: 'require',
  prepare: false,
  max: poolMax,
  connect_timeout: CONNECT_TIMEOUT_S,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
