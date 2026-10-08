import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { loadUserAccess } from '@desigual-os/auth';
import { isWorkspaceModule, modulosPadrao, type WorkspaceModule } from '@desigual-os/types';

export interface ResolvedWorkspace {
  templateId: string | null;
  modules: Set<WorkspaceModule>;
  /** false = não existe linha em workspace_configs ainda — os módulos vieram do padrão de modulosPadrao(). */
  configured: boolean;
}

/**
 * access.ts — a ÚNICA leitura de "quais módulos esta pessoa tem", usada por
 * GET /me/workspace, GET/PUT /team/members/:id/workspace e por
 * `requireModule` (../auth/require-module.ts). Uma função só, pra sidebar e
 * API nunca divergirem sobre a mesma pergunta.
 *
 * Sem linha em `workspace_configs` = sem configuração ainda, NUNCA "sem
 * módulo nenhum" — cai pro padrão de `modulosPadrao(ehMaster)`. É o que
 * garante que ligar o Workspace Builder não tranca ninguém que já
 * trabalhava antes dele existir (ver cabeçalho do schema).
 */
export async function resolveEnabledModules(userId: string): Promise<ResolvedWorkspace> {
  const [linha] = await db.select().from(schema.workspaceConfigs).where(eq(schema.workspaceConfigs.userId, userId));

  if (!linha) {
    const { roles } = await loadUserAccess(userId);
    return { templateId: null, modules: new Set(modulosPadrao(roles.includes('master'))), configured: false };
  }

  // Filtra contra o vocabulário ATUAL: um módulo removido de WORKSPACE_MODULES
  // não pode sobreviver como permissão fantasma só porque uma linha antiga
  // ainda cita o nome dele.
  const modulos = (linha.modules ?? []).filter(isWorkspaceModule);
  return { templateId: linha.templateId, modules: new Set(modulos), configured: true };
}
