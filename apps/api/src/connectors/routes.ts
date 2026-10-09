import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { z } from 'zod';
import {
  evolutionConnectInstance,
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionDeleteInstance,
  evolutionInstanceNameFor,
  resolveCommunicationProvider,
  resolveEvolutionAdminConfig,
  resolveEvolutionWebhookUrl,
} from '@desigual-os/tool-gateway';
import { requireAuth } from '../auth/middleware';
import type { AuthenticatedUser } from '../auth/middleware';
import { auditarAcao } from '../lib/auditoria';
import { podeConfigurar } from '../organizations/ficha';

/**
 * connectors/routes.ts — a plataforma de tarefas DE CADA empresa (white label).
 *
 * É a tela de "conecte seu ClickUp" (e amanhã Jira/Monday/Trello) da subconta.
 * O que se grava aqui é o que `resolveTaskProvider` (tool-gateway) lê no turno
 * para decidir com que credencial aquela empresa fala com a plataforma dela.
 *
 * QUEM MEXE: a MESMA regra da ficha da empresa (`podeConfigurar`) — o provedor
 * ou quem responde pela empresa (owner/admin). Um colaborador não troca a chave
 * que assina toda a operação da conta. Empresa alheia responde 404, nunca 403:
 * "existe mas não é sua" confirma a existência da empresa para quem não
 * deveria saber que ela existe.
 *
 * O SECRET NUNCA SAI DAQUI. Nenhum GET devolve `credentials` — só a máscara
 * (4 últimos caracteres da chave), suficiente pra pessoa reconhecer qual chave
 * está gravada sem que a chave circule pelo navegador, pelo log do proxy ou
 * pelo histórico do DevTools. O valor inteiro entra (PUT) e não sai.
 */

/** Campos de credencial que são SECRET — mascarados no GET. O resto (teamId,
 *  baseUrl...) é configuração visível, não segredo. */
const CAMPO_SECRETO = /key|token|secret|password/i;

function mascararCredenciais(credentials: unknown): Record<string, string> {
  if (credentials === null || typeof credentials !== 'object') return {};
  const mascarado: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(credentials as Record<string, unknown>)) {
    if (typeof valor !== 'string') continue;
    mascarado[campo] = CAMPO_SECRETO.test(campo)
      ? `••••${valor.slice(-4)}`
      : valor;
  }
  return mascarado;
}

/**
 * O shape que cada provider exige no `credentials` — a MESMA validação do
 * resolver (task-provider-resolver.ts), aplicada na entrada pra que uma
 * config quebrada falhe aqui, com a pessoa olhando, e não no turno seguinte.
 */
const CREDENCIAIS_POR_PROVIDER: Record<string, z.ZodType> = {
  clickup: z.object({
    apiKey: z.string().trim().min(1, 'A API key do ClickUp é obrigatória.'),
    teamId: z.string().trim().min(1, 'O team id do ClickUp é obrigatório.'),
  }),
  /**
   * WhatsApp — mais de UM vendor possível por trás do mesmo provider lógico
   * (07/10/2026, pedido explícito do usuário: trocar W-API por Stevo/Meta
   * Cloud API sem mexer no resto do produto). `vendor` discrimina qual
   * shape vale; a MESMA validação do resolver
   * (`communication-provider-resolver.ts`), nunca uma segunda cópia.
   */
  whatsapp: z.union([
    z.object({
      vendor: z.literal('evolution').default('evolution'),
      baseUrl: z.string().trim().url('A URL da instância Evolution é obrigatória.'),
      apiKey: z.string().trim().min(1, 'A API key da instância Evolution é obrigatória.'),
      instance: z.string().trim().min(1, 'O nome da instância Evolution é obrigatório.'),
    }),
    z.object({
      vendor: z.literal('wapi'),
      baseUrl: z.string().trim().url('A URL da W-API é obrigatória.'),
      instanceId: z.string().trim().min(1, 'O instanceId da W-API é obrigatório.'),
      token: z.string().trim().min(1, 'O token da W-API é obrigatório.'),
      webhookSecret: z.string().trim().min(1).optional(),
    }),
  ]),
};

