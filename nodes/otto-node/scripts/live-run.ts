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
 * Saída: o logger (pino) escreve no MESMO stdout deste script antes do JSON
 * final. Pra extrair só o JSON de um arquivo salvo, pegue a partir da última
 * linha que é exatamente "{" no início: `tail -n +$(grep -n '^{$' out.json |
 * tail -1 | cut -d: -f1) out.json`.
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

const startedAt = Date.now();
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
  { info: () => {}, warn: (...a: unknown[]) => console.error('[warn]', ...a), error: (...a: unknown[]) => console.error('[error]', ...a) } as never,
);
const elapsedMs = Date.now() - startedAt;

console.log(JSON.stringify({ elapsedMs, model, response }, null, 2));
