import type { ClientSummary } from '@/lib/api/contracts';

/** Os ids de lista abaixo são fictícios: no modo live eles vêm do sync real do ClickUp. */
export const mockClients: ClientSummary[] = [
  { id: 'client-clinica-x', name: 'Clínica X', slug: 'clinica-x', status: 'active', clickupListId: '901400000001', clickupUrl: 'https://app.clickup.com/9014937439/v/li/901400000001' },
  { id: 'client-instituto-almada', name: 'Instituto Almada', slug: 'instituto-almada', status: 'active', clickupListId: '901400000002', clickupUrl: 'https://app.clickup.com/9014937439/v/li/901400000002' },
  { id: 'client-grupo-vertice', name: 'Grupo Vértice', slug: 'grupo-vertice', status: 'pontual', clickupListId: null, clickupUrl: null },
  { id: 'client-loja-boreal', name: 'Loja Boreal', slug: 'loja-boreal', status: 'active', clickupListId: '901400000004', clickupUrl: 'https://app.clickup.com/9014937439/v/li/901400000004' },
];
