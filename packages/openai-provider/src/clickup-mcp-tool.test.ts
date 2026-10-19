import { describe, expect, it } from 'vitest';
import { buildClickUpMcpTool } from './clickup-mcp-tool.js';

describe('buildClickUpMcpTool', () => {
  it('monta a tool MCP com o token no header Authorization, sem vazar o token em outro campo', () => {
    const tool = buildClickUpMcpTool('token-secreto');
    expect(tool.type).toBe('mcp');
    expect(tool.server_url).toBe('https://mcp.clickup.com/mcp');
    expect(tool.headers).toEqual({ Authorization: 'Bearer token-secreto' });
    expect(tool.require_approval).toBe('never');
    expect(JSON.stringify(tool)).not.toContain('client_secret');
  });

  it('aceita allowed_tools para restringir a superfície exposta ao modelo', () => {
    const tool = buildClickUpMcpTool('token', ['create_task', 'get_task']);
    expect(tool.allowed_tools).toEqual(['create_task', 'get_task']);
  });
});
