import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyBaseLogger } from 'fastify';

const execFileAsync = promisify(execFile);

export interface OpenClawConfig {
  binary: string;
  agentId: string;
  timeoutSeconds: number;
}

export interface OpenClawTurnResult {
  answer: string;
  raw: unknown;
}

/**
 * Roda um turno via a CLI real do OpenClaw (`openclaw agent --agent <id>
 * --message <texto> --json`), confirmada pela documentação do próprio CLI
 * (`openclaw agent --help`). Node Agent e OpenClaw rodam na mesma máquina
 * (Mac Mini), então isto é child_process local, nunca uma chamada de rede
 * pra outro host. O schema exato do JSON de saída não foi verificado contra
 * uma execução real (evitei disparar um turno de verdade durante o
 * desenvolvimento do backend, porque isso executa o agente de verdade,
 * com custo e possíveis efeitos colaterais reais). O parser abaixo é
 * tolerante a isso: tenta campos plausíveis e cai pro JSON bruto como texto
 * se não reconhecer o formato, então nunca perde a resposta silenciosamente.
 * Validar contra uma execução real na máquina de destino antes de produção.
 */
export async function runOpenClawTurn(
  message: string,
  config: OpenClawConfig,
  logger: FastifyBaseLogger,
): Promise<OpenClawTurnResult> {
  const args = ['agent', '--agent', config.agentId, '--message', message, '--json'];

  logger.debug({ agentId: config.agentId }, 'Calling OpenClaw');

  // Nunca herdar as env vars deste processo pro CLI do OpenClaw. Descobri
  // rodando de verdade que OPENCLAW_GATEWAY_URL (nosso, só usado pelo health
  // check HTTP abaixo) tem o MESMO nome que uma env var real do próprio
  // OpenClaw, e setá-la faz o CLI achar que é um override de gateway
  // (exige token/senha explícitos, credenciais do config não são reusadas).
  // Passar env limpo (só o necessário pro binário rodar) evita esse tipo de
  // colisão silenciosa com qualquer env var real do OpenClaw que a gente não
  // conheça.
  const cleanEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  };

  const { stdout } = await execFileAsync(config.binary, args, {
    timeout: (config.timeoutSeconds + 5) * 1000,
    maxBuffer: 10 * 1024 * 1024,
    env: cleanEnv,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { answer: stdout.trim(), raw: stdout };
  }

  return { answer: extractAnswer(parsed), raw: parsed };
}

function extractAnswer(parsed: unknown): string {
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    for (const key of ['reply', 'message', 'text', 'output', 'result', 'answer']) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }
  }
  return JSON.stringify(parsed);
}

export async function checkOpenClawHealth(gatewayUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}
