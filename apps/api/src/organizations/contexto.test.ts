import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O CONTRATO QUE DESTRAVA O BRAND PROVIDER.
 *
 * `GET /me` devolve `organizacao_ativa.marca` — é daqui que o web lê as cores
 * do tenant (brand-provider.tsx). Até a migração 0049 o contexto não trazia
 * as colunas de identidade, e o componente era um no-op com o encaixe pronto.
 *
 * O shape é o contrato: `primary`/`secondary`/`accent` em inglês porque é o
 * que o front lê (`--color-brand-primary` etc.). Mudar o nome aqui não quebra
 * teste de API nenhum — quebra a cor da tela do cliente em silêncio.
 */

let mockLinhas: unknown[] = [];

vi.mock('@desigual-os/database', () => ({
  db: {
    execute: () => Promise.resolve({ rows: mockLinhas }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  schema: {
    users: { id: 'users.id', organizacaoAtivaId: 'users.organizacao_ativa_id' },
  },
}));

const { contextoCompletoDe } = await import('./contexto');

const USER = { id: 'user-1', roles: ['colaborador'] } as never;

const LINHA_BASE = {
  id: 'org-1',
  name: 'Cosentino',
  slug: 'cosentino',
  status: 'ativa',
  cor_primaria: '#22c55e',
  cor_secundaria: null,
  logo_url: 'https://cdn.exemplo/logo.png',
  nome_assistente: 'Pedrita',
  sou_membro: true,
  eh_ativa: false,
};

describe('marca no contexto de /me', () => {
  afterEach(() => {
    mockLinhas = [];
    vi.unstubAllEnvs();
  });

  it('a empresa de trabalho traz a marca no shape que o front lê', async () => {
    mockLinhas = [LINHA_BASE];

    const ctx = await contextoCompletoDe(USER);

    expect(ctx.deTrabalho?.id).toBe('org-1');
    expect(ctx.deTrabalho?.marca).toEqual({
      primary: '#22c55e',
      secondary: null,
      accent: null,
      logo_url: 'https://cdn.exemplo/logo.png',
      nome_assistente: 'Pedrita',
    });
  });

  it('empresa sem identidade configurada: campos null, marca presente (o front remove as sobrescritas)', async () => {
    mockLinhas = [
      { ...LINHA_BASE, cor_primaria: null, logo_url: null, nome_assistente: null },
    ];

    const ctx = await contextoCompletoDe(USER);

    expect(ctx.deTrabalho?.marca).toEqual({
      primary: null,
      secondary: null,
      accent: null,
      logo_url: null,
      nome_assistente: null,
    });
  });

  it('a empresa aberta de propósito (ativa) também traz marca, é ela que a tela mostra', async () => {
    mockLinhas = [{ ...LINHA_BASE, eh_ativa: true }];

    const ctx = await contextoCompletoDe(USER);

    expect(ctx.ativa?.marca.primary).toBe('#22c55e');
    expect(ctx.deTrabalho?.marca.primary).toBe('#22c55e');
  });
});
