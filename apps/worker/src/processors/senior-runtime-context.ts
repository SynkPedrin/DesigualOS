import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { ehPapelDePlataforma, hasPermission, loadUserAccess, organizacaoProvedora } from '@desigual-os/auth';
import type { SeniorToolContext } from '@desigual-os/tool-gateway';

/**
 * POR QUE A AUTORIDADE NÃO FOI RESOLVIDA — e não "você não tem permissão".
 *
 * Relato de 08/10/2026: "BENTO FINALIZE TODAS AS TASKS ATRIBUIDAS A PEDRO
 * GABRIEL" respondia "Não consegui confirmar sua permissão pra essa ação
 * agora". A pessoa confirmou de novo, em maiúsculas, e recebeu a mesma frase.
 *
 * A permissão estava inteira. O que faltava era EMPRESA: a conta pertence a
 * duas, nenhuma estava marcada como ativa, e o pedido não citava cliente —
 * então não havia como decidir em nome de qual empresa escrever no ClickUp.
 * Esta função devolvia `null` para todos os casos, e a camada de cima só sabia
 * dizer "permissão".
 *
 * A diferença custa caro: "sem permissão" manda procurar um administrador;
 * "escolha a empresa" se resolve em dois cliques. Por isso o motivo agora
 * viaja junto.
 */
export type MotivoSemAutoridade =
  | 'execucao-desconhecida'
  | 'agente-sem-escrita'
  | 'pessoa-inativa'
  | 'sem-vinculo'
  | 'empresa-ambigua';

export type AutoridadeDoSenior =
  | { ok: true; contexto: SeniorToolContext }
  | { ok: false; motivo: MotivoSemAutoridade };

/** Frase para quem está no chat: diz o que houve E o que fazer a respeito. */
export function explicarFaltaDeAutoridade(motivo: MotivoSemAutoridade): string {
  switch (motivo) {
    case 'empresa-ambigua':
      return (
        'Você pertence a mais de uma empresa e nenhuma está aberta agora, então eu não sei em nome de qual agir. ' +
        'Abra a empresa na tela de Empresas, ou me diga de qual cliente é a tarefa, e eu sigo daqui.'
      );
    case 'sem-vinculo':
      return 'Sua conta não está vinculada a nenhuma empresa ainda. Quem administra consegue resolver isso na tela de Equipe.';
    case 'pessoa-inativa':
      return 'Sua conta está desativada. Quem administra consegue reativá-la na tela de Equipe.';
    case 'agente-sem-escrita':
      return 'Este agente não escreve no ClickUp.';
    case 'execucao-desconhecida':
      return 'Perdi o contexto desta execução. Me peça de novo que eu refaço.';
  }
}

/**
 * A ESCADA DA EMPRESA, sem banco: dá pra exercitar as combinações todas.
 *
 * Da pista mais específica para a mais geral. A segunda e a quarta entraram em
 * 08/10/2026 porque sem elas quem pertence a duas empresas simplesmente não
 * conseguia escrever — e recebia "sem permissão" em vez de "escolha a
 * empresa".
 *
 *   1. cliente da execução   quem fala de um cliente fala da empresa dele.
 *   2. empresa ativa         a mesma que `requireTenant` usa na API; é a
 *                            resposta de "onde eu estou trabalhando agora".
 *   3. vínculo único         sem ambiguidade possível.
 *   4. empresa provedora     SÓ para papel de plataforma: quem opera no nível
 *                            da agência, sem cliente em pauta, age pela própria
 *                            agência. Não vale para papel comum — senão viraria
 *                            um caminho lateral pra escrever na casa sem ser
 *                            dela, que é exatamente o que o escopo por empresa
 *                            existe pra impedir.
 *
 * Em todos os degraus, a empresa escolhida PRECISA estar entre os vínculos:
 * nem o cliente da execução nem a empresa ativa salva no banco valem como
 * autorização sozinhos — os dois podem ter envelhecido.
 */
