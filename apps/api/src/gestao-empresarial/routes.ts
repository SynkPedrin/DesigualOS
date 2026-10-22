import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/middleware';
import { resolverAcesso } from './acesso';
import { registrarCadastrosEFinanceiro } from './rotas-cadastros-e-financeiro';

/**
 * Gestão Empresarial. Todas as rotas ficam atrás de `exigirGestao` (módulo ligado no servidor,
 * fora de produção por padrão, e papel `master`). Só `/access` é aberto a qualquer pessoa logada,
 * porque o menu precisa de um sim/não, não de um 404.
 */
export async function registerGestaoEmpresarialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gestao-empresarial/access', { preHandler: [requireAuth] }, async (request) => resolverAcesso(request));
  await registrarCadastrosEFinanceiro(app);
}
