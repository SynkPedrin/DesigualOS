import { describe, expect, it, vi } from 'vitest';

const linha = vi.hoisted(() => ({ atual: null as null | { templateId: string; modules: string[] } }));

vi.mock('@desigual-os/database', () => ({
  schema: { workspaceConfigs: { userId: 'user_id' } },
  db: { select: () => ({ from: () => ({ where: async () => (linha.atual ? [linha.atual] : []) }) }) },
}));
vi.mock('@desigual-os/auth', () => ({ loadUserAccess: async () => ({ roles: [] }) }));

describe('resolveEnabledModules e os módulos de todos', () => {
  /**
   * O caso que motivou MODULOS_DE_TODOS (14/10/2026): quem já escolheu cargo
   * tem a lista gravada, e Automações não estava nela. Somar na leitura é o
   * que libera para quem já existe, sem reescrever a linha de ninguém.
   */
  it('cargo gravado sem Automações passa a ter Automações, e mantém o resto como estava', async () => {
    linha.atual = { templateId: 'designer', modules: ['hoje', 'demandas'] };
    const { resolveEnabledModules } = await import('./access');
    const r = await resolveEnabledModules('u1');
    expect([...r.modules].sort()).toEqual(['automations', 'demandas', 'hoje']);
    expect(r.configured).toBe(true);
  });

  it('quem nunca foi configurado também tem Automações', async () => {
    linha.atual = null;
    const { resolveEnabledModules } = await import('./access');
    const r = await resolveEnabledModules('u2');
    expect(r.modules.has('automations')).toBe(true);
    expect(r.configured).toBe(false);
  });
});