interface ConectorDaOrg {
  id: string;
  provider: string;
  credentials: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function apresentacaoDo(c: ConectorDaOrg) {
  return {
    provider: c.provider,
    status: c.status,
    /** Máscara, nunca o valor. Ver o cabeçalho. */
    credentials: mascararCredenciais(c.credentials),
    created_at: c.createdAt ? new Date(c.createdAt).toISOString() : null,
    updated_at: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
  };
}

export async function registerConnectorRoutes(app: FastifyInstance): Promise<void> {
  /** Os três verbos partilham a mesma porta: autenticado + responde pela empresa. */
  async function portaria(
    request: { authUser?: AuthenticatedUser; params: unknown },
    _reply: { code: (n: number) => void },
  ): Promise<{ orgId: string; comoProvedor: boolean } | { erro: { status: number; body: { error: string } } }> {
    const user = request.authUser;
    if (!user) return { erro: { status: 401, body: { error: 'Not authenticated' } } };
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const permissao = await podeConfigurar(user, id);
    if (!permissao.pode) {
      return {
        erro: {
          status: permissao.motivo === 'Empresa não encontrada.' ? 404 : 403,
          body: { error: permissao.motivo ?? 'Sem permissão.' },
        },
      };
    }
    return { orgId: id, comoProvedor: permissao.comoProvedor };
  }

  /** A lista de conectores da empresa, mascarada. */
  app.get('/organizations/:id/connectors', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request, reply);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }

    const linhas = await db
      .select()
      .from(schema.organizationConnectors)
      .where(eq(schema.organizationConnectors.organizationId, acesso.orgId))
      .catch(() => [] as ConectorDaOrg[]);

