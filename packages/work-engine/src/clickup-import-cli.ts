import { importClickUp } from './clickup-import';

/**
 * Uso: DATABASE_URL=... tsx src/clickup-import-cli.ts --snapshot <dir> --org <uuid> --user <uuid> [--aplicar]
 * Sem --aplicar é ENSAIO: tudo roda numa transação que é desfeita no fim, e o relatório mostra o que entraria.
 * Só LÊ o snapshot em disco; não fala com o ClickUp.
 */
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const snapshot = arg('snapshot'); const org = arg('org'); const user = arg('user');
if (!snapshot || !org || !user) { console.error('Faltam --snapshot, --org e --user.'); process.exit(2); }
const aplicar = process.argv.includes('--aplicar');
const host = (process.env.DATABASE_URL ?? '').match(/@([^:/]+)/)?.[1] ?? '?';
console.log(`${aplicar ? 'APLICANDO' : 'ENSAIO'} em ${host} · org ${org}`);
importClickUp({ organizationId: org, userId: user, actorKind: 'system' }, { snapshotDir: snapshot, dryRun: !aplicar, semAtualizarTarefas: process.argv.includes('--sem-atualizar-tarefas') })
  .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error('FALHOU:', e instanceof Error ? e.message : e); process.exit(1); });
