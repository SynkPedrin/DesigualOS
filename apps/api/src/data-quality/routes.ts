import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import {
  candidatasADuplicata,
  naturezaDoCliente,
  ordenarAlertas,
  pareceArtefatoDeTeste,
  procedenciaDe,
  type AlertaDeQualidade,
} from '@desigual-os/context-engine';
import { requireAuth } from '../auth/middleware';
import { escopoDeOrganizacao } from '../lib/escopo-de-organizacao';

/**
 * QUALIDADE DO DADO — o que está torto no acervo, medido a cada chamada.
 *
 * Os defeitos que mais custaram a este produto não foram bugs de código: foram
 * dados que pareciam outra coisa. Fixture contada como cliente (58 x 49),
 * artefato de aceite gravado como decisão de produção, memória sem
 * proveniência, cadastro duplicado. Nenhum quebra nada — todos fazem o sistema
 * responder com confiança uma coisa errada.
 *
 * ESTA ROTA NÃO CONSERTA NADA, e é decisão: merge de cadastro é irreversível e
 * uma heurística errada custa um cliente real. Ela aponta, conta e dá o que
 * fazer. Quem resolve é gente.
 *
 * SÓ MASTER. Não por sigilo — por foco: é uma tela de manutenção do acervo, e
 * quem opera não precisa carregar a lista de pendências do cadastro.
 */
