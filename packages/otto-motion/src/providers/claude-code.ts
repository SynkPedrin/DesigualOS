import { spawn } from 'node:child_process';
import type { Logger } from '@desigual-os/logging';
import { MOTION_MODEL_ID, assertModelActuallyUsed, assertMotionModel } from '../model.js';
import { MotionError, MotionModelUnavailableError } from '../errors.js';

/**
 * §6 — Claude Code como worker programático, NÃO a API cobrada por token, e
 * NÃO automação visual de terminal. `spawn` do binário oficial com
 * `--print`, que é a interface headless suportada.
 *
 * O conjunto de flags abaixo é o contrato de segurança do §13, e cada uma foi
 * verificada contra a CLI real (2.1.281) antes de entrar aqui:
 *
 *   --restricted        confina Read/Write/Edit ao diretório de trabalho E
 *                       ignora settings de user/project/local. Provado ao
 *                       vivo: tentativa de ler o `.env` do repositório e de
 *                       escrever fora do workspace voltou negada, sem criar
 *                       arquivo nenhum.
 *   --tools Read Write Edit Glob Grep
 *                       SEM Bash, sem execução de código. O agente escreve o
 *                       motion; quem compila, renderiza e extrai frames é
 *                       este pacote, em processo separado e controlado. É o
 *                       que fecha "não execute código arbitrário do agente
 *                       com acesso irrestrito".
 *   --strict-mcp-config --mcp-config {"mcpServers":{}}
 *                       zero servidores MCP: nada de ClickUp, Notion ou
 *                       qualquer credencial do ambiente do usuário.
 *   --permission-prompts none
 *                       sessão headless não tem quem responda prompt; o
 *                       default seria travar até o timeout.
 *
 * Duas pegadinhas reais da CLI, descobertas na marra:
 *  1. `--tools`, `--add-dir` e `--mcp-config` são VARIÁDICOS. Passar o prompt
 *     como argumento posicional depois deles faz o prompt ser engolido como
 *     mais um valor da flag ("Input must be provided either through stdin or
 *     as a prompt argument"). Por isso o prompt vai por STDIN — que também
 *     resolve o limite de tamanho de argumento, e os prompts daqui são longos.
 *  2. `--mcp-config '{}'` é rejeitado; o objeto precisa da chave `mcpServers`.
 */
const CLAUDE_BIN = process.env.OTTO_MOTION_CLAUDE_BIN ?? 'claude';

export interface ClaudeCodeRunOptions {
  /** cwd do processo. `--restricted` confina as ferramentas de arquivo AQUI. */
  cwd: string;
  prompt: string;
  systemPrompt?: string | undefined;
  timeoutMs: number;
  /** Teto de gasto da sessão. Sem isto um loop do agente vira conta aberta. */
  maxBudgetUsd?: number | undefined;
  logger: Logger;
  /** Identificador do job, só pro log. */
  motionId: string;
  stage: string;
}

export interface ClaudeCodeResult {
  /** Texto final do agente. */
  text: string;
  costUsd: number;
  turns: number;
  durationMs: number;
  modelsUsed: string[];
  sessionId: string | null;
  /** Ferramentas negadas pelo sandbox. Vazio é o normal; não-vazio merece log. */
  denials: unknown[];
}

interface ClaudeCliResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  session_id?: string;
  modelUsage?: Record<string, unknown>;
  permission_denials?: unknown[];
  subtype?: string;
}

/**
 * §30 — ambiente do filho, montado do zero.
 *
 * O worker do Desigual roda com DATABASE_URL, SUPABASE_SECRET_KEY, tokens do
 * ClickUp e chaves de LLM no `process.env`. Herdar isso daria ao agente, de
 * graça, exatamente o que o §13 diz pra não dar — e um `Read` de arquivo nem
 * seria preciso: bastaria o agente pedir que um `echo $VAR` aparecesse... o
 * que, sem Bash, ele não faz, mas depender disso seria confiar no lugar
 * errado. Allowlist explícita fecha os dois caminhos.
 */
export function childEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'TERM',
    // Credenciais do PRÓPRIO Claude Code (§7/§8): é a conta do usuário que
    // autentica o worker, e nenhuma delas é segredo de outro sistema.
    'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = parent[key];
    if (value !== undefined) env[key] = value;
  }
  // Marca de origem: facilita achar essas sessões no histórico da conta.
  env.CLAUDE_CODE_ENTRYPOINT = 'otto-motion-engine';
  return env;
}

