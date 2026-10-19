import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLogger } from '@desigual-os/logging';
import type { ResumoDeHoje, SecoesDoResumoDeHoje } from '@desigual-os/types';
import { requireAuth } from '../auth/middleware';

const logger = createLogger({ service: 'today-summary' });

/**
 * O RESUMO DA TELA "HOJE" — uma chamada no lugar das treze.
 *
 * Medido em 13/10/2026: a tela /today abria 13 a 15 requisições simultâneas
 * contra um pool de três conexões com o Supabase remoto (~270ms de piso por
 * rota que toca o banco), e assentava em 8 a 11 segundos. Este endpoint não
 * cria dado nenhum: ele chama, por `app.inject`, as MESMAS rotas que a tela
 * já chamava — mesmo auth, mesmo `requireTenant`, mesmo recorte de
 * organização, mesmo formato de payload — e devolve cada resposta na própria
 * seção. O que some é a viagem (12 idas e vindas HTTP e a fila do navegador),
 * não a regra: toda a autorização continua acontecendo na rota de origem.
 *
 * DUAS DECISÕES, as duas nascidas de defeito real:
 *
 * 1. FALHA PARCIAL NUNCA É 500 INTEIRO. As seções correm em
 *    `Promise.allSettled` e cada uma volta como `ResultadoDeSecao`: `ok: true`
 *    com o payload, ou `ok: false` com o status que a rota original devolveu.
 *    O status é preservado de propósito — o 409 de "ClickUp não vinculado" e
 *    o 400 de "nenhum ClickUp conectado" são estados esperados com conserto
 *    na tela, e uma lista vazia real (`ok: true`, `[]`) nunca pode parecer
 *    falha de leitura, nem o contrário.
 *
 * 2. "HOJE" É DO FUSO DE QUEM OLHA. O intervalo do calendário chega na query
 *    (`from`/`to`, ISO) calculado no navegador; o servidor não adivinha o dia
 *    no fuso dele. O dia navegável da tira da semana continua fora daqui — a
 *    tela busca `/calendar/events` direto quando a pessoa sai de hoje.
 */

/** O mesmo teto das rotas paginadas (default 30 nos três schemas de lista) —
 *  declarado aqui pra tela continuar sabendo dizer "30+" quando a página vem
 *  cheia (ver lib/teto-de-pagina.ts no web). */
const TETO_DE_PAGINA = 30;
/** As 4 conversas do painel "Conversas recentes" (RECENTES_NO_RODAPE na página). */
const RECENTES_NO_RODAPE = 4;
/** Quanto uma seção pode levar antes de virar falha só dela. */
const SECAO_TETO_MS = 8_000;

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export async function registerTodayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/today/summary', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const q = querySchema.parse(request.query);

    /**
     * As subchamadas herdam a credencial e a empresa de trabalho escolhida —
     * sem o `x-organization-id` repassado, o agregado leria uma empresa e as
     * seções outra quando o provedor opera dentro da conta de um cliente.
     */
    const headers: Record<string, string> = {};
    if (request.headers.authorization) headers['authorization'] = request.headers.authorization;
    const organizacaoPedida = request.headers['x-organization-id'];
    if (typeof organizacaoPedida === 'string') headers['x-organization-id'] = organizacaoPedida;

    const pedidos: { [K in keyof SecoesDoResumoDeHoje<unknown, unknown, unknown, unknown, unknown, unknown, unknown>]: string } = {
      me: '/me',
      minhas_tarefas: '/clickup/tasks/me',
      tarefas_da_agencia: '/clickup/tasks/agency',
      conversas_aguardando: `/inbox/threads?status=waiting_agency&limit=${TETO_DE_PAGINA}`,
      conversas_aguardando_minhas: `/inbox/threads?status=waiting_agency&assigned=me&limit=${TETO_DE_PAGINA}`,
      conversas_recentes: `/inbox/threads?assigned=me&limit=${RECENTES_NO_RODAPE}`,
      eventos_hoje: `/calendar/events?from=${encodeURIComponent(q.from)}&to=${encodeURIComponent(q.to)}`,
      aprovacoes_pendentes: `/approvals?status=pending&limit=${TETO_DE_PAGINA}`,
      // O dono é quem chamou — a tela não precisa mais esperar o /me pra pedir
      // as próprias demandas (a espera era uma segunda viagem jogada fora).
      minhas_demandas: `/demands?ownerId=${user.id}&limit=${TETO_DE_PAGINA}`,
      clientes: '/clients',
    };

    const entradas = Object.entries(pedidos);
    // Teto por seção: uma seção lenta ou presa vira falha só dela, nunca a
    // tela inteira esperando até o navegador desistir aos 30 s (19/10/2026:
    // uma subchamada presa derrubava os quatro cartões de uma vez).
    const resultados = await Promise.allSettled(
      entradas.map(([nome, url]) => Promise.race([
        app.inject({ method: 'GET', url, headers }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`seção ${nome} passou de ${SECAO_TETO_MS} ms`)), SECAO_TETO_MS)),
      ])),
    );

    type Secoes = SecoesDoResumoDeHoje<unknown, unknown, unknown, unknown, unknown, unknown, unknown>;
    // `pedidos` cobre todas as chaves por construção (o tipo acima o exige), e
    // o laço abaixo preenche uma entrada por pedido — o objeto sai completo.
    const secoes = {} as Secoes;
    entradas.forEach(([nome], i) => {
      const resultado = resultados[i]!;
      if (resultado.status === 'rejected') {
        // O inject em si explodir é o caso que não devolve resposta nenhuma —
        // vira falha de seção, nunca 500 do resumo inteiro.
        logger.warn({ error: resultado.reason, secao: nome }, 'Seção do resumo de hoje falhou sem resposta');
        secoes[nome as keyof Secoes] = { ok: false, status: String(resultado.reason).includes('passou de') ? 504 : 500 };
        return;
      }
      const res = resultado.value;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        secoes[nome as keyof Secoes] = { ok: true, dados: res.json() };
      } else {
        secoes[nome as keyof Secoes] = { ok: false, status: res.statusCode };
      }
    });

    return {
      ...secoes,
      gerado_em: new Date().toISOString(),
    } satisfies ResumoDeHoje;
  });
}
