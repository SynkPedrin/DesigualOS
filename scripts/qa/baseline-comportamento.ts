/**
 * Linha de base de comportamento (Onda 0, item 0.3).
 *
 * Roda as perguntas dos critérios de aceite (auditoria, seção 4) contra o
 * sistema COMO ESTÁ e grava as respostas cruas em
 * artifacts/baseline-comportamento-<data>/. Sem este "antes", ninguém prova
 * o "depois". Nada aqui corrige comportamento: só registra.
 *
 * Decisões de desenho (registradas no relatório da onda):
 * - agent_hint explícito por caso: o objetivo é medir o comportamento de cada
 *   agente, não o router (que tem baseline própria em router_decisions).
 * - Casos que provocariam efeito colateral real de produção (carrossel do
 *   Otto dispara studio_jobs com custo de GPU) NÃO são executados no
 *   baseline; entram como nao_executado com o motivo.
 * - Casos de escrita no ClickUp (criar/editar/anexar) são seguros de perguntar
 *   porque hoje não existe ferramenta nenhuma de escrita no caminho do chat:
 *   o que se registra é o modo de falha atual.
 *
 * Uso: pnpm --filter @desigual-os/api exec tsx ../../scripts/qa/baseline-comportamento.ts
 * Requer API em pé (localhost:3001) e credenciais QA no .env (ver login.mjs).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.QA_API_BASE ?? 'http://localhost:3001';
const TOKEN_FILE = '/tmp/desigual-qa-token';
const HOJE = new Date().toISOString().slice(0, 10);
const OUT_DIR = resolve(REPO, 'artifacts', `baseline-comportamento-${HOJE}`);

const TIMEOUT_POR_AGENTE: Record<string, number> = {
  bento: 150_000,
  suzy: 210_000,
  otto: 400_000,
};

interface Caso {
  id: string;
  agente: 'bento' | 'suzy' | 'otto';
  criterio: string;
  perguntas: string[]; // mais de uma = mesma conversa (follow-up)
  executar: boolean;
  motivoSeNao?: string;
}

const CASOS: Caso[] = [
  // BENTO (critérios de aceite 1 a 8 da auditoria, seção 4.1)
  { id: 'b1', agente: 'bento', criterio: 'aceite 1: visão macro com priorização', executar: true,
    perguntas: ['Quais tasks estão atrasadas há mais de 5 dias e o que eu puxo pra frente hoje?'] },
  { id: 'b2', agente: 'bento', criterio: 'aceite 2: criar task completa (hoje sem prazo/prioridade, BL-15)', executar: true,
    perguntas: ['Cria uma task de revisão de carrossel pra sexta que vem, prioridade alta'] },
  { id: 'b3', agente: 'bento', criterio: 'aceite 3: editar task (impossível hoje, BL-01)', executar: true,
    perguntas: ['Marca a última task criada como em revisão e passa pro responsável dela'] },
  { id: 'b4', agente: 'bento', criterio: 'aceite 4: anexo na task (impossível hoje, BL-05/BL-06)', executar: false,
    motivoSeNao: 'requer fluxo de upload de anexo; registrado como pendente na suíte de aceite',
    perguntas: [] },
  { id: 'b5', agente: 'bento', criterio: 'aceite 5: follow-up com fio de conversa (BL-08)', executar: true,
    perguntas: ['Quantas tasks vencem essa semana?', 'E na semana passada, como tava?'] },
  { id: 'b6', agente: 'bento', criterio: 'aceite 6: pesquisa web com fonte (impossível hoje, BL-02)', executar: true,
    perguntas: ['Pesquisa o benchmark atual de CPL para clínicas odontológicas no Meta Ads'] },
  { id: 'b7', agente: 'bento', criterio: 'aceite 7: institucional com fonte, sem jargão (não regressão)', executar: true,
    perguntas: ['Me explica o que é a Agência Desigual'] },
  { id: 'b8', agente: 'bento', criterio: 'aceite 8: não encontrou + o que existe próximo + sugestão de registro', executar: true,
    perguntas: ['Qual o procedimento padrão para onboarding de estagiário na agência?'] },
  // SUZY (seção 4.2)
  { id: 's1', agente: 'suzy', criterio: 'aceite 1: lead frio, uma pergunta de diagnóstico, sem preço', executar: true,
    perguntas: ['Oi, quanto custa o serviço de vocês?'] },
  { id: 's2', agente: 'suzy', criterio: 'aceite 2: objeção de preço sem desconto automático', executar: true,
    perguntas: ['Tá caro.'] },
  { id: 's3', agente: 'suzy', criterio: 'aceite 3: follow-up com valor novo, não cobrança', executar: true,
    perguntas: ['Um lead sumiu há 5 dias depois que mandei a proposta. O que eu mando pra ele?'] },
  { id: 's4', agente: 'suzy', criterio: 'aceite 4: handoff com resumo do lead', executar: true,
    perguntas: ['O lead respondeu "pode fechar, como pago?". O que eu faço agora?'] },
  { id: 's5', agente: 'suzy', criterio: 'aceite 5: diagnóstico de conversa por estágio', executar: true,
    perguntas: ['Analisa essa conversa: o lead perguntou preço, sumiu uma semana, voltou pedindo desconto. Qual o estágio dele e qual a próxima melhor ação?'] },
  { id: 's6', agente: 'suzy', criterio: 'aceite 6: publicação no Instagram exige confirmação humana (não regressão)', executar: true,
    perguntas: ['Publica esse post no Instagram pra mim: "Promoção de clareamento essa semana"'] },
  { id: 's7', agente: 'suzy', criterio: 'aceite 7: Meta Ads é do Jarbas (não regressão)', executar: true,
    perguntas: ['A campanha de Meta Ads tá cara, você mexe no orçamento pra mim?'] },
  // OTTO (seção 4.3)
  { id: 'o1', agente: 'otto', criterio: 'aceite 1: análise e engenharia de prompt', executar: true,
    perguntas: ['Avalia esse prompt de geração de imagem e reescreve melhor: "foto de tênis branco em fundo minimalista, luz suave"'] },
  { id: 'o2', agente: 'otto', criterio: 'aceite 2: roteiro sem etapa declarada (paralisia do funil, stance.ts:8-13)', executar: true,
    perguntas: ['Escreve um roteiro de reels pra uma clínica odontológica'] },
  { id: 'o3', agente: 'otto', criterio: 'aceite 3: revisão de peça com veredito e direção', executar: true,
    perguntas: ['Revisa essa peça de topo de funil: headline "Agende sua consulta", fundo branco puro, foto de stock de dentista sorrindo, logo pequeno no rodapé.'] },
  { id: 'o4', agente: 'otto', criterio: 'aceite 4: honestidade sem material real (não regressão)', executar: true,
    perguntas: ['Quais são os melhores criativos rodando agora?'] },
  { id: 'o5', agente: 'otto', criterio: 'aceite 5: carrossel 10 cards dentro do timeout', executar: false,
    motivoSeNao: 'dispara studio_jobs reais (custo de GPU na máquina do Studio); executar só em janela combinada com o dono',
    perguntas: [] },
  { id: 'o7', agente: 'otto', criterio: 'aceite 7: seed nunca entra no contexto (BL de dado ausente)', executar: true,
    perguntas: ['Me passa o seed daquele job de imagem da semana passada pra eu reproduzir'] },
];

function garantirToken(): string {
  // Sempre reautentica: token cacheado expira e um 401 em lote finge baseline.
  execSync(`node ${resolve(REPO, 'scripts/qa/login.mjs')}`, { cwd: REPO, stdio: 'pipe' });
  return readFileSync(TOKEN_FILE, 'utf8').trim();
}

async function enviarPergunta(token: string, pergunta: string, agente: string, conversationId?: string) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const t0 = performance.now();
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: pergunta,
      agent_hint: agente.toUpperCase(),
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });
  const ackMs = Math.round(performance.now() - t0);
  const ack = await res.json();
  if (!res.ok) return { ok: false as const, ack_ms: ackMs, status: res.status, erro: ack };
  return { ok: true as const, ack_ms: ackMs, execution_id: ack.execution_id, conversation_id: ack.conversation_id };
}

async function aguardarExecucao(token: string, executionId: string, conversationId: string, timeoutMs: number) {
  const headers = { Authorization: `Bearer ${token}` };
  const t0 = performance.now();
  const deadline = Date.now() + timeoutMs;
  let ultimo: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const er = await fetch(`${BASE}/executions/${executionId}`, { headers });
    if (!er.ok) continue;
    ultimo = await er.json();
    const status = (ultimo?.status ?? (ultimo?.execution as Record<string, unknown>)?.status) as string;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') break;
  }
  const totalMs = Math.round(performance.now() - t0);
  const steps = (ultimo?.steps ?? []) as Array<Record<string, unknown>>;
  const output = (steps[steps.length - 1]?.output ?? {}) as Record<string, unknown>;
  let resposta = typeof output.answer === 'string' ? output.answer : '';
  if (!resposta.trim()) {
    try {
      const mr = await fetch(`${BASE}/conversations/${conversationId}/messages`, { headers });
      const msgs = await mr.json();
      const lista = Array.isArray(msgs) ? msgs : (msgs.messages ?? []);
      const assistant = [...lista].reverse().find((m: { role?: string }) => m.role === 'assistant');
      if (assistant) resposta = assistant.content;
    } catch { /* resposta fica vazia e o caso registra a falha */ }
  }
  return {
    status: (ultimo?.status ?? (ultimo?.execution as Record<string, unknown>)?.status ?? 'timeout') as string,
    total_ms: totalMs,
    resposta,
    fontes: output.sources ?? null,
  };
}

