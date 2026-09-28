/**
 * notion-oauth.ts — cada pessoa conecta o SEU Notion, uma vez.
 *
 * Pedido da operação (28/09/2026): "o colaborador clica, conecta no Notion
 * dele, e depois de conectar uma vez fica sempre conectado".
 *
 * Isso é OAuth por pessoa, não um token interno da agência — e a diferença não
 * é técnica, é de propriedade: a página nasce no workspace de QUEM PEDIU, com
 * o nome de quem pediu no histórico do Notion. Um token único da agência
 * criaria tudo no mesmo lugar, assinado por ninguém.
 *
 * O desenho é o mesmo que o ClickUp já usa aqui (ver clickup-oauth.ts e
 * apps/api/src/integrations/routes.ts): authorize → callback → token
 * cifrado em `integration_connections`, uma linha por (usuário, provider). O
 * `provider` daquela tabela sempre foi vocabulário aberto — "clickup hoje,
 * whatsapp/google/slack depois" —, então nada de schema novo.
 *
 * O token do Notion NÃO expira: quem conectou fica conectado até revogar, que
 * é exatamente o "fica sempre conectado" pedido.
 */

const NOTION_VERSION = '2022-06-28';
const API = 'https://api.notion.com/v1';

export interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getNotionOAuthConfig(env: NodeJS.ProcessEnv = process.env): NotionOAuthConfig | null {
  const clientId = env.NOTION_CLIENT_ID?.trim();
  const clientSecret = env.NOTION_CLIENT_SECRET?.trim();
  const redirectUri = env.NOTION_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildNotionAuthorizeUrl(config: NotionOAuthConfig, state: string): string {
  const url = new URL(`${API}/oauth/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  // `owner=user` é o que faz o Notion pedir à PESSOA quais páginas liberar —
  // sem isso a integração não teria onde escrever.
  url.searchParams.set('owner', 'user');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export interface NotionGrant {
  accessToken: string;
  workspaceId: string | null;
  workspaceName: string | null;
}

export async function exchangeNotionCode(config: NotionOAuthConfig, code: string): Promise<NotionGrant> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
  });
  if (!response.ok) {
    throw new Error(`Notion OAuth token exchange failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { access_token?: string; workspace_id?: string; workspace_name?: string };
  if (!json.access_token) throw new Error('Notion devolveu 200 sem access_token');
  return {
    accessToken: json.access_token,
    workspaceId: json.workspace_id ?? null,
    workspaceName: json.workspace_name ?? null,
  };
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

export interface NotionParent {
  id: string;
  title: string;
  type: 'page' | 'database';
}

/**
 * Onde a página vai nascer. O Notion não dá "a raiz do workspace" pra uma
 * integração: ela só enxerga o que a PESSOA liberou na hora de conectar. Então
 * o pai é o que o `search` devolver — e não achando nada, o erro diz o que
 * fazer, em vez de um 404 cru do Notion.
 */
export async function listarDestinosNotion(token: string, limite = 10): Promise<NotionParent[]> {
  const response = await fetch(`${API}/search`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ page_size: limite, filter: { property: 'object', value: 'page' } }),
  });
  if (!response.ok) throw new Error(`Notion search failed (${response.status}): ${await response.text()}`);
  const json = (await response.json()) as { results?: Array<Record<string, unknown>> };
  const out: NotionParent[] = [];
  for (const r of json.results ?? []) {
    const id = typeof r.id === 'string' ? r.id : null;
    if (!id) continue;
    out.push({ id, title: tituloDe(r) ?? 'Sem título', type: r.object === 'database' ? 'database' : 'page' });
  }
  return out;
}

function tituloDe(r: Record<string, unknown>): string | null {
  const props = r.properties as Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> | undefined;
  for (const valor of Object.values(props ?? {})) {
    if (valor?.type === 'title' && Array.isArray(valor.title)) {
      const texto = valor.title.map((t) => t.plain_text ?? '').join('').trim();
      if (texto) return texto;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Markdown → blocos do Notion                                          */
/* ------------------------------------------------------------------ */

/** O Notion recusa rich_text acima de 2000 caracteres por bloco. */
const LIMITE_TEXTO = 2000;

function richText(texto: string): Array<{ type: 'text'; text: { content: string } }> {
  return [{ type: 'text', text: { content: texto.slice(0, LIMITE_TEXTO) } }];
}

/**
 * Conversão deliberadamente pequena: títulos, itens de lista e parágrafo.
 *
 * O briefing que este sistema produz usa exatamente esse vocabulário, e um
 * conversor "completo" de markdown traria tabelas, código e citação — coisas
 * que o briefing não gera e que só somariam modo de falhar. Linha que não se
 * reconhece vira parágrafo, nunca é descartada: perder um pedaço do briefing
 * em silêncio é pior que formatá-lo como texto simples.
 */
export function markdownParaBlocosNotion(markdown: string): Array<Record<string, unknown>> {
  const blocos: Array<Record<string, unknown>> = [];
  for (const linhaBruta of markdown.split('\n')) {
    const linha = linhaBruta.trimEnd();
    if (!linha.trim()) continue;

    const cabecalho = /^(#{1,3})\s+(.*)$/.exec(linha);
    if (cabecalho) {
      const nivel = cabecalho[1]!.length as 1 | 2 | 3;
      const tipo = `heading_${nivel}` as const;
      blocos.push({ object: 'block', type: tipo, [tipo]: { rich_text: richText(cabecalho[2]!) } });
      continue;
    }

    const item = /^\s*[-*]\s+(.*)$/.exec(linha);
    if (item) {
      blocos.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(item[1]!) } });
      continue;
    }

    const numerado = /^\s*\d+[.)]\s+(.*)$/.exec(linha);
    if (numerado) {
      blocos.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(numerado[1]!) } });
      continue;
    }

    blocos.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(linha.trim()) } });
  }
  return blocos;
}

/** O Notion aceita no máximo 100 blocos filhos na criação da página. */
const MAX_BLOCOS = 100;

export interface PaginaCriada {
  id: string;
  url: string;
  /** Blocos que não couberam no limite da API — dito, nunca escondido. */
  blocosOmitidos: number;
}

export async function criarPaginaNotion(params: {
  token: string;
  parentId: string;
  titulo: string;
  markdown: string;
}): Promise<PaginaCriada> {
  const todos = markdownParaBlocosNotion(params.markdown);
  const children = todos.slice(0, MAX_BLOCOS);
  const response = await fetch(`${API}/pages`, {
    method: 'POST',
    headers: headers(params.token),
    body: JSON.stringify({
      parent: { page_id: params.parentId },
      properties: { title: { title: richText(params.titulo) } },
      children,
    }),
  });
  if (!response.ok) throw new Error(`Notion page creation failed (${response.status}): ${await response.text()}`);
  const json = (await response.json()) as { id?: string; url?: string };
  if (!json.id) throw new Error('Notion devolveu 200 sem id de página');
  return { id: json.id, url: json.url ?? `https://notion.so/${json.id.replace(/-/g, '')}`, blocosOmitidos: todos.length - children.length };
}
