import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { requireAuth } from '../auth/middleware';
import { escopoDeOrganizacao } from '../lib/escopo-de-organizacao';

/**
 * CONSENTIMENTO DE INTEGRAÇÃO — a seção 19 do briefing.
 *
 * Antes de conectar uma fonte, quem responde pela empresa precisa ver, em
 * português de gente, o que o Desigual vai poder fazer com o dado dela. E
 * depois precisa conseguir descobrir de novo: quem autorizou, quando, e como
 * revogar.
 *
 * POR QUE ISTO EXISTE E NÃO É BUROCRACIA: o produto passou a se vender como
 * camada que LÊ a operação inteira de uma empresa — ClickUp, Claude, e o que
 * vier. Uma empresa cliente entregando isso sem um registro do que foi
 * combinado é um problema que só aparece no pior momento possível, que é
 * quando alguém pergunta "quem autorizou isso?".
 *
 * NÃO SUBSTITUI CONTRATO, DPA OU TERMOS. É consentimento técnico: o registro
 * operacional de uma decisão, com nome e data. A seção 19 é explícita sobre
 * isso, e a interface não deve usar linguagem jurídica fingindo ser o que não é.
 *
 * ONDE FICA GRAVADO: em `audit_logs`, que já tem organização, pessoa, ação,
 * data e metadata — e que já é a tabela onde "quem fez o quê" mora. Criar
 * tabela nova para isso seria inventar um segundo lugar para a mesma pergunta,
 * que é o defeito que este projeto passou o dia inteiro corrigindo.
 */

const ACAO = 'integration.consent';

/**
 * O que cada fonte alcança, em português. Não é texto de marketing: é a lista
 * do que a pessoa está autorizando, e precisa ser específica o bastante para
 * alguém discordar de um item.
 */
const PERMISSOES_POR_FONTE: Record<string, { nome: string; permite: string[] }> = {
  clickup: {
    nome: 'ClickUp',
    permite: [
      'ler tarefas, prazos, responsáveis e comentários das listas autorizadas',
      'criar e atualizar tarefas quando alguém pedir, pelo chat ou pelo Claude',
      'relacionar tarefas a clientes e pessoas da equipe',
    ],
  },
  claude: {
    nome: 'Claude (MCP)',
    permite: [
      'responder perguntas usando o conhecimento da empresa',
      'registrar o que for ensinado como memória da empresa',
      'executar ações que a pessoa pedir, dentro das permissões dela',
    ],
  },
  notion: {
    nome: 'Notion',
    permite: ['ler páginas e bancos autorizados', 'indexar o conteúdo para busca e resposta'],
  },
};

const registrarSchema = z.object({
  fontes: z.array(z.string().min(1)).min(1),
  /** O texto exato que a pessoa viu. Guardado para o registro não virar "ela concordou com algo". */
  texto_apresentado: z.string().min(10).max(8000),
});

export async function registerConsentRoutes(app: FastifyInstance): Promise<void> {
  /** O que será pedido, para a tela montar a pergunta sem inventar item. */
  app.get('/consent/fontes', { preHandler: requireAuth }, async () => ({
    fontes: Object.entries(PERMISSOES_POR_FONTE).map(([id, f]) => ({ id, ...f })),
    /**
     * O que o Desigual NÃO faz. Existe na resposta porque a promessa honesta
     * é tão importante quanto a permissão — a seção 64 é explícita: nunca
     * prometer "lemos todas as conversas do Claude".
     */
    nao_faz: [
      'ler conversas do Claude que não passaram por esta plataforma',
      'acessar fonte que não foi conectada aqui',
      'compartilhar dado de uma empresa com outra',
      'usar anotação marcada como privada de alguém, nem para administrador',
    ],
  }));

  /** O histórico: quem autorizou o quê, quando. */
  app.get('/consent', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const escopo = await escopoDeOrganizacao(user);
    const linhas = await db
      .select({
        id: schema.auditLogs.id,
        quando: schema.auditLogs.timestamp,
        metadata: schema.auditLogs.metadata,
        quem: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
      .where(
        and(
          eq(schema.auditLogs.action, ACAO),
          escopo.ehProvider
            ? undefined
            : sql`${schema.auditLogs.organizationId} in (
                select organization_id from organization_members where user_id = ${user.id}::uuid
              )`,
        ),
      )
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(50);

    return {
      consentimentos: linhas.map((l) => {
        const md = l.metadata as { fontes?: unknown; revogado?: unknown; texto_apresentado?: unknown };
        return {
          id: l.id,
          quando: l.quando?.toISOString() ?? null,
          quem: l.quem ?? l.email ?? null,
          fontes: Array.isArray(md.fontes) ? (md.fontes as string[]) : [],
          revogado: md.revogado === true,
          /** O texto exato que a pessoa leu. É o que torna o registro verificável. */
          texto_apresentado: typeof md.texto_apresentado === 'string' ? md.texto_apresentado : null,
        };
      }),
    };
  });

  /** Registra o aceite. */
  app.post('/consent', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const body = registrarSchema.parse(request.body);
    const desconhecidas = body.fontes.filter((f) => !PERMISSOES_POR_FONTE[f]);
    if (desconhecidas.length > 0) {
      reply.code(400);
      return { error: `Fonte desconhecida: ${desconhecidas.join(', ')}` };
    }

    const escopo = await escopoDeOrganizacao(user);
    const organizationId = escopo.organizationIds[0] ?? null;
    if (!organizationId) {
      reply.code(409);
      return { error: 'Esta conta não pertence a nenhuma empresa, então não há por quem consentir.' };
    }

    const [linha] = await db
      .insert(schema.auditLogs)
      .values({
        userId: user.id,
        organizationId,
        action: ACAO,
        result: 'success',
        source: 'app',
        metadata: {
          fontes: body.fontes,
          // O TEXTO EXATO que a pessoa viu. Sem isto, o registro diz "ela
          // concordou" sem dizer com o quê — e o que a tela mostra muda com o
          // tempo, então guardar só a data seria guardar metade.
          texto_apresentado: body.texto_apresentado,
        },
      })
      .returning({ id: schema.auditLogs.id, quando: schema.auditLogs.timestamp });

    return { id: linha?.id ?? null, quando: linha?.quando?.toISOString() ?? null };
  });
}
