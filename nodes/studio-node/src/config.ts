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
  // máquina desktop-itra471). Nomes de arquivo não são fixos: resolvidos em
  // runtime via resolveFluxModelNames (arquivo de modelo pode mudar).
  // IP Tailscale direto (não o hostname MagicDNS): é o que já usei em todo
  // o reconhecimento desta máquina, confirmado alcançável; resolução de
  // MagicDNS a partir da VPS não foi testada ainda.
  COMFYUI_URL: z.string().url().default('http://100.107.198.50:8188'),
  // FLUX.2 Dev não tem checkpoint único (trocou o antigo flux1-dev de
  // arquivo só): diffusion model, text encoder e VAE são três arquivos
  // separados, cada um resolvido pelo seu próprio hint.
  COMFYUI_UNET_HINT: z.string().default('flux2'),
  COMFYUI_CLIP_HINT: z.string().default('flux2'),
  COMFYUI_VAE_HINT: z.string().default('flux2'),

  /**
   * Liga o pipeline autônomo (crítica -> decisão -> correção -> melhor
   * candidato). Desligado por padrão: com OFF o worker se comporta
   * exatamente como antes desta mudança, que é o caminho de rollback.
   */
  STUDIO_AUTONOMOUS_QA: z
    .string()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),

  /** Teto de tentativas por peça. 3 é o valor do plano; 1 desliga o loop mantendo a crítica (útil pra só coletar score). */
  STUDIO_QA_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),

  STUDIO_CRITIC_PROVIDER: z.enum(['ollama', 'anthropic']).default('ollama'),

  /**
   * Ollama do CRÍTICO. O default aponta pro localhost DESTE processo de
   * propósito, não pro Ollama da caixa da GPU (100.107.198.50:11434).
   *
   * Medido em 16/09/2026 na GPU real: com o FLUX.2 residente sobram ~6,4GB
   * dos 24GB. Subir o `qwen3.6:35b-a3b` (20,7GB) ao lado derrubou a VRAM
   * livre do ComfyUI pra 0,08GB e a geração seguinte foi de 36,4s pra
   * 110,1s (3x). Apontar esta URL pro host da GPU é possível e continua
   * suportado - mas é escolha consciente de trocar tempo de geração por
   * qualidade de crítica, e não o default.
   */
  CRITIC_OLLAMA_URL: z.string().url().default('http://127.0.0.1:11434'),
  /** Medido: 9B/35B com visão dão scores equivalentes; o 3B não serve (ver visual-critic.ts). */
  CRITIC_OLLAMA_MODEL: z.string().default('qwen3.5:9b'),
  CRITIC_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
});

export type StudioNodeConfig = z.infer<typeof configSchema>;

export function loadConfig(): StudioNodeConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid studio-node configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
