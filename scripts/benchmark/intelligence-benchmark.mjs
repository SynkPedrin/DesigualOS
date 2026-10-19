/**
 * DESIGUAL INTELLIGENCE BENCHMARK — mede o que o Desigual OS SABE sobre a agência.
 *
 * Não é QA de escrita (isso é a bateria forense). É o benchmark de INTELIGÊNCIA:
 * cada pergunta tem um golden set de fatos que a resposta deveria conter, e a
 * nota é cobertura factual + ausência de alucinação, nunca string match cego.
 *
 * Só perguntas de LEITURA. Nenhum turno deste arquivo pode criar ou alterar
 * nada no ClickUp — se um dia um turno aqui escrever, é bug, não é o teste.
 *
 *   node scripts/benchmark/intelligence-benchmark.mjs            # todas
 *   node scripts/benchmark/intelligence-benchmark.mjs GOLD Q05   # só algumas
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3001';
const TOKEN_FILE = '/tmp/desigual-qa-token';
const OUT_DIR = new URL('../../artifacts/intelligence-benchmark/', import.meta.url);

/**
 * `esperado` é o GOLDEN SET: fatos que uma resposta boa contém. Servem para
 * medir COBERTURA, e a conferência final é humana ou por juiz LLM — a presença
 * do termo é indício, não prova.
 */
export const PERGUNTAS = [
  { id: 'Q01', q: 'Me explique tudo que você sabe sobre a Agência Desigual.', dim: 'identidade', esperado: ['clientes', 'equipe', 'projetos internos', 'estrutura'] },
  { id: 'Q02', q: 'Quem trabalha aqui e qual é a função de cada pessoa?', dim: 'pessoas', esperado: ['Tammy', 'Endrigo', 'Pedro Gabriel', 'função'] },
  { id: 'Q03', q: 'Quais clientes precisam de atenção hoje?', dim: 'prioridade', esperado: ['cliente', 'prazo'] },
  { id: 'Q04', q: 'Quais são os maiores riscos operacionais neste momento?', dim: 'riscos', esperado: ['atraso', 'sem responsável'] },
  { id: 'Q05', q: 'O que mudou na agência nos últimos 7 dias?', dim: 'temporal', esperado: ['mudança', 'task'] },
  { id: 'Q06', q: 'Quais clientes estão com entregas atrasadas?', dim: 'atrasos', esperado: ['atrasad'] },
  { id: 'Q07', q: 'Quais projetos internos parecem abandonados?', dim: 'projetos internos', esperado: ['Desigual OS', 'Citável'] },
  { id: 'Q08', q: 'Quem está sobrecarregado?', dim: 'pessoas', esperado: ['tarefas', 'responsável'] },
  { id: 'Q09', q: 'Quais tarefas dependem do Endrigo?', dim: 'relações', esperado: ['Endrigo'] },
  { id: 'Q10', q: 'Quais clientes entraram recentemente?', dim: 'pipeline', esperado: ['recente'] },
  { id: 'Q11', q: 'Quais clientes saíram recentemente?', dim: 'churn', esperado: ['encerrad'] },
  { id: 'Q12', q: 'O que pode dar problema esta semana?', dim: 'riscos', esperado: ['prazo'] },
  { id: 'Q13', q: 'Qual é o estado atual do Desigual OS?', dim: 'projetos internos', esperado: ['Desigual OS'] },
  { id: 'Q14', q: 'Qual é o estado do Citável?', dim: 'projetos internos', esperado: ['Citável'] },
  { id: 'Q15', q: 'O que a agência deveria priorizar hoje?', dim: 'prioridade', esperado: ['prioridade'] },
  { id: 'Q16', q: 'O que aconteceu ontem?', dim: 'temporal', esperado: ['ontem'] },
  { id: 'Q17', q: 'Quais ações os agentes realizaram recentemente?', dim: 'agent awareness', esperado: ['Bento', 'Otto'] },
  { id: 'Q18', q: 'Quais informações estão inconsistentes no ClickUp?', dim: 'qualidade de dado', esperado: ['duplicad', 'sem responsável'] },
  { id: 'Q19', q: 'O que está parado há mais tempo?', dim: 'estagnação', esperado: ['parad'] },
  { id: 'Q20', q: 'Faça um briefing executivo completo da agência.', dim: 'briefing', esperado: ['clientes', 'riscos', 'prioridade'] },
  { id: 'GOLD', q: 'Analise todo o ClickUp da agência e me entregue um briefing completo de tudo que você sabe sobre a agência.', dim: 'golden benchmark', esperado: ['equipe', 'clientes', 'projetos internos', 'atrasos', 'riscos', 'espaços'] },
  // §23 — a vantagem que uma IA externa NÃO deveria conseguir replicar.
  { id: 'V01', q: 'O que mudou na agência desde ontem?', dim: 'vantagem/temporal', esperado: ['mudou'] },
  { id: 'V02', q: 'O que o Bento fez hoje?', dim: 'vantagem/auto-consciência', esperado: ['Bento'] },
  { id: 'V03', q: 'Quais problemas estão aparecendo repetidamente?', dim: 'vantagem/padrão', esperado: ['recorrente'] },
  { id: 'V04', q: 'Quais clientes estão deteriorando operacionalmente?', dim: 'vantagem/tendência', esperado: ['piorou'] },
];

