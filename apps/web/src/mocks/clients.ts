import type { BrandKitWire, ClientSummary } from '@/lib/api/contracts';

/** Os ids de lista abaixo são fictícios: no modo live eles vêm do sync real do ClickUp. */
export const mockClients: ClientSummary[] = [
  { id: 'client-clinica-x', name: 'Clínica X', slug: 'clinica-x', status: 'active', clickupListId: '901400000001', clickupUrl: 'https://app.clickup.com/9014937439/v/li/901400000001', projectId: null },
  { id: 'client-instituto-almada', name: 'Instituto Almada', slug: 'instituto-almada', status: 'active', clickupListId: '901400000002', clickupUrl: 'https://app.clickup.com/9014937439/v/li/901400000002', projectId: null },
  { id: 'client-grupo-vertice', name: 'Grupo Vértice', slug: 'grupo-vertice', status: 'pontual', clickupListId: null, clickupUrl: null, projectId: null },
  { id: 'client-loja-boreal', name: 'Loja Boreal', slug: 'loja-boreal', status: 'active', clickupListId: '901400000004', clickupUrl: 'https://app.clickup.com/9014937439/v/li/901400000004', projectId: null },
];

/** GET /clients/:id/brand-kit. Cliente sem entrada aqui = sem kit cadastrado,
 * e o handler devolve o envelope vazio (campos null/[]), como o backend real. */
export const mockBrandKits: Record<string, BrandKitWire> = {
  'client-clinica-x': {
    client_id: 'client-clinica-x',
    logo_url: null,
    colors: ['#0EA5E9', '#F0F9FF', '#134E4A'],
    fonts: ['Sora', 'Inter'],
    tone_of_voice: 'Acolhedor e técnico, sem jargão médico.',
    reference_images: [],
  },
  'client-instituto-almada': {
    client_id: 'client-instituto-almada',
    logo_url: null,
    colors: ['#6B21A8', '#9333EA', '#E1F900', '#0F0F0F'],
    fonts: ['Big Shoulders', 'Work Sans'],
    tone_of_voice: 'Direto, confiante e provocativo.',
    reference_images: [],
  },
  'client-loja-boreal': {
    client_id: 'client-loja-boreal',
    logo_url: null,
    colors: ['#164E63', '#A5F3FC', '#FDE68A'],
    fonts: ['Fraunces', 'Archivo'],
    tone_of_voice: 'Caloroso e descritivo, com foco em textura e material.',
    reference_images: [],
  },
};