    return { connectors: linhas.map(apresentacaoDo) };
  });

  /**
   * CONECTAR WHATSAPP POR QR CODE (07/10/2026) — a alternativa ao formulário
   * manual de baseUrl/apiKey/instance acima: a empresa escaneia o QR pelo
   * celular, igual ao WhatsApp Web, e a instância é criada/gerenciada por NÓS
   * (servidor Evolution self-hosted, docker-compose.yml), não por uma conta
   * externa que a empresa já tivesse que montar sozinha.
   *
   * Registrada ANTES de `/connectors/:provider` (rota estática primeiro,
   * mesma convenção de `clickup/routes.ts`): o Fastify já prioriza rota
   * estática sobre parametrizada, mas a ordem aqui deixa a intenção explícita.
   *
   * Idempotente: chamar de novo numa empresa já criada só pede um QR NOVO
   * (`/instance/connect`) em vez de tentar criar — nome de instância é
   * determinístico (`evolutionInstanceNameFor`), então "criar de novo" seria
   * só erro de duplicata sem propósito.
   */
  app.post('/organizations/:id/connectors/whatsapp/qr', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request, reply);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }

    const admin = resolveEvolutionAdminConfig();
    const webhookUrl = resolveEvolutionWebhookUrl();
    if (!admin || !webhookUrl) {
      reply.code(503);
      return { error: 'O servidor Evolution (WhatsApp) não está configurado neste ambiente.' };
    }

    const instanceName = evolutionInstanceNameFor(acesso.orgId);
    const [jaExiste] = await db
      .select({ id: schema.organizationConnectors.id })
      .from(schema.organizationConnectors)
      .where(and(eq(schema.organizationConnectors.organizationId, acesso.orgId), eq(schema.organizationConnectors.provider, 'whatsapp')))
      .catch(() => []);

    try {
      // Primeira vez (sem linha gravada ainda): cria a instância no servidor.
      // Depois disso (reconexão, sessão expirou): só pede QR novo da mesma
      // instância — criar de novo devolveria erro de nome duplicado à toa.
      const qr = jaExiste ? await evolutionConnectInstance(admin, instanceName) : await evolutionCreateInstance(admin, instanceName, webhookUrl);

      if (qr.base64 === null) {
        // Já conectada (ex.: a pessoa atualizou a página depois de escanear) — não há QR pra mostrar.
        return { qr_code_base64: null, already_connected: true };
      }
      return { qr_code_base64: qr.base64, already_connected: false };
    } catch (error) {
      reply.code(502);
      return { error: error instanceof Error ? error.message : 'Falha ao falar com o servidor Evolution.' };
    }
  });

  /**
   * POLLING de conexão — a tela chama isto a cada alguns segundos enquanto o
   * QR está na tela. Ao virar 'open', grava o conector (mesmo shape do
   * formulário manual: baseUrl/apiKey/instance) pela PRIMEIRA vez — é esse
   * registro que destrava `resolveCommunicationProvider` (envio de mensagem)
   * e o webhook (`connectorForWhatsappInstance`, recebimento).
   */
  app.get('/organizations/:id/connectors/whatsapp/status', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request, reply);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }

    const admin = resolveEvolutionAdminConfig();
    if (!admin) {
      reply.code(503);
      return { error: 'O servidor Evolution (WhatsApp) não está configurado neste ambiente.' };
    }

    const instanceName = evolutionInstanceNameFor(acesso.orgId);
    let estado: 'open' | 'connecting' | 'close';
    try {
      estado = await evolutionConnectionState(admin, instanceName);
    } catch (error) {
      reply.code(502);
      return { error: error instanceof Error ? error.message : 'Falha ao consultar o estado da instância.' };
    }

    if (estado === 'open') {
      const [existente] = await db
        .select({ id: schema.organizationConnectors.id })
        .from(schema.organizationConnectors)
        .where(and(eq(schema.organizationConnectors.organizationId, acesso.orgId), eq(schema.organizationConnectors.provider, 'whatsapp')))
        .catch(() => []);

      if (!existente) {
        const credentials = { baseUrl: admin.baseUrl, apiKey: admin.globalApiKey, instance: instanceName };
        await db.insert(schema.organizationConnectors).values({ organizationId: acesso.orgId, provider: 'whatsapp', credentials, status: 'ativa' });
        await auditarAcao(request, {
          organizationId: acesso.orgId,
          action: 'connector.configure',
          result: 'success',
          metadata: { provider: 'whatsapp', via: 'qr_code' },
          comoProvedor: acesso.comoProvedor,
        });
      }
    }

    return { state: estado, connected: estado === 'open' };
  });

  /**
   * SAÚDE DO CONECTOR JÁ GRAVADO (07/10/2026) — diferente da rota acima
   * (que só serve ao fluxo de criar uma instância Evolution do zero pelo
   * produto): esta aqui funciona pra QUALQUER vendor já vinculado (W-API
   * incluído, vinculado pelo formulário manual de PUT acima com a instância
   * que a empresa já conectou no painel dela). Chama `provider.health()` —
   * a MESMA interface que `sendMessage` usa, nunca uma segunda pergunta
   * "a instância está de pé?" com lógica própria por vendor.
   */
  app.get('/organizations/:id/connectors/whatsapp/health', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request, reply);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }

    let provider;
    try {
      provider = await resolveCommunicationProvider(acesso.orgId);
    } catch (error) {
      reply.code(502);
      return { error: error instanceof Error ? error.message : 'Conector do WhatsApp configurado incorretamente.' };
    }
    if (!provider) {
      return { connected: false, configured: false };
    }

    const saude = await provider.health();
    return { connected: saude.healthy, configured: true, detail: saude.detail ?? null };
  });

  /**
   * GRAVA (ou troca) o conector da empresa. Upsert por (org, provider): trocar
   * a chave é o mesmo gesto que conectar pela primeira vez, e a tabela tem o
   * unique que garante uma plataforma de cada por empresa.
   */
  app.put('/organizations/:id/connectors/:provider', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request, reply);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }

    const { provider } = z
      .object({ provider: z.string().trim().min(2).max(40) })
      .parse(request.params as Record<string, unknown>);

    const shape = CREDENCIAIS_POR_PROVIDER[provider];
    if (!shape) {
      reply.code(400);
      return { error: `A plataforma "${provider}" ainda não é suportada. Hoje: ${Object.keys(CREDENCIAIS_POR_PROVIDER).join(', ')}.` };
    }

    const corpo = z.object({ credentials: z.unknown() }).parse(request.body);
    const credenciais = shape.safeParse(corpo.credentials);
    if (!credenciais.success) {
      reply.code(400);
      return { error: credenciais.error.issues.map((i) => i.message).join(' ') };
    }

    const [existente] = await db
      .select({ id: schema.organizationConnectors.id })
      .from(schema.organizationConnectors)
      .where(
        and(
          eq(schema.organizationConnectors.organizationId, acesso.orgId),
          eq(schema.organizationConnectors.provider, provider),
        ),
      )
      .catch(() => []);

    if (existente) {
      await db
        .update(schema.organizationConnectors)
        // Trocar a chave também REATIVA: gravar de novo é a pessoa dizendo "volta".
        .set({ credentials: credenciais.data, status: 'ativa', updatedAt: new Date() })
        .where(eq(schema.organizationConnectors.id, existente.id));
    } else {
      await db.insert(schema.organizationConnectors).values({
        organizationId: acesso.orgId,
        provider,
        credentials: credenciais.data,
        status: 'ativa',
      });
    }

    await auditarAcao(request, {
      organizationId: acesso.orgId,
      action: 'connector.configure',
      result: 'success',
      metadata: { provider },
      comoProvedor: acesso.comoProvedor,
    });

    // Devolve a versão MASCARADA depois da gravação — o estado real que ficou,
    // não o eco do que a tela mandou (e nunca o secret).
    const [gravado] = await db
      .select()
      .from(schema.organizationConnectors)
      .where(
        and(
          eq(schema.organizationConnectors.organizationId, acesso.orgId),
          eq(schema.organizationConnectors.provider, provider),
        ),
      )
      .catch(() => [] as ConectorDaOrg[]);

    return gravado ? apresentacaoDo(gravado) : { provider, status: 'ativa' };
  });

  /** DESCONECTA: a empresa volta ao fallback de env (ou a nada, se ele não existir). */
  app.delete('/organizations/:id/connectors/:provider', { preHandler: requireAuth }, async (request, reply) => {
    const acesso = await portaria(request, reply);
    if ('erro' in acesso) {
      reply.code(acesso.erro.status);
      return acesso.erro.body;
    }

    const { provider } = z
      .object({ provider: z.string().trim().min(2).max(40) })
      .parse(request.params as Record<string, unknown>);

    const removidos = await db
      .delete(schema.organizationConnectors)
      .where(
        and(
          eq(schema.organizationConnectors.organizationId, acesso.orgId),
          eq(schema.organizationConnectors.provider, provider),
        ),
      )
      .returning({ id: schema.organizationConnectors.id })
      .catch(() => [] as { id: string }[]);

    if (removidos.length === 0) {
      reply.code(404);
      return { error: 'Conector não encontrado.' };
    }

    // WHATSAPP (07/10/2026): a instância é NOSSA (servidor Evolution self-
    // hosted), então desconectar pelo produto também apaga ela lá — senão o
    // número fica "conectado" pro servidor mesmo com a empresa achando que
    // saiu. Best-effort: o DELETE local já aconteceu (é o que importa pra
    // quem usa o produto); se o servidor Evolution estiver fora do ar, a
    // instância órfã é limpeza manual depois, não motivo pra esta rota falhar.
    if (provider === 'whatsapp') {
      const admin = resolveEvolutionAdminConfig();
      if (admin) {
        await evolutionDeleteInstance(admin, evolutionInstanceNameFor(acesso.orgId)).catch((error: unknown) => {
          request.log.warn({ error, organizationId: acesso.orgId }, 'Falha ao apagar a instância Evolution ao desconectar o WhatsApp, conector local já removido');
        });
      }
    }

    await auditarAcao(request, {
      organizationId: acesso.orgId,
      action: 'connector.remove',
      result: 'success',
      metadata: { provider },
      comoProvedor: acesso.comoProvedor,
    });

    return { ok: true };
  });
}
