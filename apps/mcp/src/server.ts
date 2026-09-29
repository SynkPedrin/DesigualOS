import './env.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createLogger } from '@desigual-os/logging';
import type { ProviderSet } from '@desigual-os/mcp-domain';
import { DesigualOAuthProvider } from './auth/oauth-provider.js';
import { abrirSessao, resolverPrincipal } from './auth/principal.js';
import { ClickUpTaskProvider } from './providers/clickup-task-provider.js';
import { JarbasTrafficProvider } from './providers/jarbas-traffic-provider.js';
import { StudioAssetProvider } from './providers/studio-asset-provider.js';
import { registrarToolsDeIdentidadeEClientes } from './tools/identity-clients.js';
import { registrarToolsDeTarefa } from './tools/tasks.js';
import { registrarToolsDeMemoriaEEventos } from './tools/memory-events.js';
import { registrarToolsDeOperacao } from './tools/operation.js';
import type { ContextoDaTool } from './tools/kit.js';
import { renderConsentPage } from './consent-page.js';

/**
 * server.ts — o DESIGUAL OS MCP.
 *
 * Processo SEPARADO da API do app, de propósito (ver
 * docs/architecture/desigual-os-mcp.md, C.1): esta é superfície pública com
 * modelo de autorização próprio, e um incidente aqui não pode derrubar o
 * aplicativo que a equipe usa para trabalhar. Os dois compartilham
 * `packages/*` — o core é o mesmo, a porta é outra.
 *
 * O §18 em uma linha: NENHUMA chamada a LLM acontece neste processo. O Claude
 * do funcionário já é o modelo; aqui só há dado e operação determinística.
 */

const logger = createLogger({ service: 'desigual-mcp' });
const PORTA = Number(process.env.MCP_PORT ?? 3010);
const URL_PUBLICA_BASE = process.env.MCP_PUBLIC_URL ?? `http://localhost:${PORTA}`;
const URL_PUBLICA = URL_PUBLICA_BASE;
/**
 * A tela de consentimento mora NESTE servidor por padrão (ver consent-page.ts):
 * depender do app web para conectar adiciona uma peça de deploy entre o
 * funcionário e a conexão. `MCP_CONSENT_URL` continua existindo para o dia em
 * que o app web quiser assumir o fluxo.
 */
const URL_CONSENTIMENTO = process.env.MCP_CONSENT_URL ?? `${URL_PUBLICA_BASE}/consent`;

function exigirEnv(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    logger.error({ variavel: nome }, 'Variável obrigatória ausente — recusando subir');
    process.exit(1);
  }
  return v;
}

const oauth = new DesigualOAuthProvider({
  supabaseUrl: exigirEnv('SUPABASE_URL'),
  consentUrl: URL_CONSENTIMENTO,
  resourceUrl: `${URL_PUBLICA}/mcp`,
  logger,
});

