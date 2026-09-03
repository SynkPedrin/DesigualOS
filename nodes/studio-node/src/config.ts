import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const currentDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(currentDir, '../.env') });

const configSchema = z.object({
  NODE_ID: z.string().min(1),
  PRIVATE_HOST: z.string().min(1),
  VERSION: z.string().min(1),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default('studio-assets'),
  // ComfyUI real do Studio (Pinokio, porta 8188, confirmado rodando na
  // máquina desktop-itra471). Nome do checkpoint não é fixo: resolvido em
  // runtime via resolveCheckpointName (arquivo de modelo pode mudar).
  // IP Tailscale direto (não o hostname MagicDNS): é o que já usei em todo
  // o reconhecimento desta máquina, confirmado alcançável; resolução de
  // MagicDNS a partir da VPS não foi testada ainda.
  COMFYUI_URL: z.string().url().default('http://100.107.198.50:8188'),
  COMFYUI_CHECKPOINT_HINT: z.string().default('flux1-dev'),
});

export type StudioNodeConfig = z.infer<typeof configSchema>;

export function loadConfig(): StudioNodeConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid studio-node configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
