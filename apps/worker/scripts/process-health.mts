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

interface Processo { pid: number; ppid: number; entrada: string; cwd: string }

/**
 * Discriminar por DIRETÓRIO, não pelo nome do arquivo de entrada. `src/index.ts`
 * é a entrada do worker, do studio-node e do otto-node ao mesmo tempo: contar por
 * nome fazia o Studio ser reportado como "worker duplicado" — um alarme falso que
 * custa exatamente a confiança que este script existe pra dar.
 */
function diretorioDe(pid: number): string {
  try {
    const saida = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, { encoding: 'utf8' });
    const linha = saida.split('\n').find((l) => l.startsWith('n'));
    return linha ? linha.slice(1) : '';
  } catch { return ''; }
}

function processosDoProjeto(): Processo[] {
  const saida = execSync('ps -ww -eo pid,ppid,command', { encoding: 'utf8' });
  const linhas = saida.split('\n').slice(1);
  const out: Processo[] = [];
  for (const l of linhas) {
    if (!/DesigualOS/.test(l)) continue;
    if (/esbuild|--ping|ps -eo|grep/.test(l)) continue;
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (!m) continue;
    const cmd = m[3]!;
    /**
     * O `tsx` sempre roda em dois processos: o CLI (`tsx/dist/cli.mjs`), que é
     * supervisor, e o filho com `preflight.cjs`, que é quem de fato consome a
     * fila. Contar os dois dobrava o número de consumidores e acusava
     * duplicação onde havia uma instância só.
     */
    if (!/preflight\.cjs/.test(cmd)) continue;
    if (!/src\/(index|server)\.ts/.test(cmd)) continue;
    const pid = Number(m[1]);
    const cwd = diretorioDe(pid);
    let entrada = '';
    if (cwd.endsWith('/apps/worker')) entrada = 'worker';
    else if (cwd.endsWith('/apps/api')) entrada = 'api';
    else if (cwd.endsWith('/nodes/studio-node')) entrada = 'studio';
    else if (cwd.endsWith('/nodes/otto-node')) entrada = 'otto';
    else continue;
    out.push({ pid, ppid: Number(m[2]), entrada, cwd });
  }
  return out;
}

/**
 * Supervisão, não parentesco. Sob launchd o serviço é filho do PID que o
 * launchd reporta pro label — e esse supervisor tem ppid 1. A regra antiga
 * ("ppid 1 é órfão") por isso reprovava justamente a topologia correta.
 *
 * O que interessa é o inverso: existe alguém que reinicia isto se cair?
 * Um worker solto por `pnpm dev` não tem — foi assim que o worker passou
 * tempo fora do ar depois de um SIGTERM, sem nada pra trazê-lo de volta.
 */
function pidDoLaunchd(label: string): number | null {
  try {
    const saida = execSync(`launchctl list ${label} 2>/dev/null`, { encoding: 'utf8' });
    const m = /"PID"\s*=\s*(\d+)/.exec(saida);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

const procs = processosDoProjeto();
const workers = procs.filter((p) => p.entrada === 'worker');
const apis = procs.filter((p) => p.entrada === 'api');
const supervisores = new Map<string, number | null>([
  ['worker', pidDoLaunchd('com.desigualos.worker')],
  ['api', pidDoLaunchd('com.desigualos.api')],
]);
const naoSupervisionados = procs.filter((p) => {
  const sup = supervisores.get(p.entrada);
  if (sup === undefined) return false; // studio/otto têm supervisão própria
  return sup === null || p.ppid !== sup;
});

let falhas = 0;
const checa = (n: string, ok: boolean, d = '') => { console.log(ok ? `PASS  ${n}` : `FALHA ${n} ${d}`); if (!ok) falhas++; };

checa('exatamente_um_worker_consumidor', workers.length === 1, `encontrados=${workers.length} (pids ${workers.map((w) => w.pid).join(',')})`);
checa('exatamente_uma_api', apis.length === 1, `encontradas=${apis.length}`);
checa('servicos_sob_supervisao', naoSupervisionados.length === 0, `sem supervisor=${naoSupervisionados.map((o) => `${o.entrada}:${o.pid}`).join(',')}`);

// SHA do node remoto contra o HEAD local.
const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const saude = await fetch('http://100.70.73.74:4002/health', { signal: AbortSignal.timeout(10_000) })
  .then((r) => r.json() as Promise<{ release_sha?: string; status?: string; model?: string }>)
  .catch(() => null);
checa('otto_node_responde', saude?.status === 'ok', JSON.stringify(saude ?? null));
checa('otto_node_no_sha_do_head', saude?.release_sha === head, `node=${saude?.release_sha} head=${head}`);

console.log(`\nHEAD: ${head} | worker: ${workers.length} | api: ${apis.length} | sem supervisor: ${naoSupervisionados.length} | otto: ${saude?.release_sha ?? '?'} (${saude?.model ?? '?'})`);
console.log(falhas === 0 ? 'PROCESSO: OK' : `PROCESSO: ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
