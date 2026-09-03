import type { FastifyBaseLogger } from 'fastify';
import type { ExecuteRequest, ExecuteResponse } from '@desigual-os/node-protocol';
import type { NodeConfig } from './config.js';
import { runOpenClawTurn } from './openclaw/client.js';
import { searchVault } from './obsidian/reader.js';
import { runtimeState } from './state.js';

function extractUsage(raw: unknown): { input_tokens: number; output_tokens: number } {
  if (raw && typeof raw === 'object') {
    const usage = (raw as Record<string, unknown>).usage;
    if (usage && typeof usage === 'object') {
      const record = usage as Record<string, unknown>;
      const input = record.input_tokens ?? record.inputTokens ?? record.prompt_tokens;
      const output = record.output_tokens ?? record.outputTokens ?? record.completion_tokens;
      if (typeof input === 'number' && typeof output === 'number') {
        return { input_tokens: input, output_tokens: output };
      }
    }
  }
  // OpenClaw não confirmou o schema de usage ainda (ver comentário em
  // openclaw/client.ts). 0 aqui significa "não medido", não "grátis";
  // o Token Engine (Fase 11) precisa saber disso antes de confiar no valor.
  return { input_tokens: 0, output_tokens: 0 };
}

export async function executeTask(
  request: ExecuteRequest,
  config: NodeConfig,
  logger: FastifyBaseLogger,
): Promise<ExecuteResponse> {
  runtimeState.agentStatus = 'busy';
  const sources: string[] = [];

  try {
    let contextBlock = '';
    if (config.OBSIDIAN_VAULT_PATH && request.context_refs.length > 0) {
      for (const ref of request.context_refs) {
        const matches = await searchVault(config.OBSIDIAN_VAULT_PATH, ref, 3);
        for (const match of matches) {
          sources.push(match.path);
          contextBlock += `\n\n[${match.path}]\n${match.snippet}`;
        }
      }
    }

    const prompt = contextBlock ? `${request.message}\n\nContexto local:${contextBlock}` : request.message;

    const result = await runOpenClawTurn(prompt, config.openclaw, logger);

    return {
      execution_id: request.execution_id,
      agent: config.AGENT_NAME,
      status: 'completed',
      answer: result.answer,
      sources,
      tool_calls: [],
      usage: extractUsage(result.raw),
    };
  } catch (error) {
    logger.error({ error, execution_id: request.execution_id }, 'Execution failed');
    return {
      execution_id: request.execution_id,
      agent: config.AGENT_NAME,
      status: 'failed',
      answer: null,
      sources,
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    runtimeState.agentStatus = 'idle';
  }
}
