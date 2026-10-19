import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Estado compartilhado de quota do Claude Opus 5.5.
 *
 * O problema que isto resolve é concreto (24/09/2026): a conta do worker
 * bateu o limite semanal e cada job novo do Motion batia na mesma parede —
 * gastando tempo de fila, abrindo sessão e falhando minutos depois com a
 * mesma mensagem. O motor é fail-closed por decisão (sem Opus 5.5, para),
 * então o limite de uso É indisponibilidade do modelo e precisa ser tratado
 * como tal ANTES de abrir sessão, não descoberto no meio do job.
 *
 * O mecanismo é um arquivo em vez de memória de processo porque quem detecta
 * o limite (uma sessão do Claude Code dentro de um job) e quem precisa saber
 * dele (o guard do chat, o card de settings, o próximo job) não dividem
 * processo nem momento. O arquivo é a verdade entre os dois.
 *
 * Localização: mesma resolução do workspace.ts — OTTO_MOTION_RUNTIME_DIR ou
 * `runtime/` do pacote. Fica na RAIZ do runtime (não dentro de motion_<id>)
 * porque a quota é da CONTA, não de um job: o próximo motion herda o estado
 * do anterior, que é exatamente o comportamento desejado.
 *
 * Quem reabilita é o probeOpusModel (o "Testar conexão" das settings): um
 * sucesso real no Opus 5.5 apaga o estado e o motor volta sozinho. Não há
 * TTL — a data de reset que a CLI informa vai no `detail`, e confiar nela
 * pra expirar sozinho seria parsear texto de erro, frágil por definição.
 */

/** Frase exata que a UI/chat mostram quando o estado é limite de uso. */
export const QUOTA_UNAVAILABLE_MESSAGE = 'O Claude Opus 5.5 está indisponível — limite de uso atingido.';

export interface ClaudeQuotaState {
  /** Mensagem apresentável (QUOTA_UNAVAILABLE_MESSAGE). */
  message: string;
  /** Mensagem original da CLI, que inclui a data de reset. Vai pro log/detail. */
  detail: string;
  recordedAt: string;
}

const DEFAULT_RUNTIME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../runtime');

function quotaStateFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.OTTO_MOTION_RUNTIME_DIR ?? DEFAULT_RUNTIME_DIR, 'claude-quota-state.json');
}

/** Grava (ou atualiza) o estado de quota. Chamado quando a CLI falha por limite. */
export async function recordQuotaUnavailable(detail: string): Promise<void> {
  const state: ClaudeQuotaState = {
    message: QUOTA_UNAVAILABLE_MESSAGE,
    detail,
    recordedAt: new Date().toISOString(),
  };
  const file = quotaStateFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Leitura tolerante: arquivo ausente, corrompido ou com shape errado viram
 * null. Um JSON quebrado NÃO pode derrubar a checagem de conexão — pior que
 * não saber da quota é fingir que o worker inteiro está fora do ar.
 */
export async function readQuotaState(): Promise<ClaudeQuotaState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(quotaStateFile(), 'utf8')) as Partial<ClaudeQuotaState>;
    if (
      typeof parsed.message !== 'string' ||
      typeof parsed.detail !== 'string' ||
      typeof parsed.recordedAt !== 'string'
    ) {
      return null;
    }
    return { message: parsed.message, detail: parsed.detail, recordedAt: parsed.recordedAt };
  } catch {
    return null;
  }
}

/** Apaga o estado. Só o probe com sucesso no Opus 5.5 chama — quota voltou, motor reabilitado. */
export async function clearQuotaState(): Promise<void> {
  await fs.rm(quotaStateFile(), { force: true });
}
