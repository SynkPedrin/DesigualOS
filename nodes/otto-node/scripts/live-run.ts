/**
 * Runner ad-hoc pra baseline ao vivo (Otto Elite Phase 2). NÃO faz parte do
 * build nem do pacote publicado — chama executeTask() diretamente (mesmo
 * código de produção) contra o Ollama LOCAL desta máquina, sem subir o
 * Fastify, sem NODE_SECRET real e sem tocar o node de produção (mac-mini,
 * acessado via Tailscale).
 *
 * Uso: npx tsx scripts/live-run.ts "<mensagem>" [modelo]
 * (rodar de dentro de nodes/otto-node/; ajuste OTTO_LLM_TIMEOUT_MS se o
 * modelo for lento nesta máquina — CPU-only, ver OTTO_ELITE_HANDOFF.md)
 *
 * Pra simular contexto de cliente injetado pelo worker, ORDEM IMPORTA:
 * primeiro o turno do usuário, DEPOIS o marcador, depois o contexto —
 * `"<mensagem>\n\n---\nContexto:\nCLIENTE DO TURNO: ..."` — na ordem
 * inversa, stripOrchestratorContext() descarta o turno do usuário inteiro
 * (achado ao vivo nesta sessão: um teste com a ordem trocada caiu
 * silenciosamente no caminho de chat em vez do de produção).
 *
 * Saída: JSON puro no stdout — nada de log misturado (ver Blocker 6 abaixo).
 * Pra extrair de um arquivo salvo: `tail -n +$(grep -n '^{$' out.json | tail
 * -1 | cut -d: -f1) out.json`.
 *
 * BLOCKER 6 (Otto Elite — observabilidade de aceitação): antes, `info` era
 * um no-op — os logs estruturados que execute.ts já emite em cada estágio
 * (estratégia decidida, avaliação do critic com scores/overall/root_cause,
 * reescrita rejeitada por regressão, reparo de completude) eram descartados,
 * deixando o benchmark ao vivo sem NENHUMA evidência de estágio — só o
 * resultado final, sem saber o que aconteceu no meio. Isto não é acrescentar
 * feature de produto, é infraestrutura de aceitação: sem isto, é impossível
 * provar (só especular) que a estratégia/critic/reescrita rodaram como
 * esperado num run real. `info` agora ACUMULA os eventos estruturados
 * (mensagem + campos — os mesmos objetos que execute.ts já loga, nunca
 * prosa livre) e eles saem no campo `trace` do JSON final, junto com o
 * resultado.
 */
import { loadConfig } from '../src/config.js';
import { createDefaultDeps, executeTask } from '../src/execute.js';

const message = process.argv[2];
const model = process.argv[3] ?? 'qwen3.5:4b';
if (!message) {
  console.error('uso: npx tsx scripts/live-run.ts "<mensagem>" [modelo]');
  process.exit(1);
}

process.env.NODE_SECRET = process.env.NODE_SECRET ?? 'live-run-local-only';
process.env.OTTO_MODEL = model;
process.env.OTTO_OLLAMA_URL = process.env.OTTO_OLLAMA_URL ?? 'http://localhost:11434';
process.env.OTTO_BRAIN_PATH = process.env.OTTO_BRAIN_PATH ?? new URL('../../../Brain-Marketing', import.meta.url).pathname;

const config = loadConfig();
const deps = createDefaultDeps(config);

interface TraceEvent {
  t_ms: number;
  message: string;
  fields?: Record<string, unknown>;
}
const trace: TraceEvent[] = [];
const startedAt = Date.now();
const record = (msg: string, fields?: Record<string, unknown>) => trace.push({ t_ms: Date.now() - startedAt, message: msg, fields });

const response = await executeTask(
  {
    execution_id: `live-${Date.now()}`,
    message,
    context_refs: [],
    client_feedback_history: [],
    attachments: [],
  },
  config,
  deps,
  {
    // pino's info(fields, msg) ou info(msg) — os dois formatos aparecem em execute.ts.
    info: (a: unknown, b?: unknown) =>
      typeof a === 'string' ? record(a) : record(typeof b === 'string' ? b : '', a as Record<string, unknown>),
    warn: (a: unknown, b?: unknown) => {
      const msg = typeof a === 'string' ? a : (b as string) ?? '';
      const fields = typeof a === 'string' ? undefined : (a as Record<string, unknown>);
      record(`[warn] ${msg}`, fields);
      console.error('[warn]', msg, fields ?? '');
    },
    error: (a: unknown, b?: unknown) => {
      const msg = typeof a === 'string' ? a : (b as string) ?? '';
      const fields = typeof a === 'string' ? undefined : (a as Record<string, unknown>);
      record(`[error] ${msg}`, fields);
      console.error('[error]', msg, fields ?? '');
    },
  } as never,
);
const elapsedMs = Date.now() - startedAt;

console.log(JSON.stringify({ elapsedMs, model, response, trace }, null, 2));
