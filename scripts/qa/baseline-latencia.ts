/**
 * Linha de base de latência (Onda 0, item 0.2).
 *
 * Lê a tabela `executions` (createdAt, startedAt, completedAt) e imprime
 * p50/p95 por agente: espera em fila, tempo de execução e total. Grava o
 * resultado em artifacts/baseline-latencia-<data>.json. É contra este número
 * que a Onda 3 será julgada.
 *
 * Limitação conhecida (registrada na auditoria e no relatório da onda): as
 * métricas de fase do Otto (classify_ms, retrieval_ms, llm_ms) são emitidas
 * pelo otto-node na metadata da resposta, mas o worker NÃO as persiste em
 * execution_steps (grava só answer/sources/error, execute-job.ts:908). Por
 * isso este baseline mede tempos de parede por execução, não fases internas.
 *
 * Uso: pnpm --filter @desigual-os/api exec tsx ../../scripts/qa/baseline-latencia.ts [dias]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.loadEnvFile(resolve(REPO, '.env'));

// Resolve o driver postgres a partir do node_modules de packages/database,
// porque scripts/ não é um pacote do workspace.
const requireFromDb = createRequire(resolve(REPO, 'packages/database/src/client.ts'));
const postgres = requireFromDb('postgres') as typeof import('postgres').default;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('BLOQUEADO: DATABASE_URL ausente no .env. Sem ela não há baseline.');
  process.exit(1);
}

const DIAS = Number(process.argv[2] ?? 30);

interface Linha {
  agent: string;
  status: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[idx];
}

const sql = postgres(DATABASE_URL, { ssl: 'require', prepare: false, max: 1 });

const linhas = await sql<Linha[]>`
  select agent, status, created_at, started_at, completed_at
  from executions
  where created_at > now() - make_interval(days => ${DIAS})
  order by created_at desc
`;
await sql.end();

if (linhas.length === 0) {
  console.error(`BLOQUEADO: nenhuma execução nos últimos ${DIAS} dias. Baseline vazio não é baseline.`);
  process.exit(1);
}

interface Stats {
  execucoes: number;
  concluidas: number;
  falhas: number;
  fila_ms: { p50: number | null; p95: number | null };
  execucao_ms: { p50: number | null; p95: number | null };
  total_ms: { p50: number | null; p95: number | null };
}

const porAgente: Record<string, Stats> = {};
for (const l of linhas) {
  const s = (porAgente[l.agent] ??= {
    execucoes: 0, concluidas: 0, falhas: 0,
    fila_ms: { p50: null, p95: null },
    execucao_ms: { p50: null, p95: null },
    total_ms: { p50: null, p95: null },
  });
  s.execucoes++;
  if (l.status === 'completed') s.concluidas++;
  if (l.status === 'failed') s.falhas++;
}

const filas: Record<string, number[]> = {};
const runs: Record<string, number[]> = {};
const totais: Record<string, number[]> = {};
for (const l of linhas) {
  const criado = new Date(l.created_at).getTime();
  if (l.started_at) (filas[l.agent] ??= []).push(new Date(l.started_at).getTime() - criado);
  if (l.started_at && l.completed_at) {
    (runs[l.agent] ??= []).push(new Date(l.completed_at).getTime() - new Date(l.started_at).getTime());
  }
  if (l.completed_at) (totais[l.agent] ??= []).push(new Date(l.completed_at).getTime() - criado);
}
for (const agente of Object.keys(porAgente)) {
  const s = porAgente[agente];
  s.fila_ms = { p50: percentil(filas[agente] ?? [], 50), p95: percentil(filas[agente] ?? [], 95) };
  s.execucao_ms = { p50: percentil(runs[agente] ?? [], 50), p95: percentil(runs[agente] ?? [], 95) };
  s.total_ms = { p50: percentil(totais[agente] ?? [], 50), p95: percentil(totais[agente] ?? [], 95) };
}

const hoje = new Date().toISOString().slice(0, 10);
const resultado = {
  gerado_em: new Date().toISOString(),
  janela_dias: DIAS,
  total_execucoes: linhas.length,
  por_agente: porAgente,
  limitacao: 'classify_ms/retrieval_ms/llm_ms do Otto não são persistidos pelo worker (execute-job.ts:908 grava só answer/sources/error); baseline mede tempos de parede.',
};

const dir = resolve(REPO, 'artifacts');
mkdirSync(dir, { recursive: true });
const arquivo = resolve(dir, `baseline-latencia-${hoje}.json`);
writeFileSync(arquivo, JSON.stringify(resultado, null, 2));

console.log(`Baseline de latência (${DIAS} dias, ${linhas.length} execuções)`);
for (const [agente, s] of Object.entries(porAgente)) {
  console.log(
    `  ${agente.padEnd(7)} n=${String(s.execucoes).padStart(4)} ok=${s.concluidas} fail=${s.falhas}` +
    ` | fila p50=${s.fila_ms.p50}ms p95=${s.fila_ms.p95}ms` +
    ` | exec p50=${s.execucao_ms.p50}ms p95=${s.execucao_ms.p95}ms` +
    ` | total p50=${s.total_ms.p50}ms p95=${s.total_ms.p95}ms`,
  );
}
console.log(`Gravado em ${arquivo}`);
