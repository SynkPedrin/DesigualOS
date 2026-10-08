import { describe, expect, it } from 'vitest';
import type { LucideIcon } from 'lucide-react';
import { NAV_ITEMS, type NavItem } from './nav-items';
import { blocosVisiveisNasConfiguracoes, estaDentroDeTenant, itensVisiveisNaNavegacao } from './nav-visibility';
import { podeEditarEmpresa } from '@/components/settings/empresa-config';
import type { MeResponse } from '@/lib/api/contracts';

/**
 * Guarda de regressão de 05/10/2026, duas frentes:
 *
 * 1. O ⌘K filtrava SÓ `masterOnly` — tudo que a sidebar esconde por
 *    `administracao`, `providerOnly` ou contexto continuava alcançável pela
 *    paleta. A segunda porta sem a regra da primeira.
 *
 * 2. A detecção de "dentro de tenant" era REGEX NO NOME da empresa
 *    (`/desigual/i`). Um tenant chamado "Desigual Advocacia" viraria "casa"
 *    para a navegação. Agora é identidade estável: `eh_provider` +
 *    `organizacao_ativa.eh_provedora`, ambos decididos no servidor.
 */

const ICONE = (() => null) as unknown as LucideIcon;
const item = (parcial: Partial<NavItem> & { href: string }): NavItem => ({
  label: parcial.href,
  icon: ICONE,
  section: 'dia',
  ...parcial,
});

describe('estaDentroDeTenant — identidade estável, nunca nome', () => {
  it('provider com organização de trabalho tenant: dentro de tenant', () => {
    expect(
      estaDentroDeTenant({
        eh_provider: true,
        organizacao_ativa: { id: 't1', name: 'Empresa QA', eh_provedora: false },
      }),
    ).toBe(true);
  });

  it('provider no contexto da provedora: NÃO está dentro de tenant', () => {
    expect(
      estaDentroDeTenant({
        eh_provider: true,
        organizacao_ativa: { id: 'd1', name: 'Desigual', eh_provedora: true },
      }),
    ).toBe(false);
  });

  /**
   * O caso que o regex errava nos dois sentidos: nome com "desigual" num
   * tenant é tenant; provedora renomeada continua provedora.
   */
  it('ignora o nome completamente', () => {
    expect(
      estaDentroDeTenant({
        eh_provider: true,
        organizacao_ativa: { id: 't1', name: 'Desigual Advocacia', eh_provedora: false },
      }),
    ).toBe(true);
    expect(
      estaDentroDeTenant({
        eh_provider: true,
        organizacao_ativa: { id: 'd1', name: 'Grupo Norte', eh_provedora: true },
      }),
    ).toBe(false);
  });

  it('quem não é provider nunca está "dentro de tenant"', () => {
    expect(
      estaDentroDeTenant({
        eh_provider: false,
        organizacao_ativa: { id: 't1', name: 'Empresa QA', eh_provedora: false },
      }),
    ).toBe(false);
  });

  /** Campo ausente (API antiga, /me carregando) = NÃO-tenant: esconder um
   *  item a mais por um instante é melhor que piscar tela proibida. */
  it('sem eh_provedora na resposta, assume contexto da provedora', () => {
    expect(
      estaDentroDeTenant({ eh_provider: true, organizacao_ativa: { id: 'd1', name: 'Desigual' } }),
    ).toBe(false);
    expect(estaDentroDeTenant(undefined)).toBe(false);
    expect(estaDentroDeTenant(null)).toBe(false);
  });
});

describe('itensVisiveisNaNavegacao — os gates da sidebar, também no ⌘K', () => {
  const itens = [
    item({ href: '/clients' }),
    item({ href: '/signals', administracao: true }),
    item({ href: '/admin', masterOnly: true }),
    item({ href: '/organizations', providerOnly: true }),
    item({ href: '/empresas-provider', contexto: 'provider' }),
    item({ href: '/minha-operacao', contexto: 'tenant' }),
  ];
  const hrefs = (filtro: Parameters<typeof itensVisiveisNaNavegacao>[1]) =>
    itensVisiveisNaNavegacao(itens, filtro).map((i) => i.href);

  it('administracao NUNCA aparece — antes o ⌘K a mostrava', () => {
    expect(hrefs({ isMaster: true, ehProvider: true, dentroDeTenant: false })).not.toContain('/signals');
  });

  it('masterOnly some para colaborador', () => {
    expect(hrefs({ isMaster: false, ehProvider: false, dentroDeTenant: false })).not.toContain('/admin');
    expect(hrefs({ isMaster: true, ehProvider: false, dentroDeTenant: false })).toContain('/admin');
  });

  it('providerOnly some para quem não opera a plataforma — master de tenant inclusive', () => {
    expect(hrefs({ isMaster: true, ehProvider: false, dentroDeTenant: false })).not.toContain('/organizations');
    expect(hrefs({ isMaster: true, ehProvider: true, dentroDeTenant: false })).toContain('/organizations');
  });

  it('item de contexto provider some dentro de tenant; item de tenant some na provedora', () => {
    expect(hrefs({ isMaster: true, ehProvider: true, dentroDeTenant: true })).not.toContain('/empresas-provider');
    expect(hrefs({ isMaster: true, ehProvider: true, dentroDeTenant: true })).toContain('/minha-operacao');
    expect(hrefs({ isMaster: true, ehProvider: true, dentroDeTenant: false })).toContain('/empresas-provider');
    expect(hrefs({ isMaster: true, ehProvider: true, dentroDeTenant: false })).not.toContain('/minha-operacao');
  });
});

