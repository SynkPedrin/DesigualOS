import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { verifySupabaseToken } from '@desigual-os/auth';
import { isMcpScope, MCP_SCOPES } from '@desigual-os/mcp-domain';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidTokenError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  consumirCodigo, emitirCodigoDeAutorizacao, emitirTokens, lerCodigo,
  revogarPorValor, rotacionarRefresh, verificarAccessToken,
} from './token-store.js';
import { organizacaoUnicaDoUsuario } from './principal.js';

/**
 * oauth-provider.ts — o Authorization Server do MCP, delegando a identidade ao
 * Supabase.
 *
 * ── A DECISÃO CENTRAL ─────────────────────────────────────────────────────
 *
 * O Desigual OS já tem um provedor de identidade: o Supabase Auth. Construir
 * uma segunda tela de senha aqui significaria duas bases de credencial, dois
 * fluxos de recuperação e duas chances de errar. Então este servidor NÃO
 * autentica ninguém — ele autoriza.
 *
 * O `authorize` manda a pessoa para a tela do próprio Desigual OS; quando ela
 * volta autenticada, emitimos um código nosso, com escopo nosso. A identidade é
 * do Supabase; a permissão sobre o MCP é nossa. Cada camada faz uma coisa.
 *
 * ── O QUE ISSO PROTEGE ────────────────────────────────────────────────────
 *
 * A §4 proíbe API key global no cliente Claude, e com razão: com key global
 * toda chamada é a mesma chamada. Não há "quem", a auditoria não distingue
 * funcionários, e cortar o acesso de uma pessoa obriga a trocar a chave de
 * todos. Aqui cada funcionário tem o token dele, com o papel dele.
 */

/**
 * 10 MINUTOS, não 60 segundos (29/09/2026).
 *
 * O primeiro valor tratava o pedido "em voo" como um clique: usuário chega,
 * clica, autoriza, pronto. Errado — é uma pessoa lendo a tela, DIGITANDO
 * e-mail e senha, e às vezes hesitando. Medido ao vivo: 60s expirava o
 * pedido no meio da digitação, e a pessoa via "Pedido de autorização
 * expirado" — uma mensagem sobre TEMPO, mas com senha e e-mail visíveis na
 * tela, foi lida como "a senha está errada". As credenciais nunca estavam
 * erradas; o relógio é que era curto demais para um humano de verdade.
 */
const TEMPO_DE_CODIGO_MS = 10 * 60_000;

/** Store de clientes registrados dinamicamente (RFC 7591). */
class ClientesRegistrados implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const [linha] = await db
      .select()
      .from(schema.mcpClients)
      .where(and(eq(schema.mcpClients.clientId, clientId), isNull(schema.mcpClients.disabledAt)));
    if (!linha) return undefined;
    return {
      client_id: linha.clientId,
      client_name: linha.clientName ?? undefined,
      redirect_uris: linha.redirectUris,
      grant_types: linha.grantTypes,
      scope: linha.scopes.join(' '),
    } as OAuthClientInformationFull;
  }

  async registerClient(cliente: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    /**
     * Registro dinâmico aceita o cliente, mas NÃO aceita os scopes que ele
     * pedir: o conjunto é fechado no nosso vocabulário. Um cliente pedindo
     * `admin.*` inventado seria registrado com a lista vazia em vez de com um
     * poder que não existe.
     */
    const scopes = (cliente.scope ?? '').split(/\s+/).filter((s) => isMcpScope(s));
    await db
      .insert(schema.mcpClients)
      .values({
        clientId: cliente.client_id,
        clientName: cliente.client_name ?? null,
        redirectUris: cliente.redirect_uris ?? [],
        grantTypes: cliente.grant_types ?? ['authorization_code', 'refresh_token'],
        scopes: scopes.length ? scopes : [...MCP_SCOPES],
        metadata: { registered_at: new Date().toISOString() },
      })
      .onConflictDoNothing({ target: schema.mcpClients.clientId });
    return cliente;
  }
}

