import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { NODE_TYPES } from '@desigual-os/types';
import { loadOttoConfig, type OttoConfig } from '@desigual-os/otto';

const currentDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(currentDir, '../.env') });

/**
 * Capacidades declaradas no /capabilities e no registro junto ao Orchestrator.
 * São o que o Otto sabe entregar de verdade (packages/otto): plano criativo,
 * carrossel, plano de vídeo, prompt de imagem, spec de produção e revisão de
 * qualidade. Fixas em código - não faz sentido ligar/desligar por env porque
 * o pipeline (execute.ts) implementa todas sempre.
 */
export const OTTO_CAPABILITIES = [
  'creative_plan',
  'carousel',
  'video_plan',
  'image_prompt',
  'production_spec',
  'quality_review',
] as const;

const configSchema = z.object({
  // 4002: 4001 é a convenção do desigual-node; o Otto fica na porta seguinte
  // pra rodar na mesma máquina em dev sem conflito.
  PORT: z.coerce.number().int().positive().default(4002),
  NODE_ID: z.string().min(1).default('NODE_OTTO_01'),
  // Fixo em 'otto' de propósito: este node é especializado. Aceitar outro
  // AGENT_NAME registraria no Orchestrator um node que não sabe executar o
  // que o nome promete - falha silenciosa na hora do dispatch.
  AGENT_NAME: z.literal('otto').default('otto'),
  NODE_TYPE: z.enum(NODE_TYPES).default('mac_mini'),
  // Defaults localhost e nunca IP Tailscale/path de máquina: o node migra de
  // máquina junto com o brain, e config de produção entra via env explícito.
  PRIVATE_HOST: z.string().min(1).default('http://localhost:4002'),
  VERSION: z.string().min(1).default('0.1.0'),
  ORCHESTRATOR_URL: z.string().url().default('http://localhost:3001'),
  NODE_SECRET: z.string().min(1),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
});

export type OttoNodeConfig = z.infer<typeof configSchema> & { otto: OttoConfig };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OttoNodeConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid otto-node configuration: ${parsed.error.message}`);
  }
  // loadOttoConfig valida OTTO_* (provider, URL do Ollama, modelo, brain path)
  // e lança com mensagem própria; deixamos subir como está pra o operador ver
  // qual das duas famílias de env quebrou.
  return { ...parsed.data, otto: loadOttoConfig(env) };
}