/**
 * A LISTA REAL, por contexto (decisão de produto de 05/10/2026). Testar com
 * itens inventados prova o mecanismo; testar com NAV_ITEMS prova a barra que
 * a pessoa vê. Se alguém tirar o `administracao` de um item técnico ou o
 * gate de Conhecimento, é este teste que quebra — não o usuário.
 */
describe('sidebar final por contexto — NAV_ITEMS de verdade', () => {
  const hrefsReais = (filtro: Parameters<typeof itensVisiveisNaNavegacao>[1]) =>
    itensVisiveisNaNavegacao(NAV_ITEMS, filtro).map((i) => i.href);

  /**
   * A barra deixou de ser a mesma para os dois papéis em 08/10/2026: a Equipe
   * virou tela de administração (`masterOnly`), porque é dela que saem
   * convites, papéis e desativação de conta. Antes era `modulo: 'equipe'`, e
   * bastava o template "Gestão" para um colaborador ver a lista.
   */
  const BARRA_BASE = ['/today', '/calendar', '/', '/clients', '/inbox', '/demands', '/midias', '/pipeline'];
  const BARRA_DO_TENANT_MASTER = [...BARRA_BASE, '/people', '/tasks', '/approvals', '/activity', '/integrations', '/workflows', '/settings', '/chat'];
  const BARRA_DO_TENANT_COLABORADOR = [...BARRA_BASE, '/tasks', '/approvals', '/activity', '/integrations', '/workflows', '/settings', '/chat'];

  it('master do tenant: operação + ajustes + Equipe, sem Empresas/Conhecimento/admin', () => {
    expect(hrefsReais({ isMaster: true, ehProvider: false, dentroDeTenant: false })).toEqual(BARRA_DO_TENANT_MASTER);
  });

  it('colaborador: a MESMA barra, menos a Equipe', () => {
    expect(hrefsReais({ isMaster: false, ehProvider: false, dentroDeTenant: false })).toEqual(BARRA_DO_TENANT_COLABORADOR);
  });

  /**
   * O ponto da mudança, e o que não pode voltar: nenhum módulo de workspace
   * devolve a Equipe a um colaborador. Com o gate antigo, um Set contendo
   * 'equipe' bastava.
   */
  it('nenhum conjunto de módulos devolve a Equipe a quem não é master', () => {
    const comTudoLigado = hrefsReais({
      isMaster: false,
      ehProvider: false,
      dentroDeTenant: false,
      modulosHabilitados: new Set(['hoje', 'clientes', 'inbox', 'demandas', 'tarefas', 'aprovacoes', 'operacao', 'integracoes', 'calendario', 'studio', 'bento', 'automations', 'meta_ads']),
    });
    expect(comTudoLigado).not.toContain('/people');
  });

  it('provider DENTRO de um tenant vê a barra do tenant, não a da plataforma', () => {
    expect(hrefsReais({ isMaster: true, ehProvider: true, dentroDeTenant: true })).toEqual(BARRA_DO_TENANT_MASTER);
  });

  it('provider no contexto da Desigual: Empresas e Conhecimento entram, e só aí', () => {
    expect(hrefsReais({ isMaster: true, ehProvider: true, dentroDeTenant: false })).toEqual([
      '/today',
      '/calendar',
      '/',
      '/organizations',
      '/clients',
      '/inbox',
      '/demands',
      '/midias',
      '/pipeline',
      '/people',
      '/tasks',
      '/approvals',
      '/memory',
      '/activity',
      '/integrations',
      '/workflows',
      '/settings',
      '/chat',
    ]);
  });

  it('nenhum item de administracao aparece em nenhum contexto', () => {
    const contextos = [
      { isMaster: true, ehProvider: true, dentroDeTenant: false },
      { isMaster: true, ehProvider: true, dentroDeTenant: true },
      { isMaster: true, ehProvider: false, dentroDeTenant: false },
      { isMaster: false, ehProvider: false, dentroDeTenant: false },
    ];
    for (const filtro of contextos) {
      const visiveis = itensVisiveisNaNavegacao(NAV_ITEMS, filtro);
      expect(visiveis.every((i) => !i.administracao)).toBe(true);
    }
  });
});