function token() { return readFileSync(TOKEN_FILE, 'utf8').trim(); }
function headers() { return { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }; }

async function preflight() {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('API fora do ar');
  const probe = await fetch(`${BASE}/conversations?limit=1`, { headers: headers(), signal: AbortSignal.timeout(10000) });
  if (probe.status === 401) {
    execFileSync('node', [new URL('../qa/login.mjs', import.meta.url).pathname], { stdio: 'pipe' });
  }
}

async function postChat(message) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ message, agent_hint: 'BENTO' }),
    signal: AbortSignal.timeout(60000),
  });
  return { httpStatus: res.status, body: await res.json().catch(() => ({})) };
}

async function pollExecution(executionId, budgetMs = 240000) {
  const start = Date.now();
  let execution = null;
  while (Date.now() - start < budgetMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/executions/${executionId}`, { headers: headers(), signal: AbortSignal.timeout(10000) });
    if (!res.ok) continue;
    execution = await res.json();
    if (['completed', 'failed', 'cancelled'].includes(execution.status)) break;
  }
  return execution;
}

/**
 * A execução é marcada `completed` ANTES do passo que carrega a resposta estar
 * visível na leitura. Enquanto o turno levava 49s a corrida não aparecia; com a
 * correção de latência de 29/09/2026 (24s -> 2s) ela passou a acontecer sempre,
 * e a bateria começou a relatar "0ch, cobertura 0/2" em turnos que responderam
 * certo — conferido na mão: a resposta estava lá, em steps[0].output.answer.
 *
 * Medidor que relata falha falsa é pior que medidor nenhum: manda todo mundo
 * caçar regressão que não existe. Daí a releitura.
 */
async function answerWithRetry(executionId, primeira) {
  const daPrimeira = answerOf(primeira);
  if (daPrimeira.trim().length > 0) return daPrimeira;
  for (const espera of [1500, 3000, 5000]) {
    await new Promise((r) => setTimeout(r, espera));
    const res = await fetch(`${BASE}/executions/${executionId}`, { headers: headers(), signal: AbortSignal.timeout(10000) });
    if (!res.ok) continue;
    const texto = answerOf(await res.json());
    if (texto.trim().length > 0) return texto;
  }
  return '';
}

function answerOf(execution) {
  const steps = execution?.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const o = steps[i]?.output;
    const t = typeof o === 'string' ? o : (o?.answer ?? o?.response ?? o?.message ?? o?.content ?? o?.text);
    if (typeof t === 'string' && t.trim().length > 0) return t;
  }
  return execution?.result?.response ?? execution?.result?.message ?? '';
}

const filtro = process.argv.slice(2);
const casos = filtro.length ? PERGUNTAS.filter((p) => filtro.includes(p.id)) : PERGUNTAS;

mkdirSync(OUT_DIR, { recursive: true });
await preflight();

const resultados = [];
for (const caso of casos) {
  const t0 = Date.now();
  let registro = { ...caso, erro: null, latenciaMs: 0, resposta: '', chars: 0, cobertura: [], faltando: [] };
  try {
    const { httpStatus, body } = await postChat(caso.q);
    const execId = body.execution_id ?? body.executionId;
    if (!execId) throw new Error(`sem execution_id (HTTP ${httpStatus}): ${JSON.stringify(body).slice(0, 200)}`);
    const execution = await pollExecution(execId);
    registro.status = execution?.status ?? 'timeout';
    registro.resposta = await answerWithRetry(execId, execution);
    registro.executionId = execId;
  } catch (e) {
    registro.erro = e.message;
  }
  registro.latenciaMs = Date.now() - t0;
  registro.chars = registro.resposta.length;
  const plano = registro.resposta.toLowerCase();
  registro.cobertura = caso.esperado.filter((t) => plano.includes(t.toLowerCase()));
  registro.faltando = caso.esperado.filter((t) => !plano.includes(t.toLowerCase()));
  resultados.push(registro);
  console.log(
    `${caso.id.padEnd(5)} ${String(registro.status ?? 'ERRO').padEnd(10)} ${String(Math.round(registro.latenciaMs / 1000) + 's').padStart(5)} ` +
    `${String(registro.chars).padStart(6)}ch  cobertura ${registro.cobertura.length}/${caso.esperado.length}` +
    (registro.erro ? `  ERRO: ${registro.erro}` : ''),
  );
  writeFileSync(new URL(`${caso.id}.json`, OUT_DIR), JSON.stringify(registro, null, 2));
}

const total = resultados.reduce((s, r) => s + r.cobertura.length, 0);
const alvo = resultados.reduce((s, r) => s + r.esperado.length, 0);
console.log(`\nCOBERTURA FACTUAL AGREGADA: ${total}/${alvo} (${Math.round((total / alvo) * 100)}%)`);
writeFileSync(new URL('SUMMARY.json', OUT_DIR), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
