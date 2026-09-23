import { describe, expect, it } from 'vitest';
import { tryJarbasHandoff } from './jarbas-handoff';

const SENIOR_CONTEXT_ASSIGN = {
  executionId: 'exe-1',
  userId: 'user-1',
  organizationId: 'org-1',
  agent: 'bento' as const,
  permissions: [{ resource: 'jarbas', action: 'assign' }],
};

const SENIOR_CONTEXT_NO_PERMISSION = {
  ...SENIOR_CONTEXT_ASSIGN,
  permissions: [{ resource: 'clickup', action: 'write' }],
};

describe('tryJarbasHandoff — RBAC e resolução de contexto (§15/§24/§25 da missão de wiring)', () => {
  it('mensagem sem menção ao Jarbas -> null (guard segue normal, sem interferir em nada)', async () => {
    const r = await tryJarbasHandoff({
      message: 'cria uma task pro Pedro', conversationId: null, userEmail: 'x@x.com',
      clientId: 'cliente-a', clientName: 'Cliente A', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).toBeNull();
  });

  it('pedido de handoff sem permissão jarbas:assign -> negado explicitamente, nunca silencioso', async () => {
    const r = await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a Cosentino', conversationId: null, userEmail: 'x@x.com',
      clientId: 'cliente-a', clientName: 'Cosentino', seniorToolContext: SENIOR_CONTEXT_NO_PERMISSION,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('denied_permission');
  });

  it('pedido de handoff sem cliente resolvido -> pede o cliente, nunca adivinha', async () => {
    const r = await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar isso', conversationId: null, userEmail: 'x@x.com',
      clientId: null, clientName: null, seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('blocked_ambiguous_client');
  });

  it('cliente resolvido mas sem mapeamento de conta Meta -> resposta honesta, nunca inventa uma conta', async () => {
    const r = await tryJarbasHandoff({
      message: 'Bento, manda o Jarbas analisar a Cosentino', conversationId: null, userEmail: 'x@x.com',
      clientId: 'cliente-cosentino', clientName: 'Cosentino', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('blocked_no_account_mapping');
    expect(r?.answer).toMatch(/não tenho a conta de Meta Ads/);
  });

  it('pergunta de status sem rastreamento de tarefa da conversa -> resposta honesta, nunca inventa um resultado', async () => {
    const r = await tryJarbasHandoff({
      message: 'Bento, o Jarbas terminou?', conversationId: 'conv-1', userEmail: 'x@x.com',
      clientId: 'cliente-a', clientName: 'A', seniorToolContext: SENIOR_CONTEXT_ASSIGN,
    });
    expect(r).not.toBeNull();
    expect(r?.metadata.action).toBe('status_query_unimplemented');
  });
});