const token = garantirToken();
mkdirSync(OUT_DIR, { recursive: true });

console.log(`Baseline de comportamento ${HOJE} contra ${BASE}`);
console.log(`Saída em ${OUT_DIR}\n`);

const indice: Array<Record<string, unknown>> = [];

for (const caso of CASOS) {
  if (!caso.executar) {
    console.log(`[SKIP] ${caso.id} (${caso.agente}): ${caso.motivoSeNao}`);
    indice.push({ id: caso.id, agente: caso.agente, criterio: caso.criterio, status: 'nao_executado', motivo: caso.motivoSeNao });
    writeFileSync(resolve(OUT_DIR, `${caso.id}.json`), JSON.stringify({ ...caso, status: 'nao_executado' }, null, 2));
    continue;
  }
  const trocas: Array<Record<string, unknown>> = [];
  let conversationId: string | undefined;
  for (const pergunta of caso.perguntas) {
    const envio = await enviarPergunta(token, pergunta, caso.agente, conversationId);
    if (!envio.ok) {
      trocas.push({ pergunta, erro: envio.erro, status_http: envio.status });
      break;
    }
    conversationId = envio.conversation_id;
    const fim = await aguardarExecucao(token, envio.execution_id, envio.conversation_id, TIMEOUT_POR_AGENTE[caso.agente]);
    trocas.push({ pergunta, execution_id: envio.execution_id, ack_ms: envio.ack_ms, ...fim });
    console.log(`[${fim.status === 'completed' ? 'OK' : 'FALHOU'}] ${caso.id} (${caso.agente}) ${fim.total_ms}ms: ${pergunta.slice(0, 60)}`);
  }
  const registro = { id: caso.id, agente: caso.agente, criterio: caso.criterio, conversation_id: conversationId, trocas };
  writeFileSync(resolve(OUT_DIR, `${caso.id}.json`), JSON.stringify(registro, null, 2));
  indice.push({ id: caso.id, agente: caso.agente, criterio: caso.criterio, status: trocas.at(-1)?.status ?? 'erro_envio', total_ms: trocas.at(-1)?.total_ms });
}

writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify({ gerado_em: new Date().toISOString(), casos: indice }, null, 2));
const ok = indice.filter((c) => c.status === 'completed').length;
const skip = indice.filter((c) => c.status === 'nao_executado').length;
console.log(`\nPLACAR: ${ok} completos, ${indice.length - ok - skip} com falha/timeout, ${skip} não executados (efeito colateral real).`);
