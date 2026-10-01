import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decidirOrganizacaoDeTrabalho } from '@desigual-os/auth';
import type { AuthenticatedUser } from '../auth/middleware';
import { escopoDeOrganizacao, organizacaoProvedora } from '../lib/escopo-de-organizacao';

/**
 * contexto.ts — entrar numa empresa e sair dela.
 *
 * É o que transforma "existem várias empresas no banco" em "eu consigo
 * trabalhar dentro de uma delas". Sem isto, a tela de Empresas lista contas que
 * ninguém consegue abrir.
 *
 * A REGRA QUE DECIDE O DESENHO: quem valida é o SERVIDOR, e o resultado fica no
 * banco.
 *
 * A alternativa fácil seria `?org=<id>` na URL. Ela não pode ser usada, e o
 * motivo não é estilo: a barra de endereço viraria superfície de autorização.
 * Qualquer pessoa trocaria o id e o servidor teria que confiar no que o
 * navegador mandou — o bypass exato que a fronteira entre empresas existe para
 * impedir. A URL pode REFLETIR a empresa para a pessoa se situar; a decisão de
 * quem pode entrar onde nunca sai daqui.
 *
 * TRÊS COISAS SÃO CONFERIDAS, e cada uma cobre um caso real:
 *
 *   1. a empresa existe;
 *   2. a pessoa é membro dela — ou é o provedor, que atende todas;
 *   3. a empresa está ATIVA. Uma conta suspensa não pode ser aberta nem por
 *      quem é membro, senão "suspender" é só um rótulo na tela.
 */

export interface ResultadoDaTroca {
  ok: boolean;
  /** Por que não deu, em linguagem de gente. `null` quando deu certo. */
  motivo: string | null;
  organizacao: { id: string; name: string; slug: string } | null;
}

/**
 * Entra numa empresa. `null` sai de qualquer empresa e volta ao contexto do
 * provedor — que é o estado normal de quem pertence a uma organização só.
 */
export async function trocarOrganizacaoAtiva(
  user: AuthenticatedUser,
  organizationId: string | null,
): Promise<ResultadoDaTroca> {
  if (organizationId === null) {
    await db
      .update(schema.users)
      .set({ organizacaoAtivaId: null })
      .where(eq(schema.users.id, user.id));
    return { ok: true, motivo: null, organizacao: null };
  }

  const [org] = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      status: schema.organizations.status,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .catch(() => []);

  /**
   * "Não existe" e "você não pode" respondem a MESMA coisa de propósito: dizer
   * "essa empresa existe, mas não é sua" confirma a existência de uma conta
   * para quem não deveria saber que ela existe.
   */
  if (!org) return { ok: false, motivo: 'Empresa não encontrada.', organizacao: null };

  const escopo = await escopoDeOrganizacao(user);
  const ehMembro = escopo.organizationIds.includes(org.id);
  if (!ehMembro && !escopo.ehProvider) {
    return { ok: false, motivo: 'Empresa não encontrada.', organizacao: null };
  }

  if (org.status !== 'ativa') {
    return {
      ok: false,
      motivo: `A empresa ${org.name} está ${org.status}. Reative-a antes de entrar.`,
      organizacao: null,
    };
  }

  await db
    .update(schema.users)
    .set({ organizacaoAtivaId: org.id })
    .where(eq(schema.users.id, user.id));

  /**
   * Toda troca é auditada. É o registro que responde "quem entrou na conta de
   * qual cliente, quando" — pergunta que aparece no dia em que algo for
   * alterado na empresa errada.
   */
  await db
    .insert(schema.auditLogs)
    .values({
      userId: user.id,
      organizationId: org.id,
      action: 'organization.enter',
      result: 'success',
      source: 'app',
      metadata: { slug: org.slug, como: escopo.ehProvider && !ehMembro ? 'provedor' : 'membro' },
    })
    .catch(() => undefined);

  return { ok: true, motivo: null, organizacao: { id: org.id, name: org.name, slug: org.slug } };
}

/**
 * A empresa em que a pessoa está agora, já validada.
 *
 * Revalida o vínculo em vez de confiar na coluna: alguém pode ter sido removido
 * da empresa DEPOIS de entrar nela, e nesse caso o contexto salvo passa a ser
 * uma permissão vencida guardada no banco.
 */
export async function organizacaoAtivaDe(
  user: AuthenticatedUser,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [linha] = await db
    .select({ ativa: schema.users.organizacaoAtivaId })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .catch(() => []);

  if (!linha?.ativa) return null;

  const escopo = await escopoDeOrganizacao(user);
  if (!escopo.ehProvider && !escopo.organizationIds.includes(linha.ativa)) {
    // Vínculo perdido desde a entrada: limpa e volta ao provedor, em silêncio
    // para a pessoa mas sem manter o acesso.
    await db.update(schema.users).set({ organizacaoAtivaId: null }).where(eq(schema.users.id, user.id));
    return null;
  }

  const [org] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(and(eq(schema.organizations.id, linha.ativa), eq(schema.organizations.status, 'ativa')))
    .catch(() => []);

  return org ?? null;
}

/**
 * A empresa em que a pessoa está TRABALHANDO — que não é a mesma pergunta que
 * `organizacaoAtivaDe`.
 *
 * "Ativa" é o que a pessoa abriu de propósito, e é `null` na maior parte do
 * tempo. "De trabalho" nunca é nula quando há vínculo: quando ninguém abriu
 * nada, ela resolve pela mesma escada que o middleware usa — vínculo único,
 * depois a provedora.
 *
 * ESTA FUNÇÃO EXISTE PARA QUE `/me` E `requireTenant` NÃO DIVIRJAM. Enquanto
 * `/me` respondia `organizacoes[0]` e o middleware resolvia pela regra, a
 * interface podia dizer "você está na Cosentino" e a gravação cair na Desigual
 * — o mesmo formato de defeito que acabou de derrubar a tela de Clientes, uma
 * porta a menos. Ordem de linha do banco não é autoridade sobre nada.
 *
 * `opcoes.pedida` cobre o cabeçalho `x-organization-id` do middleware; `/me`
 * chama sem ele.
 */
export async function organizacaoDeTrabalhoDe(
  user: AuthenticatedUser,
  opcoes: { pedida?: string | null } = {},
): Promise<{ id: string; name: string; slug: string } | null> {
  const vinculos = await db
    .select({ organizationId: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(
      and(
        eq(schema.organizationMembers.userId, user.id),
        eq(schema.users.active, true),
        isNull(schema.users.deletedAt),
      ),
    )
    .catch(() => [] as Array<{ organizationId: string }>);

  const [ativa, escopo] = await Promise.all([organizacaoAtivaDe(user), escopoDeOrganizacao(user)]);

  const escolha = decidirOrganizacaoDeTrabalho({
    pedida: opcoes.pedida ?? null,
    ativa: ativa?.id ?? null,
    vinculos: [...new Set(vinculos.map((v) => v.organizationId))],
    provedora: organizacaoProvedora(),
    ehProvider: escopo.ehProvider,
  });

  if (!escolha.ok) return null;
  if (ativa && ativa.id === escolha.organizationId) return ativa;

  const [org] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, escolha.organizationId))
    .catch(() => []);

  return org ?? null;
}
