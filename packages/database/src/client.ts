import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from './env';
import { sslDoDestino } from './ssl';
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

/**
 * Contador de consultas por requisição (API registra no fim de cada uma). Com
 * o banco em us-east-1 e a API no Brasil, cada consulta custa ~125 ms (medido
 * em 19/10/2026): o NÚMERO de consultas de uma rota é o que decide a
 * velocidade dela, e é isto que mostra onde cortar.
 */
export const queryStats = new AsyncLocalStorage<{ count: number }>();

const client = postgres(connectionString, {
  ssl: sslDoDestino(connectionString),
  prepare: false,
  max: poolMax,
  connect_timeout: CONNECT_TIMEOUT_S,
  // Abrir conexão até us-east-1 custa ~1,3 s (TLS + autenticação no pooler,
  // medido em 19/10/2026) e uma aberta responde em 125 ms sem cair parada. O
  // padrão da biblioteca renova cada conexão a cada 30–60 min, e quem caía
  // nessa troca pagava 1,3 s; 6 h deixa isso raro.
  max_lifetime: 6 * 60 * 60,
  debug: () => {
    const stats = queryStats.getStore();
    if (stats) stats.count += 1;
  },
});

export const db = drizzle(client, { schema });

/**
 * Abre o pool inteiro de uma vez, em paralelo, na subida do processo. Sem isto
 * as primeiras requisições depois de um deploy pagavam ~1,3 s cada abrindo
 * conexão. Falha aqui não derruba nada: a conexão abre sob demanda como antes.
 */
export async function warmDatabasePool(): Promise<number> {
  const started = Date.now();
  await Promise.all(Array.from({ length: poolMax }, () => client`select 1`.catch(() => undefined)));
  return Date.now() - started;
}

export type Database = typeof db;
