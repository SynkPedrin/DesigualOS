import type { BrandKitWire, ClientSummaryWire } from '@/lib/api/contracts';

/**
 * CARTEIRA DA DEMO (07/10/2026) — um dia real de operação da agência, pros
 * mockups "Hoje"/"Clientes"/"Conversas". Os 8 nomeados aparecem também em
 * `mocks/inbox.ts` e `mocks/demands.ts` com os MESMOS ids — Cosentino na
 * Inbox é a mesma Cosentino de Clientes e de Hoje, de propósito (regra #4 do
 * briefing: dado de demo tem que ser coerente entre telas).
 *
 * Mistura de status pensada pra bater os chips do mockup: 14 ativos, 2 em
 * onboarding, 1 em pausa, 1 inativo — 18 no total.
 */
export const mockClients: ClientSummaryWire[] = [
  // Os 8 que aparecem na história da demo.
  { id: 'client-cosentino', name: 'Cosentino', slug: 'cosentino', status: 'active', clickup_list_id: '901400000010', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000010', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 18 * 60_000).toISOString(), pedidos_30d: 24 },
  { id: 'client-g4-educacao', name: 'G4 Educação', slug: 'g4-educacao', status: 'active', clickup_list_id: '901400000011', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000011', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 42 * 60_000).toISOString(), pedidos_30d: 15 },
  { id: 'client-clinica-bela', name: 'Clínica Belá', slug: 'clinica-bela', status: 'active', clickup_list_id: '901400000012', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000012', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 3_600_000).toISOString(), pedidos_30d: 9 },
  { id: 'client-autovisual', name: 'Autovisual', slug: 'autovisual', status: 'active', clickup_list_id: '901400000013', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000013', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 3 * 3_600_000).toISOString(), pedidos_30d: 7 },
  { id: 'client-studio-loren', name: 'Studio Loren', slug: 'studio-loren', status: 'active', clickup_list_id: '901400000014', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000014', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 5 * 3_600_000).toISOString(), pedidos_30d: 11 },
  { id: 'client-moveis-planejados-sp', name: 'Móveis Planejados SP', slug: 'moveis-planejados-sp', status: 'onboarding', clickup_list_id: '901400000015', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000015', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 86_400_000).toISOString(), pedidos_30d: 2 },
  { id: 'client-estetica-automotiva-prime', name: 'Estética Automotiva Prime', slug: 'estetica-automotiva-prime', status: 'active', clickup_list_id: '901400000016', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000016', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 86_400_000).toISOString(), pedidos_30d: 4 },
  { id: 'client-petcare', name: 'PetCare', slug: 'petcare', status: 'active', clickup_list_id: '901400000017', clickup_url: 'https://app.clickup.com/9014937439/v/li/901400000017', project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 2 * 86_400_000).toISOString(), pedidos_30d: 13 },

  // Carteira restante — preenche os chips de status sem entrar na história.
  { id: 'client-grupo-fenix', name: 'Grupo Fênix Alimentos', slug: 'grupo-fenix-alimentos', status: 'active', clickup_list_id: '901400000018', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 3 * 86_400_000).toISOString(), pedidos_30d: 6 },
  { id: 'client-construtora-horizonte', name: 'Construtora Horizonte', slug: 'construtora-horizonte', status: 'active', clickup_list_id: '901400000019', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 4 * 86_400_000).toISOString(), pedidos_30d: 5 },
  { id: 'client-vida-verde', name: 'Vida Verde Orgânicos', slug: 'vida-verde-organicos', status: 'active', clickup_list_id: '901400000020', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 5 * 86_400_000).toISOString(), pedidos_30d: 8 },
  { id: 'client-topfit', name: 'TopFit Academia', slug: 'topfit-academia', status: 'active', clickup_list_id: '901400000021', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 6 * 86_400_000).toISOString(), pedidos_30d: 3 },
  { id: 'client-doce-sabor', name: 'Doce Sabor Confeitaria', slug: 'doce-sabor-confeitaria', status: 'active', clickup_list_id: '901400000022', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 7 * 86_400_000).toISOString(), pedidos_30d: 4 },
  { id: 'client-nexus-tecnologia', name: 'Nexus Tecnologia', slug: 'nexus-tecnologia', status: 'active', clickup_list_id: '901400000023', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 8 * 86_400_000).toISOString(), pedidos_30d: 10 },
  { id: 'client-bella-moda', name: 'Bella Moda Boutique', slug: 'bella-moda-boutique', status: 'active', clickup_list_id: '901400000024', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 9 * 86_400_000).toISOString(), pedidos_30d: 2 },
  { id: 'client-instituto-vitalis', name: 'Instituto Vitalis', slug: 'instituto-vitalis', status: 'onboarding', clickup_list_id: '901400000025', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 2 * 86_400_000).toISOString(), pedidos_30d: 1 },
  { id: 'client-auto-pecas-uniao', name: 'Auto Peças União', slug: 'auto-pecas-uniao', status: 'paused', clickup_list_id: '901400000026', clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 22 * 86_400_000).toISOString(), pedidos_30d: 0 },
  { id: 'client-cafe-raizes', name: 'Café Raízes', slug: 'cafe-raizes', status: 'inactive', clickup_list_id: null, clickup_url: null, project_id: null, natureza: 'CLIENTE', ultima_atividade: new Date(Date.now() - 95 * 86_400_000).toISOString(), pedidos_30d: 0 },
];

/** GET /clients/:id/brand-kit. Cliente sem entrada aqui = sem kit cadastrado,
 * e o handler devolve o envelope vazio (campos null/[]), como o backend real. */
export const mockBrandKits: Record<string, BrandKitWire> = {
  'client-cosentino': {
    client_id: 'client-cosentino',
    logo_url: null,
    colors: ['#171717', '#E5E5E5', '#7C3AED'],
    fonts: ['Sora', 'Inter'],
    tone_of_voice: 'Técnico e sofisticado, foco em arquitetura e design de alto padrão.',
    reference_images: [],
  },
};