describe('itensVisiveisNaNavegacao — Workspace Builder (módulo por pessoa, §5-13, 06/10/2026)', () => {
  const itens = [item({ href: '/clients', modulo: 'clientes' }), item({ href: '/meta-ads-config', modulo: 'meta_ads' }), item({ href: '/settings' })];
  const hrefs = (filtro: Parameters<typeof itensVisiveisNaNavegacao>[1]) => itensVisiveisNaNavegacao(itens, filtro).map((i) => i.href);

  it('sem modulosHabilitados (campo omitido): sem restrição — mesmo item que já aparecia antes deste campo existir', () => {
    expect(hrefs({ isMaster: false, ehProvider: false, dentroDeTenant: false })).toEqual(['/clients', '/meta-ads-config', '/settings']);
  });

  it('com um Set real, só os módulos presentes aparecem — item sem `modulo` nunca é afetado', () => {
    expect(hrefs({ isMaster: false, ehProvider: false, dentroDeTenant: false, modulosHabilitados: new Set(['clientes']) })).toEqual(['/clients', '/settings']);
  });

  it('master vê todo item de módulo mesmo com um Set vazio — nunca espera o workspace carregar', () => {
    expect(hrefs({ isMaster: true, ehProvider: false, dentroDeTenant: false, modulosHabilitados: new Set() })).toEqual(['/clients', '/meta-ads-config', '/settings']);
  });

  it('colaborador com Set vazio perde todo item de módulo, mas nunca o que não tem módulo', () => {
    expect(hrefs({ isMaster: false, ehProvider: false, dentroDeTenant: false, modulosHabilitados: new Set() })).toEqual(['/settings']);
  });
});

describe('blocosVisiveisNasConfiguracoes — MINHA CONTA sempre, EMPRESA e ADMINISTRAÇÃO por contexto', () => {
  const me = (parcial: Partial<MeResponse>): MeResponse => ({ id: 'u1', ...parcial }) as MeResponse;

  it('dentro de um tenant (provedor visitando ou usuário da empresa): EMPRESA sim, Administração não', () => {
    const dentro = { eh_provider: true, organizacao_ativa: { id: 't1', name: 'Empresa QA', eh_provedora: false } };
    expect(blocosVisiveisNasConfiguracoes(me(dentro))).toEqual({ empresa: true, administracao: false });
    const usuarioDoTenant = { eh_provider: false, organizacao_ativa: { id: 't1', name: 'Empresa QA', eh_provedora: false } };
    expect(blocosVisiveisNasConfiguracoes(me(usuarioDoTenant))).toEqual({ empresa: true, administracao: false });
  });

  it('provedor no contexto da Desigual: Administração sim, EMPRESA não (a ficha é /organizations/[id])', () => {
    const naCasa = { eh_provider: true, organizacao_ativa: { id: 'd1', name: 'Desigual', eh_provedora: true } };
    expect(blocosVisiveisNasConfiguracoes(me(naCasa))).toEqual({ empresa: false, administracao: true });
  });

  it('master de tenant NÃO vê Administração — antes o gate era ehProvider || isMaster', () => {
    const masterDeTenant = { eh_provider: false, organizacao_ativa: { id: 't1', name: 'Empresa QA', eh_provedora: false } };
    expect(blocosVisiveisNasConfiguracoes(me(masterDeTenant)).administracao).toBe(false);
  });

  it('/me ausente ou sem eh_provedora: esconde os dois — nunca piscar bloco proibido', () => {
    expect(blocosVisiveisNasConfiguracoes(undefined)).toEqual({ empresa: false, administracao: false });
    expect(blocosVisiveisNasConfiguracoes(null)).toEqual({ empresa: false, administracao: false });
    expect(
      blocosVisiveisNasConfiguracoes(me({ eh_provider: true, organizacao_ativa: { id: 'd1', name: 'Desigual' } })),
    ).toEqual({ empresa: false, administracao: true });
  });
});

describe('podeEditarEmpresa — o formulário de EMPRESA abre só para quem a API aceitaria', () => {
  const me = (parcial: Partial<MeResponse>): MeResponse => ({ id: 'u1', ...parcial }) as MeResponse;

  it('provedor e master editam; colaborador lê', () => {
    expect(podeEditarEmpresa(me({ eh_provider: true, roles: ['colaborador'] }))).toBe(true);
    expect(podeEditarEmpresa(me({ eh_provider: false, roles: ['master'] }))).toBe(true);
    expect(podeEditarEmpresa(me({ eh_provider: false, roles: ['colaborador'] }))).toBe(false);
    expect(podeEditarEmpresa(undefined)).toBe(false);
  });
});
