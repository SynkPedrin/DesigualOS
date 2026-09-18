/**
 * action-intent-bench.mts — mede o classificador contra o corpus versionado.
 *   pnpm --filter @desigual-os/worker exec tsx scripts/action-intent-bench.mts [--falhas]
 */
import { classifyActionIntent } from '../src/processors/action-intent.js';
import { buildOperationalActionPlan } from '../src/processors/operational-action-plan.js';
import { CORPUS_SETS, CORPUS_VERSION, type CorpusCase } from '../src/processors/action-intent-corpus.js';

const soFalhas = process.argv.includes('--falhas');
const detalhe = process.argv.includes('--detalhe');

function avaliar(c: CorpusCase) {
  const r = classifyActionIntent(c.message);
  const obtido = r.writeAuthorized ? 'ACT' : 'ANALYZE';
  const acoes = r.writeAuthorized ? buildOperationalActionPlan(c.message).tasks.length : 0;
  const intentOk = obtido === c.expected;
  const acoesOk = c.expectedActions === undefined || acoes === c.expectedActions;
  return { obtido, acoes, intentOk, acoesOk, ok: intentOk && acoesOk, kind: r.kind };
}

console.log(`corpus ${CORPUS_VERSION}\n`);
let totalOk = 0, total = 0, fpTotal = 0, fnTotal = 0;
for (const [nome, casos] of Object.entries(CORPUS_SETS)) {
  let ok = 0, fp = 0, fn = 0;
  const linhas: string[] = [];
  for (const c of casos) {
    const a = avaliar(c);
    if (a.ok) ok++;
    if (a.obtido === 'ACT' && c.expected === 'ANALYZE') fp++;
    if (a.obtido === 'ANALYZE' && c.expected === 'ACT') fn++;
    const marca = a.ok ? 'ok  ' : a.intentOk ? 'AÇÕES' : 'ERRO';
    const extra = c.expectedActions !== undefined ? ` [ações ${a.acoes}/${c.expectedActions}]` : '';
    if (!a.ok || detalhe) {
      linhas.push(`  ${marca} ${c.id} ${a.obtido.padEnd(7)} (esperado ${c.expected})${extra} :: ${c.message.replace(/\s+/g, ' ').slice(0, 62)}`);
    }
  }
  totalOk += ok; total += casos.length; fpTotal += fp; fnTotal += fn;
  console.log(`${nome.toUpperCase().padEnd(12)} ${ok}/${casos.length}   falso-positivo(escrita indevida)=${fp}  falso-negativo=${fn}`);
  if (!soFalhas || linhas.length > 0) linhas.forEach((l) => console.log(l));
}
console.log(`\nTOTAL ${totalOk}/${total} | FP=${fpTotal} | FN=${fnTotal}`);
process.exit(0);
