/**
 * uso-livre.mjs — o Bento continua útil quando uma pessoa usa livremente?
 *
 * A bateria de inteligência (intelligence-benchmark.mjs) responde outra
 * pergunta: 25 perguntas independentes, bem escritas, cada uma num turno
 * limpo. Ela mede o TETO do sistema.
 *
 * Isto mede o CHÃO, que é onde a operação vive:
 *
 *   - uma conversa só, com continuidade, do primeiro ao último turno;
 *   - escrito como gente escreve: minúscula, sem pontuação, com erro de
 *     digitação, frase pela metade;
 *   - com referência solta ("e essa?", "muda ela"), que é onde a memória de
 *     conversa quebra de verdade;
 *   - trocando de assunto no meio e voltando;
 *   - pedindo coisa que não dá pra saber, e coisa que o ClickUp não faz;
 *   - repetindo uma pergunta feita muitos turnos antes.
 *
 * O que se mede aqui NÃO é "acertou a resposta". É se o turno CONTINUOU ÚTIL:
 * respondeu com substância, ou recusou dizendo por quê. Os dois contam como
 * sucesso. O fracasso é o vazio, o genérico e o que responde outra coisa.
 *
 * REGRA DE SEGURANÇA: a Tammy usa o sistema de verdade enquanto isto roda.
 * Nenhum turno deste arquivo pode escrever em task de cliente real. Os pedidos
 * de escrita ou são ambíguos de propósito (pra ver a recusa), ou miram a lista
 * de QA.
 *
 *   node scripts/benchmark/uso-livre.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3001';
const TOKEN_FILE = '/tmp/desigual-qa-token';
const OUT_DIR = new URL('../../artifacts/uso-livre/', import.meta.url);

/**
 * `espera` é o que faz o turno ser ÚTIL, não a resposta certa:
 *   dado      - tem que trazer número ou nome apurado
 *   recusa    - tem que admitir que não sabe, e dizer por quê
 *   memoria   - tem que resolver sem o usuário repetir o que já disse
 *   qualquer  - vale dado OU recusa honesta; o que não vale é enrolar
 */
const CONVERSA = [
  { id: 'T01', m: 'oi, como ta a operação hoje', espera: 'dado' },
  { id: 'T02', m: 'e o q ta mais atrasado?', espera: 'memoria' },
  { id: 'T03', m: 'quem ta cuidando disso', espera: 'memoria' },
  { id: 'T04', m: 'me mostra as da d carvalho', espera: 'dado' },
  { id: 'T05', m: 'agrupa por entrega', espera: 'memoria' },
  { id: 'T06', m: 'a segunda', espera: 'memoria' },
  { id: 'T07', m: 'muda ela pra amanhã', espera: 'qualquer' },
  { id: 'T08', m: 'quanto a gente faturou com esse cliente esse ano?', espera: 'recusa' },
  { id: 'T09', m: 'move essa task pra outra lista', espera: 'recusa' },
  { id: 'T10', m: 'esquece, e a cosentino?', espera: 'dado' },
  { id: 'T11', m: 'me ajuda aí', espera: 'qualquer' },
  { id: 'T12', m: 'qual o padrão de nome que a equipe usa pra esse cliente?', espera: 'dado' },
  { id: 'T13', m: 'volta pro que eu perguntei no começo, o que tava mais atrasado mesmo?', espera: 'memoria' },
  { id: 'T14', m: 'nao era isso q eu quis dizer', espera: 'qualquer' },
  { id: 'T15', m: 'quantas tarefas a agencia tem no total', espera: 'dado' },
  { id: 'T16', m: 'obrigado', espera: 'qualquer' },
];

/** Frases que já foram medidas como enchimento em briefing; aqui reprovam turno. */
const ENROLACAO =
  /(posso ajudar com mais alguma coisa|estou (aqui )?(à|a) disposi[çc][ãa]o|como posso (te )?ajudar|fico (à|a) disposi[çc][ãa]o|claro!? vamos l[áa]|entendi!? )/i;

/** Uma recusa honesta DIZ o que faltou. "Não sei" seco não é recusa útil. */
const RECUSA_HONESTA =
  /(n[ãa]o (consigo|consegui|tenho|dá|da)|n[ãa]o est[áa] (no|dispon)|fora do que|n[ãa]o fa[çc]o|n[ãa]o registro|precisa(ria)? (de|que)|CONFIRMAR|n[ãa]o encontrei|sem (acesso|dado|informa))/i;

function token() { return readFileSync(TOKEN_FILE, 'utf8').trim(); }
function headers() { return { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }; }

async function preflight() {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('API fora do ar');
  const probe = await fetch(`${BASE}/conversations?limit=1`, { headers: headers(), signal: AbortSignal.timeout(10000) });
  if (probe.status === 401) execFileSync('node', [new URL('../qa/login.mjs', import.meta.url).pathname], { stdio: 'pipe' });
}

