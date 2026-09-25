import type { ResponsesMcpToolDefinition } from './responses-client.js';

/**
 * Seção 12/17 da missão: "OpenAI Responses → remote MCP tool → ClickUp MCP",
 * sem parser de português por regex escolhendo a tool — a descoberta e a
 * escolha são feitas pela própria OpenAI/modelo, este helper só monta a
 * definição da tool com o token do usuário.
 *
 * `require_approval: 'never'` é uma escolha explícita, não default do SDK:
 * a política de escrita já passa pela camada de política ANTES desta
 * chamada (seção 18), então pedir aprovação humana por-tool aqui duplicaria
 * uma decisão que o `policy layer` já tomou, com uma UI que este runtime
 * não tem. Ações destrutivas continuam bloqueadas pela política, não pela
 * aprovação nativa do MCP.
 */
export function buildClickUpMcpTool(accessToken: string, allowedTools?: string[]): ResponsesMcpToolDefinition {
  return {
    type: 'mcp',
    server_label: 'clickup',
    server_url: 'https://mcp.clickup.com/mcp',
    headers: { Authorization: `Bearer ${accessToken}` },
    require_approval: 'never',
    ...(allowedTools ? { allowed_tools: allowedTools } : {}),
  };
}
