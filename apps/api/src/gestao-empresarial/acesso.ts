import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../auth/middleware';
import { requireTenant } from '../lib/tenant-context';

/**
 * acesso.ts: quem entra na Gestão Empresarial.
 *
 * TRÊS PORTAS, todas no servidor (esconder o menu não protege dado financeiro):
 *  1. o módulo precisa estar LIGADO no servidor (`GESTAO_EMPRESARIAL_ENABLED=true`). Desligado por
 *     padrão: sem a variável, a rota nem existe (404), em qualquer ambiente;
 *  2. em `NODE_ENV=production` ele continua desligado mesmo com a variável, a menos que haja o
 *     segundo aceite explícito `GESTAO_EMPRESARIAL_ALLOW_PRODUCTION=sim`. O módulo nasceu para
 *     rodar só no localhost; esta trava impede que um merge o ligue em produção por acidente;
 *  3. a pessoa precisa ser `master` (administrador).
 */
export function moduloLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GESTAO_EMPRESARIAL_ENABLED !== 'true') return false;
  if (env.NODE_ENV === 'production' && env.GESTAO_EMPRESARIAL_ALLOW_PRODUCTION !== 'sim') return false;
  return true;
}

export async function exigirGestao(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!moduloLigado()) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  await requireAuth(request, reply);
  if (reply.sent) return;
  await requireTenant(request, reply);
  if (reply.sent) return;
  if (!request.authUser!.roles.includes('master')) {
    reply.code(403).send({ error: 'Somente um administrador acessa a Gestão Empresarial.' });
  }
}

/** Para o menu: responde só sim ou não, sem 404 (a sidebar precisa de uma resposta, não de um erro). */
export async function resolverAcesso(request: FastifyRequest): Promise<{ allowed: boolean }> {
  return { allowed: moduloLigado() && request.authUser?.roles.includes('master') === true };
}
