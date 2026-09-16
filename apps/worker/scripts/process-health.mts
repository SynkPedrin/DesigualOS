/**
 * process-health.mts — invariante de processo, porque o incidente repetiu.
 *
 * Três vezes neste release apareceu um worker ÓRFÃO (ppid 1) consumindo a fila
 * com código antigo. O sintoma é cruel: o sistema responde, os testes passam
 * às vezes, e o comportamento velho volta de forma intermitente sem que nada
 * indique a causa. Foi assim que uma captura de memória "não funcionou" e que
 * uma correção de escopo "não pegou".
 *
 * O que torna isso detectável é simples: contar consumidores e comparar SHA.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/process-health.mts
 */
import '../src/env.js';
import { execSync } from 'node:child_process';

interface Processo { pid: number; ppid: number; entrada: string }

function processosDoProjeto(): Processo[] {
  const saida = execSync('ps -eo pid,ppid,command', { encoding: 'utf8' });
  const linhas = saida.split('\n').slice(1);
  const out: Processo[] = [];
  for (const l of linhas) {
    if (!/DesigualOS/.test(l)) continue;
    if (/esbuild|--ping|ps -eo|grep/.test(l)) continue;
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (!m) continue;
    const cmd = m[3]!;
    // Só o PROCESSO FILHO real conta: o `tsx watch` é supervisor, não consumidor.
    if (/tsx\/dist\/cli\.mjs watch/.test(cmd)) continue;
    if (/src\/index\.ts/.test(cmd)) out.push({ pid: Number(m[1]), ppid: Number(m[2]), entrada: 'worker' });
    else if (/src\/server\.ts/.test(cmd)) out.push({ pid: Number(m[1]), ppid: Number(m[2]), entrada: 'api' });
  }
  return out;
}

const procs = processosDoProjeto();
const workers = procs.filter((p) => p.entrada === 'worker');
const apis = procs.filter((p) => p.entrada === 'api');
const orfaos = procs.filter((p) => p.ppid === 1);

let falhas = 0;
const checa = (n: string, ok: boolean, d = '') => { console.log(ok ? `PASS  ${n}` : `FALHA ${n} ${d}`); if (!ok) falhas++; };

checa('exatamente_um_worker_consumidor', workers.length === 1, `encontrados=${workers.length} (pids ${workers.map((w) => w.pid).join(',')})`);
checa('exatamente_uma_api', apis.length === 1, `encontradas=${apis.length}`);
checa('nenhum_processo_orfao', orfaos.length === 0, `órfãos=${orfaos.map((o) => `${o.entrada}:${o.pid}`).join(',')}`);

// SHA do node remoto contra o HEAD local.
const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const saude = await fetch('http://100.70.73.74:4002/health', { signal: AbortSignal.timeout(10_000) })
  .then((r) => r.json() as Promise<{ release_sha?: string; status?: string; model?: string }>)
  .catch(() => null);
checa('otto_node_responde', saude?.status === 'ok', JSON.stringify(saude ?? null));
checa('otto_node_no_sha_do_head', saude?.release_sha === head, `node=${saude?.release_sha} head=${head}`);

console.log(`\nHEAD: ${head} | worker: ${workers.length} | api: ${apis.length} | órfãos: ${orfaos.length} | otto: ${saude?.release_sha ?? '?'} (${saude?.model ?? '?'})`);
console.log(falhas === 0 ? 'PROCESSO: OK' : `PROCESSO: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
