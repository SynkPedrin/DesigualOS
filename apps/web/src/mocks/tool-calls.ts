import type { ToolCallWire } from '@/lib/api/contracts';

/**
 * Fila de aprovação humana (Tool Gateway, seção 6.6) em modo mock: budget de
 * Meta Ads do jarbas, publicação no Instagram da suzy e exclusão de tarefa
 * do ClickUp, pendentes até um master aprovar em /approvals.
 */
export const mockToolCalls: ToolCallWire[] = [
  {
    id: 'tool-call-1',
    agent: 'jarbas',
    tool: 'meta_ads',
    input: {
      proposal:
        'Subir o orçamento diário da campanha "Clínica X - Conversão" de R$ 150 para R$ 300 pelos próximos 7 dias. CPA está em R$ 38 (meta: R$ 45) e ainda não bateu o teto de frequência - dá pra escalar sem perder eficiência.',
      session_id: 'conv-jarbas-budget-1',
    },
    created_at: new Date(Date.now() - 45 * 60_000).toISOString(),
  },
  {
    id: 'tool-call-2',
    agent: 'suzy',
    tool: 'instagram',
    input: {
      proposal:
        'Publicar carrossel "5 sinais de que sua pele precisa de skincare profissional" no feed do Instagram da Clínica X, às 18h de hoje. Peças já aprovadas pelo Otto, legenda com CTA para agendar avaliação.',
      session_id: 'conv-suzy-post-1',
    },
    created_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
  },
  {
    id: 'tool-call-3',
    agent: 'bento',
    tool: 'clickup.delete_task',
    input: {
      task_id: '86eq7x9k2',
    },
    created_at: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
  },
];
