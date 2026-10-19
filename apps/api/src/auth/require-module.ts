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
export function requireModule(module: WorkspaceModule) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.authUser;
    if (!user) {
      reply.code(401).send({ error: 'Not authenticated' });
      return;
    }

    const { modules } = await resolveEnabledModules(user.id);
    if (!modules.has(module)) {
      reply.code(403).send({ error: `O módulo '${module}' não está habilitado no seu workspace.` });
    }
  };
}
