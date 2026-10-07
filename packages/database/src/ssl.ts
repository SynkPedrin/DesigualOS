/**
 * SSL é obrigatório contra Supabase e impossível contra um Postgres local.
 *
 * Com `ssl: 'require'` fixo em client.ts/migrate.ts/seed.ts, nada neste
 * repositório conseguia apontar pra outro banco que não produção — ou seja, a
 * regra "valide numa cópia/staging antes de migrar o banco real" era
 * literalmente inexecutável (07/10/2026, cutover). Derivar do destino mantém
 * produção exatamente como era (host remoto continua `require`) e destrava
 * cópia restaurada, staging e Postgres local na VPS.
 *
 * O padrão em caso de dúvida é `require`: uma string que não parseia é tratada
 * como remota, nunca como local. Errar pra "exige TLS" custa uma conexão
 * recusada; errar pro outro lado manda credencial de produção em texto claro.
 */
export function sslDoDestino(connectionString: string): 'require' | false {
  let host: string;
  try {
    const url = new URL(connectionString);
    if (url.searchParams.get('sslmode') === 'disable') return false;
    host = url.hostname;
  } catch {
    return 'require';
  }
  const ehLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === 'host.docker.internal';
  return ehLocal ? false : 'require';
}
