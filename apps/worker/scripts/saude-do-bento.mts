/**
 * saude-do-bento.mts — quando ele deixa de ser útil, alguém fica sabendo?
 *
 * A pergunta que motivou isto (29/09/2026): "ele consegue permanecer útil
 * quando uma pessoa real usa livremente, sem o desenvolvedor acompanhando cada
 * turno?"
 *
 * A parte difícil não é o turno ruim. É que hoje o turno ruim SOME. O sistema
 * sabe muito bem quando falhou: grava `errorCode` na metadata do step em toda
 * recusa honesta, marca a execução como `failed`, registra o motivo. E nada
 * disso é lido de volta — um grep por `errorCode` fora dos testes acha UM
 * chamador, um card de motion no front. Então descobrir que o Bento passou a
 * tarde respondendo "não consegui" depende de alguém ler todo turno, que é
 * exatamente o que não vai acontecer.
 *
 * Isto é o leitor que faltava. Não é dashboard, é o mínimo honesto: em 30
 * segundos, o que deu errado, quantas vezes, e em quê.
 *
 * O que ele conta como fracasso, e por quê:
 *
 *   quebrou       - execução `failed` por defeito de máquina: o motor caiu, a
 *                   rede sumiu, estourou o tempo. É o único balde que significa
 *                   "conserta alguma coisa".
 *   recusou       - execução `failed` em que o sistema fez o certo: não tinha
 *                   permissão, não entendeu qual task, não achou o dado e
 *                   disse isso. Aparece separado DE PROPÓSITO. A primeira
 *                   versão deste script somava as duas coisas e acusava 23% de
 *                   falha num dia em que a maior parte era o sistema se
 *                   comportando bem — leitor que grita demais é ignorado
 *                   igual ao que não grita.
 *   vazia         - `completed` com resposta em branco. É o pior dos dois
 *                   mundos: o sistema acha que deu certo e a pessoa não recebeu
 *                   nada. Medido 2 vezes em 16 turnos na bateria de uso livre.
 *   curta         - `completed` com menos de 40 chars. Não é resposta, é
 *                   recado. Serve pra ver "Oi! Tô por aqui" sendo devolvido
 *                   pra "como tá a operação hoje".
 *   demorou       - passou de 60s. Turno que ninguém espera é turno perdido,
 *                   mesmo quando a resposta chega certa.
 *
 * Sem argumento olha as últimas 24h. `--horas N` muda a janela.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/saude-do-bento.mts
 *   pnpm --filter @desigual-os/worker exec tsx scripts/saude-do-bento.mts --horas 72
 */
import '../src/env.js';
import { db, schema } from '@desigual-os/database';
import { and, desc, gte } from 'drizzle-orm';

const argHoras = process.argv.indexOf('--horas');
const HORAS = argHoras > -1 ? Number(process.argv[argHoras + 1] ?? 24) : 24;
const DESDE = new Date(Date.now() - HORAS * 3_600_000);

/** Abaixo disso não é resposta, é recado. */
const MINIMO_DE_RESPOSTA = 40;
/** Acima disso a pessoa já desistiu de esperar. */
const DEMOROU_MS = 60_000;

type Motivo = 'quebrou' | 'recusou' | 'vazia' | 'curta' | 'demorou';

/**
 * O que o sistema diz quando está funcionando bem e ainda assim marca a
 * execução como `failed`: sem permissão, sem entender qual task, sem o dado.
 * Isso é o produto se comportando, não defeito.
 */
const RECUSA_LEGITIMA =
  /(n[ãa]o (tenho|identifiquei|encontrei) |n[ãa]o fiz altera|sem autoriza|n[ãa]o consigo (alterar|escrever)|pode me lembrar|revisar antes de enviar|fora do escopo|permission)/i;

/** Defeito de máquina: o motor caiu, a rede sumiu, estourou o tempo. */
const QUEBRA_DE_MAQUINA =
  /(ollama|502|503|504|fetch failed|timeout|n[ãa]o respondeu em|ECONN|socket hang up|congestionad|indispon[íi]vel)/i;

const execucoes = await db
  .select({
    executionId: schema.executions.executionId,
    agent: schema.executions.agent,
    status: schema.executions.status,
    startedAt: schema.executions.startedAt,
    completedAt: schema.executions.completedAt,
    id: schema.executions.id,
  })
  .from(schema.executions)
  .where(and(gte(schema.executions.createdAt, DESDE)))
  .orderBy(desc(schema.executions.createdAt))
  .limit(500);

