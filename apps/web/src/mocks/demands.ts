import type { ApprovalRequestWire, BriefVersionWire, BriefWire, DemandWire } from '@/lib/api/contracts';

/** Fixture DEV/QA do core workflow (P1-D/E/F/G/I) + demo "dia real de
 *  operação" (07/10/2026) — nunca ativa em NEXT_PUBLIC_API_MODE=live. Mesmos
 *  clientes de `mocks/clients.ts`/`mocks/inbox.ts`, de propósito. */
export const mockDemands: DemandWire[] = [
  {
    id: 'demand-campanha-outubro',
    client_id: 'client-cosentino',
    client_name: 'Cosentino',
    owner_id: 'user-admin-master',
    title: 'Campanha Outubro',
    description: 'Revisão do direcionamento criativo — cliente pediu variação focada no público de arquitetos.',
    source: 'whatsapp',
    status: 'in_production',
    priority: 'high',
    requested_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    due_date: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    clickup_task_url: null,
  },
  {
    id: 'demand-videos-institucionais',
    client_id: 'client-cosentino',
    client_name: 'Cosentino',
    owner_id: 'user-colaborador-3',
    title: 'Vídeos Institucionais',
    description: '5 vídeos para o canal institucional — em produção.',
    source: 'manual',
    status: 'in_production',
    priority: 'normal',
    requested_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    due_date: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    clickup_task_url: null,
  },
  {
    id: 'demand-landing-page-linha-pro',
    client_id: 'client-cosentino',
    client_name: 'Cosentino',
    owner_id: 'user-admin-master',
    title: 'Landing Page — Linha Pro',
    description: 'Site de 1 página, em revisão com o cliente.',
    source: 'manual',
    status: 'in_production',
    priority: 'normal',
    requested_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    due_date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    clickup_task_url: null,
  },
  {
    id: 'demand-midia-patrocinada',
    client_id: 'client-cosentino',
    client_name: 'Cosentino',
    owner_id: 'user-colaborador-2',
    title: 'Mídia Patrocinada',
    description: 'Planejamento de mídia paga focado no público de arquitetos.',
    source: 'manual',
    status: 'briefing',
    priority: 'normal',
    requested_at: new Date(Date.now() - 86_400_000).toISOString(),
    due_date: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    clickup_task_url: null,
  },
  {
    id: 'demand-variacoes-criativo-g4',
    client_id: 'client-g4-educacao',
    client_name: 'G4 Educação',
    owner_id: 'user-admin-master',
    title: 'Enviar variações de criativo',
    description: 'Cliente pediu pelo WhatsApp: variações do criativo atual para aprovação amanhã.',
    source: 'whatsapp',
    status: 'new',
    priority: 'high',
    requested_at: new Date(Date.now() - 42 * 60_000).toISOString(),
    due_date: new Date(Date.now() + 20 * 3_600_000).toISOString(),
    clickup_task_url: null,
  },
  {
    id: 'demand-artes-clinica-bela',
    client_id: 'client-clinica-bela',
    client_name: 'Clínica Belá',
    owner_id: null,
    title: '3 artes para campanha da semana',
    description: 'Nova demanda recebida pelo WhatsApp — 3 peças para a campanha da semana que vem.',
    source: 'whatsapp',
    status: 'new',
    priority: 'normal',
    requested_at: new Date(Date.now() - 86_400_000).toISOString(),
    due_date: null,
    clickup_task_url: null,
  },
];

export const mockBriefs: Record<string, BriefWire> = {};
export const mockBriefVersions: Record<string, BriefVersionWire[]> = {};

/** Aprovações pendentes da demo — alimenta o card "Aprovações pendentes" de
 *  Hoje e a lista de Aprovações. `resource_type`/`resource_id` apontam pro
 *  tipo real do contrato; o título legível vem de `resourceLabel` abaixo
 *  (a wire não carrega título solto, só o join via resource_id). */
export const mockApprovals: ApprovalRequestWire[] = [
  {
    id: 'approval-campanha-outubro',
    client_id: 'client-cosentino',
    resource_type: 'campaign',
    resource_id: 'demand-campanha-outubro',
    version: '3 peças',
    requested_by: 'user-admin-master',
    approver_id: 'user-admin-master',
    status: 'pending',
    comment: null,
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    resolved_at: null,
  },
  {
    id: 'approval-criativos-semana-42',
    client_id: 'client-g4-educacao',
    resource_type: 'creative',
    resource_id: 'demand-variacoes-criativo-g4',
    version: '5 peças',
    requested_by: 'user-colaborador-3',
    approver_id: 'user-admin-master',
    status: 'pending',
    comment: null,
    created_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    resolved_at: null,
  },
  {
    id: 'approval-video-institucional',
    client_id: 'client-clinica-bela',
    resource_type: 'creative',
    resource_id: 'demand-artes-clinica-bela',
    version: '1 vídeo',
    requested_by: 'user-colaborador-2',
    approver_id: 'user-admin-master',
    status: 'pending',
    comment: null,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    resolved_at: null,
  },
];

/** Rótulo legível por tipo de recurso — usado onde a wire não carrega
 *  título solto (cartão de "Aprovações pendentes" em Hoje). */
export const APPROVAL_RESOURCE_LABEL: Record<string, string> = {
  brief: 'Briefing',
  creative: 'Criativos',
  copy: 'Copy',
  task: 'Tarefa',
  campaign: 'Campanha',
  budget: 'Orçamento',
  publication: 'Publicação',
};

let proximoId = 1;
export function nextMockId(prefix: string): string {
  return `${prefix}-mock-${++proximoId}`;
}
