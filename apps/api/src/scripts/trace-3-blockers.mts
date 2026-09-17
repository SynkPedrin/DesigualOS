/**
 * trace-3-blockers.mts — localizar os três defeitos ANTES de tocar em código.
 *
 * SOMENTE LEITURA. Não despacha turno, não grava episódio, não ensina nada.
 * O trace anterior desta série gravou um fato em produção e inverteu a verdade
 * corrente de um cliente; um diagnóstico que altera o sistema que investiga não
 * é diagnóstico.
 *
 *   pnpm --filter @desigual-os/api exec tsx src/scripts/trace-3-blockers.mts
 */
import '../env.js';
import { db, schema } from '@desigual-os/database';
import { eq } from 'drizzle-orm';
import { formatOperationalContextForPrompt, resolveOperationalTurn } from '../lib/operational-context.js';
import { resolveOperationalScope } from '@desigual-os/context-engine';

const ELITE = '21b90202-1cfa-4aa1-93d6-53bac5dcfa72';
const COSENTINO = '44be15e0-b8bd-4f44-916d-eedc5a84a0d5';

const [usuario] = await db
  .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
  .from(schema.users)
  .where(eq(schema.users.email, 'pedro@institutoalmada.org'))
  .limit(1);

// BLOCKER 1 é traçado do lado do worker (apps/worker/scripts/_trace_falta.mts):
// o bloco de cliente vive lá e importar entre apps quebraria o rootDir.

console.log('\n========== BLOCKER 2 — escopo da métrica operacional ==========\n');
const turnoCliente = await resolveOperationalTurn('E a Cosentino?', usuario as never);
const blocoCliente = turnoCliente.briefingBlock ?? formatOperationalContextForPrompt(turnoCliente.context);
console.log(`"E a Cosentino?" -> escopo ${turnoCliente.scope.kind}`);
if (blocoCliente) {
  const cabecalho = blocoCliente.split('\n').slice(0, 6);
  console.log('primeiras linhas do bloco entregue ao modelo:');
  for (const l of cabecalho) console.log(`  ${l}`);
  const totaisGlobais = blocoCliente.match(/(\d+)\s+tarefa\(s\)\s+aberta\(s\)[^\n]*/g) ?? [];
  console.log(`linhas de TOTAL no bloco: ${JSON.stringify(totaisGlobais.slice(0, 3))}`);
  console.log(
    `o bloco DIZ que o total é global? ${/em \d+ cliente\(s\)/.test(blocoCliente) ? 'sim (cita nº de clientes)' : 'NÃO'}`,
  );
}

const turnoGlobal = await resolveOperationalTurn('Bento, me atualiza aí.', usuario as never);
const blocoGlobal = turnoGlobal.briefingBlock ?? formatOperationalContextForPrompt(turnoGlobal.context);
console.log(`\n"me atualiza" -> escopo ${turnoGlobal.scope.kind}, bloco ${blocoGlobal?.length ?? 0} chars`);
console.log(
  `MESMO cabeçalho nos dois? ${
    blocoGlobal && blocoCliente && blocoGlobal.split('\n')[1] === blocoCliente.split('\n')[1] ? 'SIM' : 'não'
  }`,
);

console.log('\n========== BLOCKER 3 — follow-up operacional curto ==========\n');
// Encadeado, como numa conversa: cada turno recebe o estado do anterior.
let anterior: { kind: never; operational: boolean } | null = null;
for (const frase of [
  'Bento, me atualiza aí.',
  'O que tá pegando mais?',
  'Se eu só conseguir resolver três coisas, o que eu faço?',
  'E a Tammy?',
  'E a Cosentino?',
  'Me dá um resumo pra reunião.',
  'De onde você tirou esses números?',
]) {
  const t = await resolveOperationalTurn(frase, usuario as never, new Date(), anterior);
  const b = t.briefingBlock ?? formatOperationalContextForPrompt(t.context);
  console.log(
    `${String(t.scope.kind).padEnd(13)} operacional=${String(t.scope.operational).padEnd(5)} bloco=${
      b ? String(b.length).padStart(6) + ' chars' : '   NENHUM'
    }  | ${frase}`,
  );
  anterior = { kind: t.scope.kind as never, operational: t.scope.operational };
}

void resolveOperationalScope;
void COSENTINO;
process.exit(0);
