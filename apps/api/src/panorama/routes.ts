import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '@desigual-os/database';
import { naturezaDoCliente } from '@desigual-os/context-engine';
import { requireAuth } from '../auth/middleware';
import { organizacaoProvedora } from '../lib/escopo-de-organizacao';
import { contextoCompletoDe } from '../organizations/contexto';

/**
 * O PANORAMA DA AGÊNCIA — a resposta de "como estamos?" numa chamada só.
 *
 * Existe porque quem é dono da agência não abre nove telas para montar a
 * conta na cabeça. Ele abre uma e quer saber: tem coisa atrasada? de quem?
 * a equipe está usando a inteligência? o sistema está entregando ou falhando?
 *
 * O QUE ELA COBRE, E O QUE NÃO: tudo aqui sai do NOSSO banco — carteira,
 * equipe, uso dos agentes, memória, sinais. Tarefa do ClickUp NÃO entra, e é
 * decisão, não esquecimento: a lista da agência é uma chamada externa que leva
 * segundos e falha sozinha, e pendurar a home nela faria o painel inteiro ficar
 * refém de um serviço de terceiro. Tarefa tem tela própria, que já busca ao
 * vivo e já sabe dizer quando o ClickUp não respondeu.
 *
 * DUAS REGRAS, e as duas nasceram de defeito real deste produto:
 *
 * 1. CARTEIRA É CARTEIRA. Fixture e frente interna não entram na contagem de
 *    cliente, pelo mesmo classificador que o resto do produto usa — foi assim
 *    que a grade já disse 58 enquanto o Overview dizia 49.
 *
 * 2. O QUE NÃO DÁ PRA MEDIR É DECLARADO. Não existe campo aqui preenchido por
 *    dedução: taxa de falha sobre zero pedido vem `null`, não `0%`.
 */
