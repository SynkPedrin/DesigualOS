import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decidirOrganizacaoDeTrabalho } from '@desigual-os/auth';
import { organizacaoAtivaDe } from '../organizations/contexto';
import { escopoDeOrganizacao, organizacaoProvedora } from './escopo-de-organizacao';
import { LIMITE_DO_VALOR_VELHO_MS, renovarEmSegundoPlano } from './renovacao';

/**
 * tenant-context.ts — decide em qual empresa a requisição está trabalhando e
 * deixa isso em `request.tenantContext`.
 *
 * A REGRA em si não mora aqui: mora em `decidirOrganizacaoDeTrabalho`, pura, em
 * `@desigual-os/auth`, junto das outras duas regras de fronteira. Este arquivo
 * faz só a parte que precisa de banco — reunir os fatos e traduzir a recusa em
 * HTTP. Foi ter a regra escondida dentro de um middleware, resolvendo por
 * contagem de linhas, que derrubou a tela de Clientes de quem criou a segunda
 * empresa; o histórico está no cabeçalho daquele arquivo.
 */

export interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: string;
  permissions: { resource: string; action: string }[];
  /**
   * `true` quando quem está operando é o PROVEDOR dentro de uma empresa em que
   * não tem vínculo — a Desigual mexendo na conta do cliente, não alguém da
   * casa. O helper de auditoria (lib/auditoria.ts) grava isso como
   * `metadata.acting_as_provider: true` nas escritas da requisição.
   */
  actingAsProvider: boolean;
}

