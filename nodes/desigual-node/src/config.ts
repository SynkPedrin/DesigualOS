import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AGENT_NAMES, NODE_TYPES } from '@desigual-os/types';
import type { OpenClawConfig } from './openclaw/client.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(currentDir, '../.env') });

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4001),
  NODE_ID: z.string().min(1),
  AGENT_NAME: z.enum(AGENT_NAMES),
  NODE_TYPE: z.enum(NODE_TYPES),
  PRIVATE_HOST: z.string().min(1),
  VERSION: z.string().min(1),
  CAPABILITIES: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
  ORCHESTRATOR_URL: z.string().url(),
  NODE_SECRET: z.string().min(1),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  // OpenClaw roda na mesma máquina (regra de ouro 2); chamado via CLI local
  // (ver nodes/desigual-node/src/openclaw/client.ts), não HTTP.
  OPENCLAW_BINARY: z.string().default('openclaw'),
  OPENCLAW_AGENT_ID: z.string().optional(),
  OPENCLAW_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(600),
  OPENCLAW_GATEWAY_URL: z.string().url().default('http://localhost:18789'),
  // Caminho local do vault Obsidian deste agente. Opcional: sem ele, o Node
  // simplesmente não injeta contexto local (nunca sincroniza o vault,
  // regra de ouro 1).
  OBSIDIAN_VAULT_PATH: z.string().optional(),
});

export type NodeConfig = z.infer<typeof configSchema> & { openclaw: OpenClawConfig };

export function loadConfig(): NodeConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid desigual-node configuration: ${parsed.error.message}`);
  }
  const data = parsed.data;
  return {
    ...data,
    openclaw: {
      binary: data.OPENCLAW_BINARY,
      agentId: data.OPENCLAW_AGENT_ID ?? data.AGENT_NAME,
      timeoutSeconds: data.OPENCLAW_TIMEOUT_SECONDS,
    },
  };
}
