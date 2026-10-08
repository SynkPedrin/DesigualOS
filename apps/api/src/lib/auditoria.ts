import type { FastifyRequest } from 'fastify';
import { db, schema } from '@desigual-os/database';

/**
 * auditoria.ts — a escrita canônica em `audit_logs` para ações de tenant.
 *
 * Até aqui cada rota montava o insert na mão, e duas coisas se perdiam no
 * copy-paste: o `organization_id` (client.created não gravava) e o fato de o
 * autor ser o PROVEDOR atuando dentro de uma empresa que não é dele — a
 * pergunta "foi alguém da empresa ou foi a Desigual mexendo na conta do
 * cliente?" ficava sem resposta no rastro.
 *
 * A marcação sai de duas fontes, nesta ordem:
 *
 *   1. `entrada.comoProvedor` explícito — rotas que passam por `podeConfigurar`
 *      (connectors, membros) em vez de `requireTenant`, e já sabem;
 *   2. `request.tenantContext.actingAsProvider` — marcado pelo requireTenant
 *      quando o provedor resolveu uma empresa em que não tem vínculo.
 *
 * Falha de auditoria não derruba a ação (mesmo critério das rotas que já
 * usavam `.catch()`): o rastro é importante, mas um banco momentaneamente
 * indisponível não pode impedir a operação — a ação em si já teria falhado
 * no insert principal.
 */
export interface EntradaDeAuditoria {
  action: string;
  result?: string;
  organizationId?: string | null;
  clientId?: string | null;
  metadata?: Record<string, unknown>;
  comoProvedor?: boolean;
  /**
   * SOBRE QUAL RECURSO a ação agiu (`'user'`, `'client'`, ...) e o id dele —
   * colunas próprias (`resource_type`/`resource_id`), não metadata solta.
   * Adicionado na auditoria P0-A (06/10/2026): as 4 mutações de
   * admin/routes.ts gravavam o alvo só como `metadata.target_user_id`,
   * texto livre que não dá pra indexar nem cruzar entre ações diferentes
   * sobre o MESMO recurso.
   */
  resourceType?: string;
  resourceId?: string;
  /** Estado antes/depois da mutação, quando couber barato (o UPDATE já
   *  devolveu a linha anterior/nova) — nunca vale ir buscar de propósito só
   *  pra preencher auditoria. */
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

export async function auditarAcao(request: FastifyRequest, entrada: EntradaDeAuditoria): Promise<void> {
  const comoProvedor = entrada.comoProvedor ?? request.tenantContext?.actingAsProvider ?? false;

  await db
    .insert(schema.auditLogs)
    .values({
      userId: request.authUser?.id ?? null,
      organizationId: entrada.organizationId ?? request.tenantContext?.organizationId ?? null,
      clientId: entrada.clientId ?? null,
      action: entrada.action,
      result: entrada.result ?? 'completed',
      source: 'app',
      resourceType: entrada.resourceType ?? null,
      resourceId: entrada.resourceId ?? null,
      oldValue: entrada.oldValue ?? null,
      newValue: entrada.newValue ?? null,
      requestId: request.id ?? null,
      metadata: {
        ...(entrada.metadata ?? {}),
        ...(comoProvedor ? { acting_as_provider: true } : {}),
      },
    })
    .catch(() => undefined);
}
