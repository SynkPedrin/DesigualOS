import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveDailyTasksAccess, type WorkContext } from '@desigual-os/work-engine';
import { requireAuth } from '../auth/middleware';
import { requireTenant } from '../lib/tenant-context';

/**
 * Guarda do Daily Tasks (Beta). Roda no BACKEND em toda rota /work/*: o front só esconde o menu, quem
 * barra de verdade é isto. Duas travas independentes (ver work-engine/access.ts): flag da empresa + lista
 * de autorizados, e papel de administrador. Falha com 403 e um motivo curto, sem revelar nada além.
 */
/**
 * ACESSO LIBERADO FICA GUARDADO POR 30 s (04/11/2026). A decisão (flag da empresa + papel) era relida a cada
 * requisição do Daily: uma ida ao banco de ~270 ms ANTES de qualquer trabalho, em toda tela, toda edição, todo
 * refetch. Só o "liberado" é guardado: quem ganha acesso entra na hora; quem perde, sai em até 30 s. Mudar a flag
 * (rota de admin) apaga tudo na hora.
 */
const ACESSO_VALE_MS = 30_000;
const acessoLiberado = new Map<string, number>();
export function esquecerAcessosDoDaily(): void {
  acessoLiberado.clear();
}

export async function requireDailyTasks(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  await requireTenant(request, reply);
  if (reply.sent) return;
  const chave = `${request.tenantContext!.organizationId}:${request.authUser!.id}:${[...request.authUser!.roles].sort().join(',')}`;
  const liberadoEm = acessoLiberado.get(chave);
  if (liberadoEm !== undefined && Date.now() - liberadoEm < ACESSO_VALE_MS) return;
  const decision = await resolveDailyTasksAccess({
    organizationId: request.tenantContext!.organizationId,
    userId: request.authUser!.id,
    platformRoles: request.authUser!.roles,
  });
  if (decision.allowed) {
    if (acessoLiberado.size > 5_000) acessoLiberado.clear();
    acessoLiberado.set(chave, Date.now());
  } else acessoLiberado.delete(chave);
  if (!decision.allowed) {
    reply.code(403).send({ error: 'O Daily Tasks (Beta) não está liberado para você.', reason: decision.reason });
  }
}

const notificadosPorRequisicao = new WeakMap<FastifyRequest, Set<string>>();

/** Contexto do motor a partir da requisição já autorizada. A empresa vem do tenant resolvido, NUNCA do corpo. */
export function workContext(request: FastifyRequest): WorkContext {
  return {
    organizationId: request.tenantContext!.organizationId,
    userId: request.authUser!.id,
    actorKind: 'user',
    aoNotificar: (ids) => {
      const s = notificadosPorRequisicao.get(request) ?? new Set<string>();
      for (const id of ids) s.add(id);
      notificadosPorRequisicao.set(request, s);
    },
  };
}

/** Quem recebeu aviso no sino durante esta requisição (para o aviso ao vivo depois da resposta). */
export function notificadosDaRequisicao(request: FastifyRequest): string[] {
  return [...(notificadosPorRequisicao.get(request) ?? [])];
}
