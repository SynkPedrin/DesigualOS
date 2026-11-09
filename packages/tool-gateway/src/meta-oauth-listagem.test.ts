import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMetaAdAccounts, getMetaBusinesses } from './meta-oauth';

/**
 * O usuário do sistema da agência (conexão central) como o Meta responde de verdade (29/10/2026): nenhuma BM
 * "própria", as contas dos clientes visíveis em /me/adaccounts, e sem permissão para listar a BM do cliente.
 */
const BM_CLIENTE = '1024083214423687';
const conta = (id: string, nome: string, bm: { id: string; name: string } | null) => ({ id: `act_${id}`, account_id: id, name: nome, account_status: 1, currency: 'BRL', ...(bm ? { business: bm } : {}) });
const VISIVEIS = [
  conta('1128656534246958', 'John Deere - D. Carvalho', { id: BM_CLIENTE, name: 'D. Carvalho - John Deere' }),
  conta('222', 'Colormaq', { id: '333', name: 'Colormaq BM' }),
  conta('444', 'Conta solta', null),
];

function grafo(respostas: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
    const caminho = new URL(String(url)).pathname.replace(/^\/v[\d.]+\//, '');
    const r = respostas[caminho] ?? { status: 404, body: { error: { message: `sem rota ${caminho}` } } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }));
}
const negado = { status: 403, body: { error: { message: '(#200) Requires business_management permission' } } };

afterEach(() => vi.unstubAllGlobals());

describe('listagem do Meta com o acesso central da agência', () => {
  it('sem BM "própria", as BMs das contas visíveis entram no seletor', async () => {
    grafo({ 'me/businesses': { status: 200, body: { data: [] } }, 'me/adaccounts': { status: 200, body: { data: VISIVEIS } } });
    expect(await getMetaBusinesses('tok')).toEqual([
      { id: '333', name: 'Colormaq BM' },
      { id: BM_CLIENTE, name: 'D. Carvalho - John Deere' },
    ]);
  });

  it('contas da BM do cliente: sem permissão na BM, vêm as visíveis daquela BM (e só delas)', async () => {
    grafo({ [`${BM_CLIENTE}/owned_ad_accounts`]: negado, [`${BM_CLIENTE}/client_ad_accounts`]: negado, 'me/adaccounts': { status: 200, body: { data: VISIVEIS } } });
    const contas = await getMetaAdAccounts('tok', BM_CLIENTE);
    expect(contas.map((c) => c.name)).toEqual(['John Deere - D. Carvalho']);
  });

  it('com permissão na BM (Facebook pessoal), as possuídas e as de clientes continuam vindo, sem repetir', async () => {
    grafo({
      '333/owned_ad_accounts': { status: 200, body: { data: [VISIVEIS[1]] } },
      '333/client_ad_accounts': { status: 200, body: { data: [conta('555', 'Cliente da Colormaq', { id: '999', name: 'Outra' })] } },
      'me/adaccounts': { status: 200, body: { data: VISIVEIS } },
    });
    expect((await getMetaAdAccounts('tok', '333')).map((c) => c.name).sort()).toEqual(['Cliente da Colormaq', 'Colormaq']);
  });

  it('se nenhum caminho responde, o erro do Meta sobe (não vira lista vazia calada)', async () => {
    grafo({ '1/owned_ad_accounts': negado, '1/client_ad_accounts': negado, 'me/adaccounts': negado });
    await expect(getMetaAdAccounts('tok', '1')).rejects.toThrow(/Requires business_management/);
  });
});
