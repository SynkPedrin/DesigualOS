import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Config do Otto por env, mesmo padrão de nodes/desigual-node/src/config.ts.
 * OTTO_BRAIN_PATH é propositalmente RELATIVO ao cwd por default: o Brain
 * (vault de marketing) migra de máquina junto com o Otto, então nunca pode
 * ser path absoluto de uma máquina específica (regra de ouro de portabilidade).
 */
const ottoConfigSchema = z.object({
  OTTO_LLM_PROVIDER: z.enum(['ollama']).default('ollama'),
  OTTO_OLLAMA_URL: z.string().url().default('http://localhost:11434'),
  OTTO_MODEL: z.string().min(1).default('mistral'),
  OTTO_BRAIN_PATH: z.string().min(1).default('./Brain-Marketing'),
  // Geração de plano criativo é uma chamada longa (JSON grande); 120s casa
  // com o timeout do passo de copy do Studio (packages/router/marketing-copy).
  OTTO_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

export interface OttoConfig {
  provider: 'ollama';
  ollamaUrl: string;
  model: string;
  /** Caminho absoluto do vault, resolvido a partir do cwd do processo. */
  brainPath: string;
  llmTimeoutMs: number;
}

export function loadOttoConfig(env: NodeJS.ProcessEnv = process.env): OttoConfig {
  const parsed = ottoConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid otto configuration: ${parsed.error.message}`);
  }
  const data = parsed.data;
  return {
    provider: data.OTTO_LLM_PROVIDER,
    ollamaUrl: data.OTTO_OLLAMA_URL,
    model: data.OTTO_MODEL,
    brainPath: resolve(data.OTTO_BRAIN_PATH),
    llmTimeoutMs: data.OTTO_LLM_TIMEOUT_MS,
  };
}
