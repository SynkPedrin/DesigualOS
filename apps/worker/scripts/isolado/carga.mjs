/**
 * carga.mjs — teste de carga do Bento no ambiente isolado (Bento 3.1, P3).
 *
 *   node apps/worker/scripts/isolado/carga.mjs --vus 10 --duracao 60 [--rotulo x]
 *     [--llm-latencia 2500 --llm-jitter 1500 --llm-erro 0 --llm-timeout 0 --llm-fora 0]
 *
 * Exercita o runtime REAL (API, fila BullMQ, Redis, worker, orquestrador,
 * contexto, permissões, Postgres). Simulados: o GPT (latência calibrada pela
 * amostra real de 14/10: 1,6–18 s, mediana ~2,6 s) e o ClickUp.
 *
 * O QUE ESTE TESTE PROVA E O QUE NÃO PROVA: prova o comportamento do SISTEMA
 * sob concorrência (fila, latência de ponta a ponta, erro, isolamento entre
 * pessoas e empresas). NÃO prova que o provedor de GPT aguenta a mesma carga
 * — o limite de taxa da conta OpenAI não foi exercitado.
 *
 * Cada usuário virtual é uma das três pessoas das fixtures (duas empresas) e
 * repete: pergunta → espera a resposta → pausa de 1–3 s. Toda pergunta leva
 * uma referência única, e o prompt que chegou ao modelo é conferido: a
 * pessoa certa, e nada da outra empresa.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { turno, SIM } from './turno.mjs';

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const VUS = Number(arg('vus', 5));
const DURACAO_S = Number(arg('duracao', 60));
const ROTULO = arg('rotulo', `vus${VUS}`);
const llm = {
  llmLatencyMs: Number(arg('llm-latencia', 2500)),
  llmJitterMs: Number(arg('llm-jitter', 1500)),
  llmErrorRate: Number(arg('llm-erro', 0)),
  llmTimeoutRate: Number(arg('llm-timeout', 0)),
  llmTimeoutMs: 35_000,
  llmDown: arg('llm-fora', '0') === '1',
};
await fetch(`${SIM}/__config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(llm) });

const psql = (q) => execFileSync('docker', ['exec', 'bento31-pg', 'psql', '-U', 'postgres', '-d', 'bento31', '-tAc', q], { encoding: 'utf8' }).trim();
const PESSOAS = ['ana', 'bruno', 'carla'];
const NOME = { ana: 'Ana QA', bruno: 'Bruno QA', carla: 'Carla QA' };
const ORG = { ana: 'A', bruno: 'A', carla: 'B' };
// Marcadores que SÓ existem numa empresa. Achar um deles no prompt de alguém
// da outra empresa é vazamento.
const SO_DA_A = /Alfa - Carrossel|Gama - Vídeo|Campanha de Natal|Reunião de alinhamento Alfa|Ana QA|Bruno QA/;
const SO_DA_B = /Beta - Carrossel|Lançamento do condomínio|SEGREDO-DO-TENANT-B|Carla QA/;

const LEITURAS = [
  'Quais são minhas tarefas atrasadas?',
  'O que eu tenho para entregar esta semana?',
  'Quem está com mais tarefa atrasada?',
  'Tem alguma tarefa sem responsável?',
  'Me fala do que está pendente hoje',
];
function mensagemPara(quem, n) {
  const sorte = Math.random();
  const ref = `${ROTULO}-${quem}-${n}-${Math.random().toString(36).slice(2, 7)}`;
  if (sorte < 0.08) {
    // Escrita: só a Ana e o Bruno, só na lista de QA cercada (CLICKUP_TEST_LIST_ID).
    if (quem !== 'carla') return { tipo: 'escrita', ref, msg: `Bento, cria uma task "Carga ${ref}" na Alfa Cosméticos` };
  }
  if (sorte < 0.2) {
    const cliente = ORG[quem] === 'A' ? 'Alfa Cosméticos' : 'Beta Imóveis';
    return { tipo: 'panorama', ref, msg: `Como está a operação da ${cliente}? (ref ${ref})` };
  }
  return { tipo: 'leitura', ref, msg: `${LEITURAS[n % LEITURAS.length]} (ref ${ref})` };
}

const resultados = [];
const amostrasDeProcesso = [];
const fim = Date.now() + DURACAO_S * 1000;
const inicio = Date.now();

function pidsDe(padrao) {
  try {
    return execFileSync('pgrep', ['-f', padrao], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
function rssMb(padrao) {
  const pids = pidsDe(padrao);
  if (!pids.length) return 0;
  const out = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' });
  return Math.round(out.split('\n').filter(Boolean).reduce((s, l) => s + Number(l.trim()), 0) / 1024);
}
function filaDoBento() {
  try {
    const espera = Number(execFileSync('docker', ['exec', 'bento31-redis', 'redis-cli', 'LLEN', 'bull:queue-bento:wait'], { encoding: 'utf8' }).trim());
    const ativos = Number(execFileSync('docker', ['exec', 'bento31-redis', 'redis-cli', 'LLEN', 'bull:queue-bento:active'], { encoding: 'utf8' }).trim());
    return { espera, ativos };
  } catch {
    return { espera: -1, ativos: -1 };
  }
}
const amostrador = setInterval(() => {
  amostrasDeProcesso.push({ t: Date.now() - inicio, apiMb: rssMb('src/server.ts'), workerMb: rssMb('src/index.ts'), ...filaDoBento() });
}, 3000);

async function usuarioVirtual(i) {
  const quem = PESSOAS[i % PESSOAS.length];
  let n = 0;
  while (Date.now() < fim) {
    n += 1;
    const m = mensagemPara(quem, n);
    const t0 = Date.now();
    let r;
    try {
      r = await turno(quem, m.msg, { timeoutMs: 180_000, pollMs: 1000 });
    } catch (error) {
      r = { ok: false, fase: 'exceção', corpo: String(error).slice(0, 200), ms: Date.now() - t0 };
    }
    const prompt = (r.llm ?? []).filter((e) => e.chamada === 'leitura' && (e.input ?? '').includes(m.ref)).map((e) => e.input).join('\n');
    const resposta = (r.exec?.steps ?? []).map((s) => s.output?.answer ?? '').join('\n');
    const visto = `${prompt}\n${resposta}`;
    const vazou = ORG[quem] === 'A' ? SO_DA_B.test(visto) : SO_DA_A.test(visto);
    // Identidade só se exige do prompt da persona do Bento (o que tem bloco
    // CONTEXTO). O atalho de pergunta operacional responde sobre a EQUIPE e
    // não usa quem pergunta, de propósito.
    const promptsDaPersona = prompt.split('\n').length && prompt.includes('\nCONTEXTO:\n');
    const identidadeCerta = !promptsDaPersona || prompt.includes(`QUEM ESTÁ PERGUNTANDO: ${NOME[quem]}`);
    resultados.push({
      vu: i,
      quem,
      tipo: m.tipo,
      ok: r.ok === true && r.status === 'completed',
      status: r.status ?? r.fase ?? 'erro',
      httpStatus: r.status === undefined ? r.status : undefined,
      ms: r.ms,
      ackMs: r.ackMs,
      vazou,
      identidadeCerta,
      execucao: r.execucao,
    });
    await new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000));
  }
}

await Promise.all(Array.from({ length: VUS }, (_, i) => usuarioVirtual(i)));
clearInterval(amostrador);

// Do banco: espera na fila e execução de cada turno desta rodada.
const ids = resultados.map((r) => r.execucao).filter(Boolean);
const doBanco = ids.length
  ? psql(
      `select coalesce(json_agg(json_build_object('fila', extract(epoch from (started_at - created_at))*1000, 'exec', extract(epoch from (completed_at - started_at))*1000, 'status', status)), '[]') from executions where execution_id in (${ids.map((i) => `'${i}'`).join(',')})`,
    )
  : '[]';
const porExecucao = JSON.parse(doBanco || '[]');

const pct = (xs, p) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return Math.round(v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))]);
};
const okMs = resultados.filter((r) => r.ok).map((r) => r.ms);
const filaMs = porExecucao.map((e) => e.fila);
const execMs = porExecucao.map((e) => e.exec);
const porStatus = resultados.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
const relatorio = {
  rotulo: ROTULO,
  vus: VUS,
  duracaoS: DURACAO_S,
  llm,
  turnos: resultados.length,
  vazaoTurnosPorMin: Math.round((resultados.length / ((Date.now() - inicio) / 60000)) * 10) / 10,
  sucesso: resultados.filter((r) => r.ok).length,
  taxaDeErro: Math.round((1 - resultados.filter((r) => r.ok).length / Math.max(1, resultados.length)) * 1000) / 10,
  porStatus,
  ponta_a_ponta_ms: { p50: pct(okMs, 50), p95: pct(okMs, 95), p99: pct(okMs, 99), max: pct(okMs, 100) },
  ack_ms: { p50: pct(resultados.map((r) => r.ackMs), 50), p95: pct(resultados.map((r) => r.ackMs), 95) },
  espera_na_fila_ms: { p50: pct(filaMs, 50), p95: pct(filaMs, 95), max: pct(filaMs, 100) },
  execucao_ms: { p50: pct(execMs, 50), p95: pct(execMs, 95) },
  vazamentos: resultados.filter((r) => r.vazou).length,
  identidadeErrada: resultados.filter((r) => !r.identidadeCerta).length,
  filaMaxima: Math.max(0, ...amostrasDeProcesso.map((a) => a.espera)),
  memoriaMb: {
    apiInicio: amostrasDeProcesso[0]?.apiMb,
    apiFim: amostrasDeProcesso.at(-1)?.apiMb,
    workerInicio: amostrasDeProcesso[0]?.workerMb,
    workerFim: amostrasDeProcesso.at(-1)?.workerMb,
    workerMax: Math.max(0, ...amostrasDeProcesso.map((a) => a.workerMb)),
  },
};
console.log(JSON.stringify(relatorio, null, 2));
if (process.env.CARGA_SAIDA) writeFileSync(process.env.CARGA_SAIDA, JSON.stringify({ relatorio, resultados, amostrasDeProcesso }, null, 2));
// Volta o GPT simulado ao padrão para o próximo teste.
await fetch(`${SIM}/__config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ llmLatencyMs: 900, llmJitterMs: 400, llmErrorRate: 0, llmTimeoutRate: 0, llmDown: false }) });
process.exit(0);