function answerOf(execution) {
  for (const step of [...(execution?.steps ?? [])].reverse()) {
    const o = step?.output;
    const t = typeof o === 'string' ? o : (o?.answer ?? o?.response ?? o?.message ?? o?.content ?? o?.text);
    if (typeof t === 'string' && t.trim().length > 0) return t;
  }
  return execution?.result?.response ?? execution?.result?.message ?? '';
}

async function esperarResposta(executionId, budgetMs = 180000) {
  const inicio = Date.now();
  let ultima = null;
  while (Date.now() - inicio < budgetMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/executions/${executionId}`, { headers: headers(), signal: AbortSignal.timeout(10000) });
    if (!res.ok) continue;
    ultima = await res.json();
    // A execução vira `completed` ANTES do passo com a resposta ficar visível
    // (medido em 29/09/2026). Terminar aqui sem texto é ler cedo demais.
    if (['failed', 'cancelled'].includes(ultima.status)) break;
    if (ultima.status === 'completed' && answerOf(ultima).trim().length > 0) break;
  }
  return ultima;
}

function julgar(caso, texto) {
  const t = (texto ?? '').trim();
  if (t.length === 0) return { util: false, motivo: 'resposta vazia' };
  if (t.length < 40) return { util: false, motivo: `curta demais (${t.length} chars)` };
  const recusou = RECUSA_HONESTA.test(t);
  if (caso.espera === 'recusa') {
    return recusou
      ? { util: true, motivo: 'recusou e disse por quê' }
      : { util: false, motivo: 'deveria ter admitido que não sabe, e afirmou algo' };
  }
  if (ENROLACAO.test(t) && !recusou && !/\d/.test(t)) {
    return { util: false, motivo: 'enrolou: sem número, sem nome, sem recusa' };
  }
  if (caso.espera === 'dado' || caso.espera === 'memoria') {
    const temSubstancia = /\d/.test(t) || /[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+ [A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(t);
    if (!temSubstancia && !recusou) return { util: false, motivo: 'sem número e sem nome próprio: não trouxe dado' };
  }
  return { util: true, motivo: recusou ? 'trouxe dado e declarou lacuna' : 'trouxe dado' };
}

mkdirSync(OUT_DIR, { recursive: true });
await preflight();

let conversationId = null;
const registros = [];

for (const caso of CONVERSA) {
  const t0 = Date.now();
  const reg = { ...caso, conversationId, latenciaMs: 0, chars: 0, resposta: '', util: false, motivo: '', erro: null };
  try {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: caso.m, agent_hint: 'BENTO', ...(conversationId ? { conversation_id: conversationId } : {}) }),
      signal: AbortSignal.timeout(90000),
    });
    const body = await res.json().catch(() => ({}));
    const execId = body.execution_id ?? body.executionId;
    conversationId = body.conversation_id ?? body.conversationId ?? conversationId;
    if (!execId) throw new Error(`sem execution_id (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 160)}`);
    const execution = await esperarResposta(execId);
    reg.executionId = execId;
    reg.status = execution?.status ?? 'timeout';
    reg.resposta = answerOf(execution);
    // O errorCode é o que o sistema SABE sobre o próprio fracasso. Hoje ele é
    // gravado e nunca lido de volta; aqui ele é lido, pra comparar o que o
    // sistema achou que aconteceu com o que de fato aconteceu.
    reg.errorCode = (execution?.steps ?? []).map((s) => s?.output?.metadata?.errorCode).filter(Boolean).join(',') || null;
  } catch (e) {
    reg.erro = e.message;
  }
  reg.latenciaMs = Date.now() - t0;
  reg.chars = reg.resposta.length;
  const veredito = reg.erro ? { util: false, motivo: `erro: ${reg.erro}` } : julgar(caso, reg.resposta);
  reg.util = veredito.util;
  reg.motivo = veredito.motivo;
  registros.push(reg);
  console.log(
    `${caso.id} ${reg.util ? 'OK  ' : 'FALHA'} ${String(Math.round(reg.latenciaMs / 1000) + 's').padStart(4)} ` +
    `${String(reg.chars).padStart(5)}ch  ${caso.espera.padEnd(8)} ${reg.motivo}` +
    (reg.errorCode ? `  [${reg.errorCode}]` : ''),
  );
}

const uteis = registros.filter((r) => r.util).length;
const p95 = [...registros.map((r) => r.latenciaMs)].sort((a, b) => a - b)[Math.floor(registros.length * 0.95)];
console.log(`\nÚTEIS: ${uteis}/${registros.length} (${Math.round((uteis / registros.length) * 100)}%)`);
console.log(`latência mediana ${Math.round(registros.map((r) => r.latenciaMs).sort((a, b) => a - b)[Math.floor(registros.length / 2)] / 1000)}s · pior ${Math.round(p95 / 1000)}s`);
console.log(`conversa: ${conversationId}`);
writeFileSync(new URL('SUMMARY.json', OUT_DIR), JSON.stringify({ quando: new Date().toISOString(), conversationId, registros }, null, 2));
