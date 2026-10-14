#!/usr/bin/env node
/**
 * ambiente.mjs — roda um comando com o ambiente ISOLADO do Bento 3.1.
 *
 *   node apps/worker/scripts/isolado/ambiente.mjs -- <comando> [args...]
 *
 * A cerca: o `.env` do repositório aponta para o Supabase que tem os clientes
 * reais, e o `dotenv` de API/worker/database o carrega sozinho. Como o
 * `dotenv` NUNCA sobrescreve variável já definida, este lançador pega TODA
 * chave do `.env` e a define como vazia antes de aplicar só os valores
 * isolados. Esquecer uma variável aqui deixa ela vazia, nunca apontando para
 * produção.
 *
 * Os flags de comportamento do Bento (não são segredo) são copiados do `.env`
 * para o runtime isolado se comportar como o local de hoje.
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SIM = `http://127.0.0.1:${process.env.SIM_PORT ?? 4799}`;

export const ORG_A = '0a000000-0000-4000-8000-00000000000a';
export const ORG_B = '0b000000-0000-4000-8000-00000000000b';

/** Flags de comportamento copiados do `.env` (nunca credencial). */
const FLAGS_COPIADOS = [
  'BENTO_MULTI_ACTION_WRITE',
  'BENTO_OPENAI_CORE_ENABLED',
  'BENTO_OPENAI_READ_ENABLED',
  'AGENT_LOOP_BENTO_V2',
];

function lerDotEnv() {
  const valores = {};
  for (const linha of readFileSync(resolve(raiz, '.env'), 'utf8').split('\n')) {
    const m = linha.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) valores[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return valores;
}

export function ambienteIsolado(extra = {}) {
  const real = lerDotEnv();
  const env = { ...process.env };
  for (const chave of Object.keys(real)) env[chave] = '';
  for (const flag of FLAGS_COPIADOS) if (real[flag] !== undefined) env[flag] = real[flag];

  Object.assign(env, {
    NODE_ENV: 'development',
    BENTO_ISOLADO: '1',
    DATABASE_URL: 'postgresql://postgres:bento31@127.0.0.1:55433/bento31',
    REDIS_URL: 'redis://127.0.0.1:6391',
    SUPABASE_URL: SIM,
    PORT: '4791',
    API_PUBLIC_URL: 'http://127.0.0.1:4791',
    FRONTEND_URL: 'http://127.0.0.1:3791',
    NODE_SECRET: 'segredo-isolado-bento31',
    INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(64),
    PROVIDER_ORGANIZATION_ID: ORG_A,
    OPENAI_API_KEY: 'sk-simulado-bento31',
    OPENAI_BASE_URL: `${SIM}/v1`,
    CLICKUP_API_KEY: 'pk_simulado',
    CLICKUP_TEAM_ID: 'team-qa',
    CLICKUP_API_BASE_URL: `${SIM}/api/v2`,
    CLICKUP_TEST_LIST_ID: 'list-qa-alfa',
    BENTO_QA_URL: `${SIM}/bento-qa`,
    BENTO_QA_TOKEN: 'simulado',
    OTTO_MOTION_ENABLED: 'false',
    ...extra,
  });
  // ISOLADO_<CHAVE>=valor sobrescreve <CHAVE> (ex.: ISOLADO_AGENT_LOOP_BENTO_V2=false
  // roda o worker no caminho direto, sem o loop).
  for (const [chave, valor] of Object.entries(process.env)) {
    if (chave.startsWith('ISOLADO_')) env[chave.slice('ISOLADO_'.length)] = valor;
  }
  return env;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--');
  const [cmd, ...args] = i >= 0 ? process.argv.slice(i + 1) : [];
  if (!cmd) {
    console.error('uso: node ambiente.mjs -- <comando> [args...]');
    process.exit(2);
  }
  const filho = spawn(cmd, args, { env: ambienteIsolado(), stdio: 'inherit' });
  filho.on('exit', (code) => process.exit(code ?? 1));
}
