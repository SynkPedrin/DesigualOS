import type { FastifyReply, FastifyRequest } from 'fastify';
import type { WorkspaceModule } from '@desigual-os/types';
import { resolveEnabledModules } from '../workspace/access';
import { LIMITE_DO_VALOR_VELHO_MS, renovarEmSegundoPlano } from '../lib/renovacao';

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
const modulesCache = new Map<string, { resolved: Awaited<ReturnType<typeof resolveEnabledModules>>; at: number }>();

export function forgetEnabledModules(userId: string): void {
  modulesCache.delete(userId);
}

/** Mesmo resultado de resolveEnabledModules, com os 20 s de memória (também usado por GET /me/workspace). */
export async function resolveEnabledModulesCached(userId: string): Promise<Awaited<ReturnType<typeof resolveEnabledModules>>> {
  const hit = modulesCache.get(userId);
  const idade = hit ? Date.now() - hit.at : Infinity;
  if (hit && idade < MODULES_TTL_MS) return hit.resolved;
  if (hit && idade < LIMITE_DO_VALOR_VELHO_MS) {
    renovarEmSegundoPlano(`modulos:${userId}`, async () => {
      const novo = await resolveEnabledModules(userId);
      // Só grava se ninguém apagou/trocou a entrada enquanto relia (forgetEnabledModules ganha).
      if (modulesCache.get(userId) === hit) modulesCache.set(userId, { resolved: novo, at: Date.now() });
    });
    return hit.resolved;
  }
  const resolved = await resolveEnabledModules(userId);
  modulesCache.set(userId, { resolved, at: Date.now() });
  return resolved;
}

async function enabledModulesOf(userId: string): Promise<Set<string>> {
  return (await resolveEnabledModulesCached(userId)).modules;
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