/**
 * O contexto da chamada em curso.
 *
 * Express não entrega o request às tools do SDK, então a ponte é este
 * AsyncLocalStorage-equivalente simples: um valor por requisição, setado antes
 * de entregar ao transporte e limpo depois. Não é elegante; é correto, e o
 * alternativo (variável de módulo sem escopo) misturaria principais entre
 * requisições concorrentes — que seria vazamento entre funcionários.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
const contextoDaRequisicao = new AsyncLocalStorage<ContextoDaTool>();

function montarServidor(): McpServer {
  const server = new McpServer(
    { name: 'desigual-os', version: '0.1.0' },
    {
      instructions:
        'Desigual OS: o sistema operacional da Agência Desigual. Use estas ferramentas para saber o estado real da ' +
        'operação (clientes, tarefas, prazos, responsáveis), para recuperar a memória institucional da agência ' +
        '(decisões, preferências de cliente, aprendizados) e para registrar o que foi decidido ou concluído. ' +
        'Chame get_current_user no início para saber com quem está falando e o que essa pessoa pode fazer. ' +
        'Antes de criar uma tarefa, procure se ela já existe. Registre só conhecimento confirmado, nunca hipótese.',
    },
  );

  const deps = { server, contextoDaChamada: () => contextoDaRequisicao.getStore() ?? null };
  registrarToolsDeIdentidadeEClientes(deps);
  registrarToolsDeTarefa(deps);
  registrarToolsDeMemoriaEEventos(deps);
  registrarToolsDeOperacao(deps);
  return server;
}

function montarProviders(organizationId: string): ProviderSet {
  const config = {
    apiKey: process.env.CLICKUP_API_KEY ?? '',
    teamId: process.env.CLICKUP_TEAM_ID ?? '',
  };
  return {
    tasks: new ClickUpTaskProvider({
      config,
      organizationId,
      // O MCP escreve como a integração, com a permissão já conferida pelo
      // scope + papel. A checagem de RBAC acontece ANTES, no kit das tools.
      seniorContext: { permissions: [{ resource: 'clickup', action: 'write' }] } as never,
    }),
    traffic: new JarbasTrafficProvider({ organizationId }),
    assets: new StudioAssetProvider({ organizationId }),
  };
}

async function main(): Promise<void> {
  const app = express();
  app.use(cors({ origin: true, exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'] }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'desigual-os-mcp', version: '0.1.0', timestamp: new Date().toISOString() });
  });

  /**
   * Endpoints OAuth do SDK: discovery, /authorize, /token, /register, /revoke.
   * Usamos os do SDK em vez de escrever os nossos porque eles são a referência
   * do protocolo — divergir aqui só criaria incompatibilidade sutil com o
   * cliente do Claude.
   */
  app.use(
    mcpAuthRouter({
      provider: oauth,
      issuerUrl: new URL(URL_PUBLICA),
      baseUrl: new URL(URL_PUBLICA),
      serviceDocumentationUrl: new URL('https://github.com/desigual/desigual-os'),
    }),
  );

  /**
   * A TELA. O `/authorize` do SDK redireciona para cá com o id do pedido; aqui
   * o funcionário entra com a conta dele do Desigual OS e autoriza.
   */
  app.get('/consent', (req, res) => {
    const pedido = typeof req.query.mcp_request === 'string' ? req.query.mcp_request : '';
    if (!pedido) {
      res.status(400).send('Pedido de autorização ausente. Volte ao Claude e conecte de novo.');
      return;
    }
    const scopes = typeof req.query.scopes === 'string' && req.query.scopes.trim()
      ? req.query.scopes.trim().split(/\s+/)
      : ['desigual.read'];
    res.type('html').send(
      renderConsentPage({
        requestId: pedido,
        clientName: typeof req.query.client_name === 'string' ? req.query.client_name : 'Claude',
        scopes,
        supabaseUrl: exigirEnv('SUPABASE_URL'),
        supabaseAnonKey: exigirEnv('SUPABASE_PUBLISHABLE_KEY'),
      }),
    );
  });

  /**
   * Ponte do consentimento: a tela acima chama isto depois que o funcionário
   * entrou, mandando o access token do Supabase dele.
   */
  app.post('/mcp/consent', async (req, res) => {
    const { request_id: pedido, supabase_token: token } = req.body ?? {};
    if (typeof pedido !== 'string' || typeof token !== 'string') {
      res.status(400).json({ error: 'request_id e supabase_token são obrigatórios' });
      return;
    }
    const resultado = await oauth.concluirAutorizacao(pedido, token);
    if ('erro' in resultado) {
      res.status(400).json({ error: resultado.erro });
      return;
    }
    res.json({ redirect_to: resultado.redirectTo });
  });

  const server = montarServidor();

  app.post(
    '/mcp',
    requireBearerAuth({ verifier: oauth, requiredScopes: [], resourceMetadataUrl: `${URL_PUBLICA}/.well-known/oauth-protected-resource` }),
    async (req, res) => {
      const auth = (req as { auth?: { scopes: string[]; extra?: Record<string, unknown> } }).auth;
      const userId = auth?.extra?.userId as string | undefined;
      const organizationId = auth?.extra?.organizationId as string | undefined;
      if (!userId || !organizationId) {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }

      const transportSessionId = (req.headers['mcp-session-id'] as string | undefined) ?? null;
      const sessionId = await abrirSessao({
        userId, organizationId,
        clientId: (auth as { clientId?: string } | undefined)?.clientId ?? null,
        transportSessionId,
      });

      /**
       * O PAPEL VEM DO BANCO A CADA REQUISIÇÃO. É isso que faz um rebaixamento
       * valer no turno seguinte, sem esperar o token de 1h expirar e sem
       * ninguém precisar lembrar de revogar nada.
       */
      const principal = await resolverPrincipal({ userId, organizationId, scopesDoToken: auth?.scopes ?? [], sessionId });
      if (!principal) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      const requestId = randomUUID();
      const contexto: ContextoDaTool = {
        principal,
        providers: montarProviders(organizationId),
        logger,
        requestId,
      };

      // Transporte sem estado: uma instância por requisição. Simples de operar
      // e imune a vazamento de sessão entre funcionários.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { void transport.close(); });

      await contextoDaRequisicao.run(contexto, async () => {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      });
    },
  );

  /**
   * ÚLTIMO RECURSO, e ele existe porque a falta dele custou caro: um erro
   * qualquer numa rota virava `{"error":"server_error"}` com HTTP 500 e NENHUMA
   * linha de log. Meia hora de depuração num servidor que sabia exatamente o
   * que tinha acontecido e não contava.
   *
   * Aqui o erro é registrado com a rota e o método; o corpo devolvido continua
   * genérico de propósito (não vazar stack numa superfície pública).
   */
  app.use((erro: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err: erro, metodo: req.method, rota: req.path }, '[mcp] erro não tratado');
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  });

  app.listen(PORTA, () => {
    logger.info(
      { porta: PORTA, url_publica: URL_PUBLICA, endpoint: `${URL_PUBLICA}/mcp` },
      'DESIGUAL OS MCP no ar',
    );
  });
}

main().catch((erro: unknown) => {
  logger.error({ err: erro }, 'MCP não conseguiu subir');
  process.exit(1);
});
