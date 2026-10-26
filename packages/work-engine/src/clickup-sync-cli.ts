import { readFileSync } from 'node:fs';
import { sincronizarDoClickUp, type ItemDoClickUp } from './clickup-sync';

/**
 * Uso: DATABASE_URL=... tsx src/clickup-sync-cli.ts --arquivo <clickup.json> --org <uuid> --user <uuid> [--aplicar] [--desde <ISO>]
 * Sem --aplicar é ENSAIO (não grava nada). O arquivo é a lista de tarefas lida do ClickUp: [{id,status,type,closed,updated,due}].
 */
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const arquivo = arg('arquivo'); const org = arg('org'); const user = arg('user');
if (!arquivo || !org || !user) { console.error('Faltam --arquivo, --org e --user.'); process.exit(2); }
const aplicar = process.argv.includes('--aplicar'); const desde = arg('desde');
console.log(`${aplicar ? 'APLICANDO' : 'ENSAIO'} em ${(process.env.DATABASE_URL ?? '').match(/@([^:/]+)/)?.[1] ?? '?'} · org ${org}`);
const itens = JSON.parse(readFileSync(arquivo, 'utf8')) as ItemDoClickUp[];
sincronizarDoClickUp({ organizationId: org, userId: user, actorKind: 'system' }, itens, { dryRun: !aplicar, ...(desde ? { desde: new Date(desde) } : {}) })
  .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error('FALHOU:', e instanceof Error ? e.message : e); process.exit(1); });