declare module 'fastify' {
  interface FastifyRequest { tenantContext?: TenantContext }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vínculos ATIVOS. Conta desativada ou apagada não tem vínculo nenhum. */
async function vinculosDe(userId: string) {
  return db
    .select({
      id: schema.organizationMembers.id,
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(
      and(
        eq(schema.organizationMembers.userId, userId),
        eq(schema.users.active, true),
        isNull(schema.users.deletedAt),
      ),
    )
    .catch(() => []);
}

/**
 * Vínculos e escopo por pessoa em memória por 20 s (a empresa ATIVA continua
 * lida a cada requisição, porque trocar de empresa precisa valer na hora).
 * Medido em 19/10/2026: cada requisição gastava ~125 ms só nesta consulta
 * até o banco em us-east-1. Vínculo removido vale em até 20 s; usuário
 * desativado já é barrado antes, em requireAuth.
 */
const VINCULOS_TTL_MS = 20_000;
const vinculosCache = new Map<string, { vinculos: Awaited<ReturnType<typeof vinculosDe>>; escopo: Awaited<ReturnType<typeof escopoDeOrganizacao>>; at: number }>();

/**
 * Vínculo mudou (entrou, saiu, trocou de papel): esquece na hora. Sem isto,
 * quem era removido de uma empresa continuava entrando nela por até 20 s.
 */
export function esquecerVinculos(userId: string): void {
  vinculosCache.delete(userId);
}

async function fatosDeVinculo(user: NonNullable<FastifyRequest['authUser']>) {
  const hit = vinculosCache.get(user.id);
  const idade = hit ? Date.now() - hit.at : Infinity;
  if (hit && idade < VINCULOS_TTL_MS) return hit;
  if (hit && idade < LIMITE_DO_VALOR_VELHO_MS) {
    renovarEmSegundoPlano(`vinculos:${user.id}`, async () => {
      const novo = await lerVinculos(user);
      // esquecerVinculos durante a releitura ganha: não grava por cima do apagamento.
      if (vinculosCache.get(user.id) === hit && (novo.vinculos.length > 0 || novo.escopo.ehProvider)) vinculosCache.set(user.id, novo);
    });
    return hit;
  }
  const fresh = await lerVinculos(user);
  // Falha de banco devolve [] em vinculosDe: não guardar, para não prender a pessoa fora por 20 s.
  if (fresh.vinculos.length > 0 || fresh.escopo.ehProvider) vinculosCache.set(user.id, fresh);
  return fresh;
}

async function lerVinculos(user: NonNullable<FastifyRequest['authUser']>) {
  const [vinculos, escopo] = await Promise.all([vinculosDe(user.id), escopoDeOrganizacao(user)]);
  return { vinculos, escopo, at: Date.now() };
}

export async function requireTenant(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = request.authUser;
  if (!user) { reply.code(401).send({ error: 'Not authenticated' }); return; }

  const pedida = request.headers['x-organization-id'];
  if (pedida !== undefined && (typeof pedida !== 'string' || !UUID.test(pedida))) {
    reply.code(400).send({ error: 'Invalid organization selector' }); return;
  }

  /**
   * Escopo e vínculos em paralelo (não dependem um do outro); a empresa ativa
   * depois, RECEBENDO o escopo. Pedi-la junto no mesmo `Promise.all` parecia
   * mais rápido e era mais lento: ela relia o escopo por dentro, e com
   * `DATABASE_POOL_MAX=3` a consulta repetida vira fila, não desperdício.
   */
  const { vinculos, escopo } = await fatosDeVinculo(user);
  const ativa = await organizacaoAtivaDe(user, escopo);

  const escolha = decidirOrganizacaoDeTrabalho({
    pedida: typeof pedida === 'string' ? pedida : null,
    ativa: ativa?.id ?? null,
    vinculos: vinculos.map((v) => v.organizationId),
    provedora: organizacaoProvedora(),
    ehProvider: escopo.ehProvider,
  });

  if (!escolha.ok) {
    if (escolha.motivo === 'precisa-escolher') {
      /**
       * A mensagem diz ONDE se resolve. A versão anterior devolvia
       * "Select an organization" e parava aí — pedindo uma escolha que não
       * tinha tela, o que fez o 403 parecer defeito em vez de pergunta.
       */
      reply.code(403).send({
        error: 'Select an organization',
        detalhe: 'Você pertence a mais de uma empresa. Abra uma delas na tela de Empresas.',
      });
      return;
    }
    reply.code(403).send({ error: 'Organization membership required' });
    return;
  }

  const vinculo = vinculos.find((v) => v.organizationId === escolha.organizationId);
  request.tenantContext = {
    userId: user.id,
    organizationId: escolha.organizationId,
    // Provedor dentro de uma empresa em que não é membro não tem vínculo para
    // mostrar. O papel fica explícito em vez de herdar o de outra empresa.
    membershipId: vinculo?.id ?? '',
    role: vinculo?.role ?? 'provedor',
    permissions: user.permissions,
    actingAsProvider: escopo.ehProvider && !vinculo,
  };
}

export async function clientBelongsToTenant(clientId: string, organizationId: string): Promise<boolean> {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients)
    .where(and(eq(schema.clients.id, clientId), eq(schema.clients.organizationId, organizationId), isNull(schema.clients.deletedAt)));
  return Boolean(client);
}

/**
 * Mesmo princípio de `clientBelongsToTenant`, para o alvo de uma mutação sobre
 * PESSOA (apps/api/src/admin/routes.ts): sem isto, `users:write` sozinho
 * bastava para um master da empresa A mudar papel, desativar, renomear ou
 * apagar um usuário cujo único vínculo é a empresa B, bastando saber o uuid -
 * a permissão responde "esta pessoa pode administrar gente?", nunca "gente de
 * qual empresa?" (a mesma distinção que `GET /admin/users` já aplica via
 * `recorteDePessoasVisiveis`, e que faltava nas rotas de mutação).
 */
export async function userBelongsToTenant(userId: string, organizationId: string): Promise<boolean> {
  const [membro] = await db.select({ id: schema.organizationMembers.id }).from(schema.organizationMembers)
    .where(and(eq(schema.organizationMembers.userId, userId), eq(schema.organizationMembers.organizationId, organizationId)));
  return Boolean(membro);
}