export async function registerPanoramaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/panorama', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    /**
     * O RECORTE É A EMPRESA DE TRABALHO, não "tudo que a pessoa alcança".
     *
     * Correção de 05/10/2026, do mesmo vazamento cross-tenant de `/memories`:
     * a CTE anterior deixava `organization_id IS NULL` entrar para QUALQUER um
     * ("senão os números encolhem sem ninguém entender por quê"). Com um
     * segundo tenant no banco, isso entregou o legado inteiro da Desigual —
     * clientes, execuções, memórias, sinais — dentro da conta de um cliente.
     * A regra decidida: NULL é legado da plataforma e entra SOMENTE quando a
     * empresa de trabalho é a provedora. Master dentro de um tenant vê só o
     * tenant.
     *
     * UMA ida ao banco para resolver a empresa de trabalho (contextoCompletoDe
     * junta vínculos + ativa + marca numa consulta — ver a nota de latência lá),
     * e a segunda é a CTE única abaixo. A armadilha medida continua valendo:
     * o pool tem três conexões, e somar viagens ANTES da consulta principal foi
     * o que derrubou esta rota duas vezes.
     */
    const contexto = await contextoCompletoDe(user);
    const deTrabalho = contexto.deTrabalho;
    if (!deTrabalho) {
      reply.code(403);
      return { error: 'Sem empresa de trabalho definida.' };
    }
    const orgDeTrabalho = deTrabalho.id;
    const legadoVisivel = organizacaoProvedora() === orgDeTrabalho;

    /**
     * UMA VIAGEM SÓ AO BANCO, e o motivo é medido.
     *
     * A primeira versão disparava SETE consultas em `Promise.all`. O pool desta
     * API tem TRÊS conexões (`DATABASE_POOL_MAX`, default 3, "o que sobra
     * dividindo 15 entre os processos locais"), e a home já faz seis chamadas
     * paralelas por conta própria. Resultado: a rota mais importante da tela
     * entrava na fila atrás dela mesma.
     *
     * Isolada ela respondia em 1,4s; com a suíte inteira rodando, o painel não
     * apareceu em 20 SEGUNDOS e o teste reprovou. Não era lentidão de consulta
     * — era contenção que eu mesmo criei.
     *
     * Agora é um `WITH` só: uma conexão, uma ida e volta. O Postgres agrega
     * isso sem suar; o caro sempre foi o pedágio de rede a ~130ms por consulta,
     * multiplicado por sete, multiplicado pela espera de conexão.
     */
    const bruto = await db.execute(sql`
      with
      /*
       * TODA CONTAGEM RECORTADA PELA EMPRESA DE TRABALHO, não só a de pessoas.
       *
       * A primeira versão recortou gente e deixou clientes, execuções,
       * memórias e sinais contando o banco inteiro. Invisível com uma
       * organização; com duas, seria vazamento por AGREGAÇÃO — a pessoa não vê
       * o dado do outro tenant, vê o TAMANHO dele, que já entrega carteira,
       * volume de operação e quanto a concorrência usa a plataforma.
       *
       * (Achado depois que a outra sessão encontrou o mesmo padrão no
       * get_health do MCP: três contagens sem filtro, invisíveis pelo mesmo
       * motivo. Número agregado não parece dado sensível até ser de outra
       * empresa.)
       *
       * organization_id is null entra SOMENTE no contexto da provedora
       * (o booleano interpolado em cada perna abaixo): são as linhas
       * anteriores à migração 0045 que não resolveram vínculo. Dentro de um
       * tenant, NULL fica de fora — ver o comentário no topo da rota.
       */
      cli as (
        select c.name from clients c
        where c.deleted_at is null
          and (c.organization_id = ${orgDeTrabalho}::uuid
               or (${legadoVisivel} and c.organization_id is null))
      ),
      exec_dia as (
        select created_at::date as dia,
               count(*)::int as total,
               count(*) filter (where status = 'completed')::int as ok,
               count(*) filter (where status = 'failed')::int as falhou
        from executions
        where created_at > now() - interval '14 days'
          and (organization_id = ${orgDeTrabalho}::uuid
               or (${legadoVisivel} and organization_id is null))
        group by 1 order by 1
      ),
      exec_agente as (
        select agent, count(*)::int as total
        from executions
        where created_at > now() - interval '30 days' and agent is not null
          and (organization_id = ${orgDeTrabalho}::uuid
               or (${legadoVisivel} and organization_id is null))
        group by 1 order by 2 desc
      ),
      gente as (
        select u.id, u.clickup_email from users u
        where u.active = true and u.deleted_at is null
          and (
            exists (
              select 1 from organization_members om
              where om.user_id = u.id and om.organization_id = ${orgDeTrabalho}::uuid
            )
            -- A própria pessoa sempre se vê, mesmo sem vínculo na empresa.
            or u.id = ${user.id}::uuid
          )
      ),
      ativos as (
        select distinct user_id from conversations
        where created_at > now() - interval '30 days' and user_id is not null
      )
      select
        (select coalesce(json_agg(name), '[]'::json) from cli) as clientes,
        (select coalesce(json_agg(row_to_json(exec_dia)), '[]'::json) from exec_dia) as serie,
        (select coalesce(json_agg(row_to_json(exec_agente)), '[]'::json) from exec_agente) as agentes,
        (select count(*)::int from gente) as pessoas,
        (select count(*)::int from gente where clickup_email is null) as sem_clickup,
        (select count(*)::int from gente g where exists (select 1 from ativos a where a.user_id = g.id)) as usando,
        (select count(*)::int from memories
          where status = 'active' and environment = 'production'
            and (organization_id = ${orgDeTrabalho}::uuid
                 or (${legadoVisivel} and organization_id is null))) as memorias,
        (select count(*)::int from proactive_signals
          where status = 'pending'
            and (organization_id = ${orgDeTrabalho}::uuid
                 or (${legadoVisivel} and organization_id is null))) as sinais
    `);

    const linha = bruto[0] as {
      clientes: string[];
      serie: Array<{ dia: string; total: number; ok: number; falhou: number }>;
      agentes: Array<{ agent: string; total: number }>;
      pessoas: number;
      sem_clickup: number;
      usando: number;
      memorias: number;
      sinais: number;
    };

    const clientes = (linha.clientes ?? []).map((name) => ({ name }));
    const execucoesPorDia = linha.serie ?? [];
    const execucoesPorAgente = linha.agentes ?? [];

    const carteira = clientes.filter((c) => naturezaDoCliente(c.name) === 'CLIENTE').length;
    const totalExec = execucoesPorAgente.reduce((s, a) => s + a.total, 0);
    const totalFalhas = execucoesPorDia.reduce((s, d) => s + d.falhou, 0);
    const totalDias = execucoesPorDia.reduce((s, d) => s + d.total, 0);

    return {
      carteira: {
        clientes: carteira,
        internos: clientes.filter((c) => naturezaDoCliente(c.name) === 'INTERNO').length,
      },
      equipe: {
        pessoas: linha.pessoas,
        usando: linha.usando,
        /**
         * Sem vínculo com o ClickUp o trabalho da pessoa é invisível para
         * qualquer consulta do sistema. É um número de gestão, não de cadastro.
         */
        sem_clickup: linha.sem_clickup,
      },
      inteligencia: {
        pedidos_30d: totalExec,
        por_agente: execucoesPorAgente.map((a) => ({ agente: a.agent, total: a.total })),
        serie_14d: execucoesPorDia,
        /**
         * `null` quando não houve pedido nenhum na janela. Zero por cento de
         * falha sobre zero pedido não é saúde, é ausência de dado — e um painel
         * que pinta isso de verde ensina a confiar no verde errado.
         */
        taxa_de_falha_14d: totalDias > 0 ? Math.round((totalFalhas / totalDias) * 100) : null,
      },
      conhecimento: {
        memorias: linha.memorias,
      },
      atencao: {
        sinais_abertos: linha.sinais,
      },
      gerado_em: new Date().toISOString(),
    };
  });
}
