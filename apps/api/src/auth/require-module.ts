import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WorkspaceModule } from '@desigual-os/types';
import { resolveEnabledModules } from '../workspace/access';

/**
 * requireModule.ts — o lado de API do Workspace Builder (§79 do prompt de
 * refinamento: "se Designer não possui media.read, não basta esconder o
 * menu. API: 403/404"). `requirePermission` já pergunta "este PAPEL pode
 * fazer X?"; isto pergunta uma coisa diferente: "o WORKSPACE desta PESSOA
 * inclui este módulo?" — as duas perguntas valem juntas, nunca uma no lugar
 * da outra (uma rota de Meta Ads continua exigindo `requirePermission`
 * também, se exigir).
 *
 * Mesmo vocabulário que a sidebar usa pra decidir o que mostrar
 * (`resolveEnabledModules`) — por construção, nunca existe uma rota que a
 * tela esconde e a API ainda aceita, nem o inverso.
 */
/**
 * Módulos por pessoa em memória por 20 s. Toda requisição autenticada passava
 * por aqui com uma ida ao banco (~125 ms até o Supabase em us-east-1, medido
 * em 19/10/2026), e a Inbox dispara dezenas por minuto. Mudança de workspace
 * limpa a entrada na hora (forgetEnabledModules); fora isso vale em até 20 s.
 */
const MODULES_TTL_MS = 20_000;
const modulesCache = new Map<string, { modules: Set<string>; at: number }>();

export function forgetEnabledModules(userId: string): void {
  modulesCache.delete(userId);
}

async function enabledModulesOf(userId: string): Promise<Set<string>> {
  const hit = modulesCache.get(userId);
  if (hit && Date.now() - hit.at < MODULES_TTL_MS) return hit.modules;
  const { modules } = await resolveEnabledModules(userId);
  modulesCache.set(userId, { modules, at: Date.now() });
  return modules;
}

export function requireModule(module: WorkspaceModule) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.authUser;
    if (!user) {
      reply.code(401).send({ error: 'Not authenticated' });
      return;
    }

    const modules = await enabledModulesOf(user.id);
    if (!modules.has(module)) {
      reply.code(403).send({ error: `O módulo '${module}' não está habilitado no seu workspace.` });
    }
  };
}