export async function registerDataQualityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/data-quality', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    if (!user.roles.includes('master')) {
      reply.code(403);
      return { error: 'Data quality é visível só para master' };
    }

    /**
     * RECORTE POR EMPRESA, inclusive numa tela de manutenção.
     *
     * A rota contava o acervo INTEIRO do banco: clientes, memórias, episódios.
     * Com duas empresas, quem abrisse isto veria quantos clientes e quanto
     * conhecimento a outra tem — vazamento por AGREGAÇÃO, o mesmo padrão que
     * apareceu no /panorama e no get_health do MCP no mesmo dia. Número
     * agregado não parece dado sensível até ser de outra empresa.
     *
     * `organization_id is null` continua entrando: são as linhas anteriores à
     * migração 0045 sem vínculo resolvido, e justamente as que esta tela existe
     * para apontar.
     */
    const escopo = await escopoDeOrganizacao(user);
    const daMinhaEmpresa = (coluna: unknown) =>
      escopo.ehProvider
        ? undefined
        : sql`(${coluna} is null or ${coluna} in (
            select organization_id from organization_members where user_id = ${user.id}::uuid
          ))`;

    const clientes = await db
      .select({ id: schema.clients.id, name: schema.clients.name, clickupListId: schema.clients.clickupListId })
      .from(schema.clients)
      .where(and(isNull(schema.clients.deletedAt), daMinhaEmpresa(schema.clients.organizationId)));

    const memorias = await db
      .select({
        id: schema.memories.id,
        content: schema.memories.content,
        sourceType: schema.memories.sourceType,
        environment: schema.memories.environment,
        clientId: schema.memories.clientId,
      })
      .from(schema.memories)
      .where(daMinhaEmpresa(schema.memories.organizationId));

    const episodios = await db
      .select({
        id: schema.agentEpisodes.id,
        summary: schema.agentEpisodes.summary,
        environment: schema.agentEpisodes.environment,
      })
      .from(schema.agentEpisodes)
      .where(daMinhaEmpresa(schema.agentEpisodes.organizationId));

    const idsDeCliente = new Set(clientes.map((c) => c.id));

    const duplicatas = candidatasADuplicata(clientes);
    const semLista = clientes.filter((c) => !c.clickupListId && naturezaDoCliente(c.name) === 'CLIENTE');
    const fixturesNaCarteira = clientes.filter((c) => naturezaDoCliente(c.name) === 'FIXTURE');

    const memoriasDeTesteEmProducao = memorias.filter(
      (m) => m.environment === 'production' && pareceArtefatoDeTeste(m.content),
    );
    const episodiosDeTesteEmProducao = episodios.filter(
      (e) => e.environment === 'production' && pareceArtefatoDeTeste(e.summary),
    );
    const semProveniencia = memorias.filter((m) => procedenciaDe(m.sourceType) === 'DESCONHECIDA');
    const orfas = memorias.filter((m) => m.clientId && !idsDeCliente.has(m.clientId));

    const alertas: AlertaDeQualidade[] = [
      {
        codigo: 'ARTEFATO_DE_TESTE_EM_PRODUCAO',
        titulo: 'Registro de teste gravado como produção',
        oQueFazer:
          'Reclassificar como environment=TEST, não apagar: o histórico do aceite continua auditável e para de contar como conhecimento da agência.',
        quantos: memoriasDeTesteEmProducao.length + episodiosDeTesteEmProducao.length,
        // ALTO porque é o único que faz o sistema AFIRMAR algo falso: uma
        // frase de aceite aparece como decisão da operação.
        gravidade: 'ALTO',
        exemplos: [...memoriasDeTesteEmProducao, ...episodiosDeTesteEmProducao]
          .slice(0, 4)
          .map((x) => ('content' in x ? x.content : x.summary).slice(0, 90)),
      },
      {
        codigo: 'DUPLICATA',
        titulo: 'Mesma entidade cadastrada mais de uma vez',
        oQueFazer:
          'Escolher a linha canônica e apontar a outra como alias. Sem merge automático: heurística errada custa um cliente real.',
        quantos: duplicatas.length,
        gravidade: 'ALTO',
        exemplos: duplicatas.slice(0, 4).map((d) => d.entidades.map((e) => e.name).join('  ↔  ')),
      },
      {
        codigo: 'CLIENTE_SEM_LISTA',
        titulo: 'Cliente da carteira sem lista do ClickUp',
        oQueFazer:
          'Vincular a lista. Sem ela, o cliente existe no cadastro e NENHUMA consulta de operação o alcança — é invisível em silêncio.',
        quantos: semLista.length,
        gravidade: 'ALTO',
        exemplos: semLista.slice(0, 5).map((c) => c.name),
      },
      {
        codigo: 'SEM_PROVENIENCIA',
        titulo: 'Memória sem origem registrada',
        oQueFazer:
          'Não dá pra conferir o que não se sabe de onde veio. Vale preencher na origem (quem escreve) antes que o acervo cresça mais.',
        quantos: semProveniencia.length,
        gravidade: 'MEDIO',
        exemplos: semProveniencia.slice(0, 3).map((m) => m.content.slice(0, 90)),
      },
      {
        codigo: 'FIXTURE_NA_CARTEIRA',
        titulo: 'Fixture de teste no cadastro de clientes',
        oQueFazer:
          'Já não conta como carteira em lugar nenhum do produto. Apagar é opcional e é decisão de quem cuida do cadastro.',
        quantos: fixturesNaCarteira.length,
        gravidade: 'BAIXO',
        exemplos: fixturesNaCarteira.map((c) => c.name),
      },
      {
        codigo: 'MEMORIA_ORFA',
        titulo: 'Memória apontando para cliente que não existe',
        oQueFazer: 'Reapontar ou arquivar: ela nunca vai ser recuperada por ninguém.',
        quantos: orfas.length,
        gravidade: 'MEDIO',
        exemplos: orfas.slice(0, 3).map((m) => m.content.slice(0, 90)),
      },
    ];

    return {
      /**
       * O retrato do acervo. Serve pra pessoa saber o TAMANHO do que está
       * olhando — 14 registros tortos em 489 é diferente de 14 em 20.
       */
      acervo: {
        clientes: clientes.length,
        carteira: clientes.filter((c) => naturezaDoCliente(c.name) === 'CLIENTE').length,
        internos: clientes.filter((c) => naturezaDoCliente(c.name) === 'INTERNO').length,
        fixtures: fixturesNaCarteira.length,
        memorias: memorias.length,
        memorias_producao: memorias.filter((m) => m.environment === 'production').length,
        episodios: episodios.length,
        episodios_producao: episodios.filter((e) => e.environment === 'production').length,
      },
      alertas: ordenarAlertas(alertas),
      duplicatas: duplicatas.map((d) => ({
        tipo: d.tipo,
        entidades: d.entidades.map((e) => ({ id: e.id, name: e.name })),
      })),
      generated_at: new Date().toISOString(),
    };
  });
}
