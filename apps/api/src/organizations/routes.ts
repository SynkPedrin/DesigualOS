import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { criarEmpresa } from './criar';
import { trocarOrganizacaoAtiva } from './contexto';
import { configurarEmpresa, fichaDaEmpresa, podeConfigurar } from './ficha';
import { ehPapelDePlataforma, escopoDeOrganizacao, organizacaoProvedora } from '../lib/escopo-de-organizacao';

/**
 * AS EMPRESAS — a tela que a seção 60 do briefing pede para o Master.
 *
 * Responde "como está cada empresa que eu atendo": quantas pessoas, quanto da
 * carteira, quando foi a última atividade. É o ponto de entrada do provedor
 * para abrir um tenant.
 *
 * QUEM VÊ: só quem opera no nível da plataforma. E "nível da plataforma" NÃO é
 * "tem papel forte" — é papel forte E pertencer à organização provedora, as
 * duas condições juntas. Sem isso, o administrador de um cliente enxergaria a
 * lista de todos os clientes do provedor, que é a carteira comercial inteira.
 *
 * Quem não é provider recebe 403, e não uma lista com a própria empresa: uma
 * lista de um item não é uma tela de empresas, é um espelho que sugere um poder
 * que a pessoa não tem.
 *
 * TUDO NUMA CONSULTA SÓ, e é decisão medida: o pool desta API tem três
 * conexões, e eu já derrubei o /panorama duas vezes hoje somando perguntas
 * antes da principal. Uma tela de N empresas com uma consulta por empresa seria
 * a mesma armadilha, multiplicada por N.
 */
/** O corpo do formulário de criar empresa. */
const criarSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(60).optional(),
  cor_primaria: z.string().trim().max(32).optional().nullable(),
  cor_secundaria: z.string().trim().max(32).optional().nullable(),
  logo_url: z.string().trim().url().max(500).optional().nullable(),
  nome_assistente: z.string().trim().max(60).optional().nullable(),
  email_do_dono: z.string().trim().email().max(200).optional().nullable(),
});