export function decidirEmpresaDoSenior(entrada: {
  empresaDoCliente: string | null;
  organizacaoAtivaId: string | null;
  vinculos: readonly string[];
  ehPapelDePlataforma: boolean;
  provedora: string | null;
}): string | null {
  const pertence = (id: string | null): id is string => typeof id === 'string' && entrada.vinculos.includes(id);

  if (pertence(entrada.empresaDoCliente)) return entrada.empresaDoCliente;
  if (pertence(entrada.organizacaoAtivaId)) return entrada.organizacaoAtivaId;
  if (entrada.vinculos.length === 1) return entrada.vinculos[0]!;
  if (entrada.ehPapelDePlataforma && pertence(entrada.provedora)) return entrada.provedora;
  return null;
}

/**
 * Resolve a autoridade a partir da execução persistida e do acesso atual.
 *
 * A EMPRESA é decidida por uma escada, da pista mais específica para a mais
 * geral — e a segunda e a quarta foram acrescentadas em 08/10/2026 porque sem
 * elas quem tem duas empresas simplesmente não conseguia escrever:
 *
 *   1. cliente da execução   quem fala de um cliente fala da empresa dele.
 *   2. empresa ativa         a mesma que `requireTenant` usa na API; é a
 *                            resposta de "onde eu estou trabalhando agora".
 *   3. vínculo único         sem ambiguidade possível.
 *   4. empresa provedora     só para papel de plataforma: quem opera no nível
 *                            da agência, sem cliente em pauta, está agindo
 *                            pela própria agência. Não vale para papel comum,
 *                            senão viraria um caminho lateral pra escrever na
 *                            casa sem ser dela.
 */
export async function resolverAutoridadeDoSenior(executionDbId: string): Promise<AutoridadeDoSenior> {
  const [execution] = await db.select().from(schema.executions).where(eq(schema.executions.id, executionDbId));
  if (!execution) return { ok: false, motivo: 'execucao-desconhecida' };
  if (execution.agent !== 'bento' && execution.agent !== 'otto') return { ok: false, motivo: 'agente-sem-escrita' };

  const [actor] = await db.select().from(schema.users).where(and(
    eq(schema.users.id, execution.userId), eq(schema.users.active, true), isNull(schema.users.deletedAt),
  ));
  if (!actor) return { ok: false, motivo: 'pessoa-inativa' };

  const memberships = await db.select().from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, actor.id));
  if (memberships.length === 0) return { ok: false, motivo: 'sem-vinculo' };

  const access = await loadUserAccess(actor.id);

  let empresaDoCliente: string | null = null;
  if (execution.clientId) {
    const [client] = await db.select().from(schema.clients).where(and(
      eq(schema.clients.id, execution.clientId), isNull(schema.clients.deletedAt),
    ));
    empresaDoCliente = client?.organizationId ?? null;
  }

  const organizationId = decidirEmpresaDoSenior({
    empresaDoCliente,
    organizacaoAtivaId: actor.organizacaoAtivaId ?? null,
    vinculos: memberships.map((m) => m.organizationId),
    ehPapelDePlataforma: ehPapelDePlataforma(access.roles),
    provedora: organizacaoProvedora(),
  });
  if (!organizationId) return { ok: false, motivo: 'empresa-ambigua' };

  return {
    ok: true,
    contexto: {
      executionId: execution.executionId,
      userId: actor.id,
      organizationId,
      agent: execution.agent,
      permissions: hasPermission(access.permissions, 'clickup', 'write') ? [{ resource: 'clickup', action: 'write' }] : [],
    },
  };
}

/** Compatibilidade com quem só precisa do contexto e trata `null` sozinho. */
export async function loadSeniorRuntimeContext(executionDbId: string): Promise<SeniorToolContext | null> {
  const r = await resolverAutoridadeDoSenior(executionDbId);
  return r.ok ? r.contexto : null;
}