export interface DesigualOAuthDeps {
  /** Para que falha de auth seja observável (§20) em vez de virar 500 mudo. */
  logger?: { error: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
  /** URL do Supabase, para validar o token que volta da tela de login. */
  supabaseUrl: string;
  /** Onde mora a tela de consentimento (o app web do Desigual OS). */
  consentUrl: string;
  /** URL pública deste servidor MCP, para o RFC 8707. */
  resourceUrl: string;
}

export class DesigualOAuthProvider implements OAuthServerProvider {
  private readonly _clients = new ClientesRegistrados();
  /**
   * Pedidos de autorização em voo, guardados só até a pessoa voltar da tela de
   * login. Em memória de propósito: vivem TEMPO_DE_CODIGO_MS (10 minutos), e
   * persistir isso criaria uma tabela cujo único conteúdo é lixo na manhã
   * seguinte.
   */
  private readonly emVoo = new Map<string, { params: AuthorizationParams; clientId: string; criadoEm: number }>();

  constructor(private readonly deps: DesigualOAuthDeps) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clients;
  }

  /**
   * Manda a pessoa autenticar no Desigual OS. Não desenhamos tela de login
   * aqui: quem já tem sessão no app volta na hora, e quem não tem cai no fluxo
   * de login que ela já conhece.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    this.limparEmVoo();
    const pedido = randomUUID();
    this.emVoo.set(pedido, { params, clientId: client.client_id, criadoEm: Date.now() });

    const destino = new URL(this.deps.consentUrl);
    destino.searchParams.set('mcp_request', pedido);
    destino.searchParams.set('client_name', client.client_name ?? client.client_id);
    destino.searchParams.set('scopes', (params.scopes ?? []).join(' '));
    res.redirect(destino.toString());
  }

  /**
   * Chamado pelo app web depois que o funcionário aprovou. Recebe o access
   * token do Supabase (prova de identidade) e devolve a URL de volta ao Claude,
   * já com o código.
   *
   * É aqui que a identidade do Supabase vira concessão nossa.
   */
  async concluirAutorizacao(pedidoId: string, supabaseAccessToken: string): Promise<{ redirectTo: string } | { erro: string }> {
    const emVoo = this.emVoo.get(pedidoId);
    if (!emVoo || Date.now() - emVoo.criadoEm > TEMPO_DE_CODIGO_MS) {
      this.emVoo.delete(pedidoId);
      return { erro: 'Pedido de autorização expirado. Tente conectar de novo.' };
    }
    this.emVoo.delete(pedidoId);

    let claims;
    try {
      claims = await verifySupabaseToken(supabaseAccessToken, this.deps.supabaseUrl);
    } catch {
      return { erro: 'Não consegui validar sua sessão do Desigual OS.' };
    }

    const [usuario] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.authUserId, claims.sub), eq(schema.users.active, true), isNull(schema.users.deletedAt)));
    if (!usuario) return { erro: 'Sua conta não está ativa no Desigual OS.' };

    /**
     * Uma organização só: escolhemos. Mais de uma: recusamos em vez de decidir
     * em nome do funcionário de qual empresa ele está falando. Escolher em
     * silêncio aqui daria acesso ao tenant errado.
     */
    const organizationId = await organizacaoUnicaDoUsuario(usuario.id);
    if (!organizationId) {
      return { erro: 'Sua conta pertence a mais de uma organização (ou a nenhuma). Fale com o administrador antes de conectar.' };
    }

    const scopesPedidos = (emVoo.params.scopes ?? []).filter(isMcpScope);
    const codigo = await emitirCodigoDeAutorizacao({
      clientId: emVoo.clientId,
      userId: usuario.id,
      organizationId,
      scopes: scopesPedidos.length ? scopesPedidos : ['desigual.read'],
      redirectUri: emVoo.params.redirectUri,
      codeChallenge: emVoo.params.codeChallenge,
      resource: emVoo.params.resource?.toString() ?? this.deps.resourceUrl,
    });

    const destino = new URL(emVoo.params.redirectUri);
    destino.searchParams.set('code', codigo);
    if (emVoo.params.state) destino.searchParams.set('state', emVoo.params.state);
    return { redirectTo: destino.toString() };
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const codigo = await lerCodigo(authorizationCode);
    if (!codigo?.codeChallenge) throw new InvalidGrantError('Código de autorização inválido ou expirado.');
    return codigo.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const codigo = await consumirCodigo(authorizationCode);
    // Uso único garantido pelo UPDATE condicional em `consumirCodigo`: uma
    // segunda troca do mesmo código não encontra nada e cai aqui.
    if (!codigo) throw new InvalidGrantError('Código de autorização inválido, expirado ou já usado.');
    if (codigo.clientId !== client.client_id) throw new InvalidGrantError('Esse código não pertence a este cliente.');

    const par = await emitirTokens({
      clientId: codigo.clientId,
      userId: codigo.userId,
      organizationId: codigo.organizationId,
      scopes: codigo.scopes,
      resource: codigo.resource,
    });
    return {
      access_token: par.accessToken,
      token_type: 'Bearer',
      expires_in: par.expiresIn,
      refresh_token: par.refreshToken,
      scope: par.scopes.join(' '),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const par = await rotacionarRefresh(refreshToken, client.client_id, scopes);
    if (!par) throw new InvalidGrantError('Refresh token inválido, expirado ou já rotacionado.');
    return {
      access_token: par.accessToken,
      token_type: 'Bearer',
      expires_in: par.expiresIn,
      refresh_token: par.refreshToken,
      scope: par.scopes.join(' '),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let verificado: Awaited<ReturnType<typeof verificarAccessToken>>;
    try {
      verificado = await verificarAccessToken(token);
    } catch (erro) {
      /**
       * FALHA DE INFRA NÃO É TOKEN INVÁLIDO, e confundir as duas custa caro nos
       * dois sentidos: banco fora do ar virando "reautorize" manda o
       * funcionário refazer um fluxo que não vai resolver; e token inválido
       * virando 500 faz o cliente MCP tentar de novo em vez de reconectar.
       *
       * Aqui a distinção é explícita e a falha é LOGADA — §20 pede métrica de
       * auth failure, e um 500 mudo foi exatamente o que me custou meia hora
       * de depuração neste arquivo.
       */
      this.deps.logger?.error({ err: erro }, '[mcp-oauth] verificação de token falhou por erro de infraestrutura');
      throw new ServerError('Não consegui verificar o token agora.');
    }
    /**
     * `InvalidTokenError` do SDK, e não um Error qualquer: é o que o middleware
     * `requireBearerAuth` traduz em 401 com o header `WWW-Authenticate` que o
     * cliente MCP usa para saber que deve reautorizar. Com um Error genérico o
     * servidor devolvia 500, e 500 diz "o servidor quebrou" quando a verdade é
     * "seu token não vale" — o Claude tentaria de novo em vez de reconectar.
     */
    if (!verificado) {
      this.deps.logger?.info({ prefixo: token.slice(0, 5) }, '[mcp-oauth] token recusado');
      throw new InvalidTokenError('Token inválido, expirado ou revogado.');
    }
    return {
      token,
      clientId: verificado.clientId,
      scopes: verificado.scopes,
      expiresAt: Math.floor(verificado.expiresAt.getTime() / 1000),
      /**
       * `extra` é o que carrega a identidade até a tool. É lido a cada
       * requisição e combinado com o papel VINDO DO BANCO — o token diz o que
       * foi concedido, o banco diz o que a pessoa pode hoje.
       */
      extra: {
        userId: verificado.userId,
        organizationId: verificado.organizationId,
        tokenId: verificado.tokenId,
      },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await revogarPorValor(request.token);
  }

  private limparEmVoo(): void {
    const limite = Date.now() - TEMPO_DE_CODIGO_MS;
    for (const [id, v] of this.emVoo) if (v.criadoEm < limite) this.emVoo.delete(id);
  }
}

/** Hash usado pelo registro de cliente confidencial. Exportado para teste. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