const passos = await db
  .select({
    executionId: schema.executionSteps.executionId,
    output: schema.executionSteps.output,
  })
  .from(schema.executionSteps)
  .where(gte(schema.executionSteps.createdAt, DESDE));

const porExecucao = new Map<string, Array<Record<string, unknown> | null>>();
for (const p of passos) {
  const lista = porExecucao.get(p.executionId);
  if (lista) lista.push(p.output);
  else porExecucao.set(p.executionId, [p.output]);
}

function respostaDe(saidas: Array<Record<string, unknown> | null>): string {
  for (const o of [...saidas].reverse()) {
    if (!o) continue;
    const t = (o.answer ?? o.response ?? o.message ?? o.content ?? o.text) as unknown;
    if (typeof t === 'string' && t.trim().length > 0) return t.trim();
  }
  return '';
}

function errorCodeDe(saidas: Array<Record<string, unknown> | null>): string | null {
  for (const o of saidas) {
    const code = (o?.metadata as { errorCode?: unknown } | undefined)?.errorCode;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return null;
}

interface Problema {
  executionId: string;
  agent: string;
  motivo: Motivo;
  errorCode: string | null;
  duracaoMs: number | null;
  amostra: string;
}

const problemas: Problema[] = [];
let saudaveis = 0;

for (const e of execucoes) {
  const saidas = porExecucao.get(e.id) ?? [];
  const resposta = respostaDe(saidas);
  const duracaoMs =
    e.startedAt && e.completedAt ? new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime() : null;
  const base = { executionId: e.executionId, agent: e.agent, errorCode: errorCodeDe(saidas), duracaoMs, amostra: resposta.replace(/\s+/g, ' ').slice(0, 110) };

  let motivo: Motivo | null = null;
  if (e.status === 'failed' || e.status === 'cancelled') {
    // A ordem importa: quebra de máquina vence, porque uma resposta pode citar
    // as duas coisas e o que precisa de conserto é a máquina.
    motivo = QUEBRA_DE_MAQUINA.test(resposta) ? 'quebrou' : RECUSA_LEGITIMA.test(resposta) ? 'recusou' : 'quebrou';
  }
  else if (e.status === 'completed' && resposta.length === 0) motivo = 'vazia';
  else if (e.status === 'completed' && resposta.length < MINIMO_DE_RESPOSTA) motivo = 'curta';
  else if (duracaoMs !== null && duracaoMs > DEMOROU_MS) motivo = 'demorou';

  if (motivo) problemas.push({ ...base, motivo });
  else if (e.status === 'completed') saudaveis++;
}

const total = saudaveis + problemas.length;
console.log(`\nÚLTIMAS ${HORAS}H · ${total} execuções olhadas\n`);
if (total === 0) {
  console.log('nada no período.');
  process.exit(0);
}

const quebras = problemas.filter((p) => p.motivo === 'quebrou' || p.motivo === 'vazia');
console.log(`entregues sem ressalva: ${saudaveis} (${Math.round((saudaveis / total) * 100)}%)`);
console.log(`recusas legítimas:      ${problemas.filter((p) => p.motivo === 'recusou').length}  (o sistema se comportando)`);
console.log(`QUEBRAS:                ${quebras.length} (${Math.round((quebras.length / total) * 100)}%)  <- é isto que precisa de conserto\n`);

const porMotivo = new Map<Motivo, number>();
for (const p of problemas) porMotivo.set(p.motivo, (porMotivo.get(p.motivo) ?? 0) + 1);
for (const [motivo, n] of [...porMotivo.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${motivo.padEnd(8)} ${n}`);
}

const porCodigo = new Map<string, number>();
for (const p of problemas) if (p.errorCode) porCodigo.set(p.errorCode, (porCodigo.get(p.errorCode) ?? 0) + 1);
if (porCodigo.size > 0) {
  console.log('\nmotivo que o próprio sistema registrou:');
  for (const [c, n] of [...porCodigo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(24)} ${n}`);
}

console.log('\nas quebras mais recentes:');
for (const p of quebras.slice(0, 12)) {
  const t = p.duracaoMs === null ? '   -' : `${String(Math.round(p.duracaoMs / 1000)).padStart(3)}s`;
  console.log(`  ${p.motivo.padEnd(8)} ${t} ${p.agent.padEnd(7)} ${p.executionId}`);
  if (p.amostra) console.log(`           "${p.amostra}"`);
}
console.log();
process.exit(0);