export function buildArgs(options: { systemPrompt?: string | undefined; maxBudgetUsd?: number | undefined }): string[] {
  const args = [
    '--print',
    '--output-format',
    'json',
    '--model',
    MOTION_MODEL_ID,
    '--restricted',
    '--permission-mode',
    'acceptEdits',
    '--permission-prompts',
    'none',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--disable-slash-commands',
    '--tools',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
  ];
  // NUNCA passar --fallback-model: é literalmente o fallback silencioso que
  // o §5 proíbe, e a CLI o aplicaria sem avisar ninguém.
  if (options.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(options.maxBudgetUsd));
  if (options.systemPrompt) args.push('--append-system-prompt', options.systemPrompt);
  return args;
}

export async function runClaudeCode(options: ClaudeCodeRunOptions): Promise<ClaudeCodeResult> {
  assertMotionModel(MOTION_MODEL_ID);

  const args = buildArgs({ systemPrompt: options.systemPrompt, maxBudgetUsd: options.maxBudgetUsd });
  const started = Date.now();

  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: options.cwd,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new MotionError('CODEGEN_FAILED', 'A criação do motion demorou além do limite e eu interrompi.', {
          detail: `timeout de ${options.timeoutMs}ms no estágio ${options.stage}`,
          actions: [{ label: 'Tentar de novo', action: 'retry' }],
        }),
      );
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new MotionError('PROVIDER_DISCONNECTED', 'Não consegui falar com o Claude Code neste worker.', {
          detail: `spawn ${CLAUDE_BIN}: ${error.message}`,
          actions: [{ label: 'Reconectar Claude', action: 'reconnect_claude' }],
          cause: error,
        }),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Exit != 0 com stdout JSON ainda é resultado legítimo (a CLI devolve
      // `is_error: true` no corpo); quem decide é o parse, não o exit code.
      if (stdout.trim() === '') {
        reject(
          new MotionError('CODEGEN_FAILED', 'O Claude Code terminou sem produzir resposta.', {
            detail: `exit ${code ?? 'null'}; stderr: ${stderr.slice(0, 2000)}`,
          }),
        );
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(options.prompt);
    child.stdin.end();
  });

  let parsed: ClaudeCliResult;
  try {
    parsed = JSON.parse(raw.trim()) as ClaudeCliResult;
  } catch {
    throw new MotionError('CODEGEN_FAILED', 'Não entendi a resposta do Claude Code.', {
      detail: `stdout não era JSON: ${raw.slice(0, 1000)}`,
    });
  }

  // Ordem importa: o gate do modelo vem ANTES do gate de erro. Uma sessão que
  // falhou POR indisponibilidade do Opus 5.5 precisa virar OPUS_UNAVAILABLE
  // (com "reconecte o Claude"), não um "erro genérico do motion".
  if (parsed.is_error === true) {
    const message = parsed.result ?? 'erro sem descrição';
    if (/does not support this model|unrecognized_model|model.*not (available|found)/i.test(message)) {
      throw new MotionModelUnavailableError(message.slice(0, 500));
    }
    throw new MotionError('CODEGEN_FAILED', 'O Claude Code não conseguiu concluir esta etapa do motion.', {
      detail: message.slice(0, 2000),
      actions: [{ label: 'Tentar de novo', action: 'retry' }],
    });
  }

  assertModelActuallyUsed(parsed.modelUsage);

  const denials = parsed.permission_denials ?? [];
  if (denials.length > 0) {
    // Não é falha: é o sandbox funcionando. Mas registrar é o que permite
    // notar um prompt que está empurrando o agente pra fora do workspace.
    options.logger.warn(
      { motionId: options.motionId, stage: options.stage, denials: denials.length },
      'Motion: ferramentas negadas pelo sandbox do Claude Code',
    );
  }

  return {
    text: parsed.result ?? '',
    costUsd: parsed.total_cost_usd ?? 0,
    turns: parsed.num_turns ?? 0,
    durationMs: parsed.duration_ms ?? Date.now() - started,
    modelsUsed: Object.keys(parsed.modelUsage ?? {}),
    sessionId: parsed.session_id ?? null,
    denials,
  };
}