export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * CRIAR EMPRESA — o que faltava para isto ser um produto e não uma tabela.
   *
   * Só o provedor cria. Um tenant não cria outro tenant: quem vende a
   * plataforma é a Desigual, e um cliente poder abrir empresas seria o mesmo
   * que um inquilino emitir chaves do prédio.
   */
  app.post('/organizations', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const provedora = organizacaoProvedora();
    const escopo = await escopoDeOrganizacao(user);
    if (!escopo.ehProvider || !provedora) {
      reply.code(403);
      return { error: 'Só o provedor da plataforma cria empresas.' };
    }

    const body = criarSchema.parse(request.body);

    try {
      const criada = await criarEmpresa({
        nome: body.nome,
        slug: body.slug ?? body.nome,
        criadoPor: user.id,
        corPrimaria: body.cor_primaria ?? null,
        corSecundaria: body.cor_secundaria ?? null,
        logoUrl: body.logo_url ?? null,
        nomeAssistente: body.nome_assistente ?? null,
        emailDoDono: body.email_do_dono ?? null,
      });
      reply.code(201);
      return criada;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      /**
       * Slug repetido é o erro mais provável e precisa de uma frase que a
       * pessoa entenda — "duplicate key value violates unique constraint" não
       * ajuda ninguém a escolher outro nome.
       */
      if (mensagem.includes('duplicate key') || mensagem.includes('unique')) {
        reply.code(409);
        return { error: 'Já existe uma empresa com esse identificador. Escolha outro.' };
      }
      request.log.error({ erro }, '[organizations] falha ao criar empresa');
      reply.code(400);
      return { error: mensagem };
    }
  });

  /**
   * ENTRAR NUMA EMPRESA, ou sair dela.
   *
   * `organization_id: null` volta ao contexto do provedor.
   *
   * É POST e não um parâmetro de leitura porque MUDA ESTADO — e estado de
   * autorização, ainda por cima. Um GET que troca o contexto seria disparável
   * por um link, uma imagem ou um preview de mensageiro.
   */
  app.post('/organizations/ativa', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const body = z.object({ organization_id: z.string().uuid().nullable() }).parse(request.body);
    const r = await trocarOrganizacaoAtiva(user, body.organization_id);

    if (!r.ok) {
      reply.code(403);
      return { error: r.motivo };
    }
    return { organizacao_ativa: r.organizacao };
  });

  app.get('/organizations', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const provedora = organizacaoProvedora();
    if (!ehPapelDePlataforma(user.roles) || !provedora) {
      reply.code(403);
      return { error: 'Só o provedor enxerga a lista de empresas' };
    }

    const pertence = await db
      .execute(
        sql`select 1 from organization_members where user_id = ${user.id}::uuid and organization_id = ${provedora}::uuid limit 1`,
      )
      .then((r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])).length > 0)
      .catch(() => false);

    if (!pertence) {
      reply.code(403);
      return { error: 'Só o provedor enxerga a lista de empresas' };
    }

    const bruto: unknown = await db.execute(sql`
      select
        o.id,
        o.name,
        (select count(*)::int from organization_members om where om.organization_id = o.id) as pessoas,
        (select count(*)::int from clients c
          where c.organization_id = o.id and c.deleted_at is null) as clientes,
        (select max(m.created_at) from messages m where m.organization_id = o.id) as ultima_atividade,
        (select count(*)::int from memories mem
          where mem.organization_id = o.id and mem.status = 'active') as memorias,
        (o.id = ${provedora}::uuid) as eh_provedora
      from organizations o
      order by (o.id = ${provedora}::uuid) desc, o.name
    `);

    const linhas = ((bruto as { rows?: unknown[] }).rows ?? (bruto as unknown[])) as Array<{
      id: string;
      name: string;
      pessoas: number;
      clientes: number;
      ultima_atividade: string | null;
      memorias: number;
      eh_provedora: boolean;
    }>;

    return {
      organizations: linhas.map((o) => ({
        id: o.id,
        name: o.name,
        eh_provedora: o.eh_provedora,
        pessoas: o.pessoas,
        clientes: o.clientes,
        memorias: o.memorias,
        /**
         * `null` = nenhuma mensagem registrada para aquela empresa. A tela diz
         * "sem atividade ainda", nunca uma data inventada nem "agora".
         */
        ultima_atividade: o.ultima_atividade ? new Date(o.ultima_atividade).toISOString() : null,
      })),
      gerado_em: new Date().toISOString(),
    };
  });

  /**
   * A FICHA DE UMA EMPRESA — o que havia entre "a empresa existe" e "a empresa
   * é utilizável", e que não existia até aqui.
   *
   * Até 30/09/2026 a API tinha criar, listar e entrar. Entrar numa empresa
   * levava a um lugar onde nada podia ser ajustado: nem o nome, nem o
   * identificador, nem quem trabalha lá. Uma conta imutável é um cadastro, não
   * uma conta de cliente.
   *
   * É `/:id` e não "a empresa ativa" de propósito: configurar não é a mesma
   * ação que estar dentro. O provedor precisa poder ajustar a conta de um
   * cliente sem antes virar aquele cliente — e, ao contrário, estar dentro de
   * uma empresa não deveria dar poder de reescrever a identidade dela a quem
   * só trabalha lá.
   */
  app.get('/organizations/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const permissao = await podeConfigurar(user, id);
    if (!permissao.pode) {
      reply.code(permissao.motivo === 'Empresa não encontrada.' ? 404 : 403);
      return { error: permissao.motivo };
    }

    const ficha = await fichaDaEmpresa(id, organizacaoProvedora());
    if (!ficha) {
      reply.code(404);
      return { error: 'Empresa não encontrada.' };
    }

    return { ...ficha, como_provedor: permissao.comoProvedor };
  });

  app.patch('/organizations/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const permissao = await podeConfigurar(user, id);
    if (!permissao.pode) {
      reply.code(permissao.motivo === 'Empresa não encontrada.' ? 404 : 403);
      return { error: permissao.motivo };
    }

    /**
     * `.optional()` e NÃO `.nullish()` no nome, no slug e no status: esses três
     * não têm "vazio" como estado válido. Os de identidade aceitam `null`
     * porque apagar a cor ou a mensagem de boas-vindas é uma escolha legítima
     * — volta ao padrão do produto.
     */
    const corpo = z
      .object({
        nome: z.string().optional(),
        slug: z.string().optional(),
        nome_assistente: z.string().nullish(),
        mensagem_boas_vindas: z.string().max(400).nullish(),
        cor_primaria: z.string().nullish(),
        cor_secundaria: z.string().nullish(),
        logo_url: z.string().nullish(),
        status: z.enum(['ativa', 'suspensa']).optional(),
      })
      .parse(request.body);

    const r = await configurarEmpresa(id, corpo, organizacaoProvedora());
    if (!r.ok) {
      reply.code(400);
      return { error: r.motivo };
    }

    // Devolve a ficha inteira, não um `{ok:true}`: a tela precisa do estado
    // REAL depois da gravação (o slug normalizado, por exemplo, raramente é o
    // que foi digitado) em vez de supor que o que ela mandou foi o que ficou.
    const ficha = await fichaDaEmpresa(id, organizacaoProvedora());
    await db
      .execute(
        sql`insert into audit_logs (user_id, organization_id, action, result, source, metadata)
            values (${user.id}::uuid, ${id}::uuid, 'organization.configure', 'success', 'app',
                    ${JSON.stringify({ campos: Object.keys(corpo), como_provedor: permissao.comoProvedor })}::jsonb)`,
      )
      .catch(() => undefined);

    return ficha;
  });
}
