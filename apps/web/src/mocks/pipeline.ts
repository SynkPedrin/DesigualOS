import { mockAgencyTasks } from './clickup-tasks';
import { mockTeamMembers } from './team';

/**
 * PIPELINES (demo "dia real de operação", 07/10/2026) — cada pessoa pode ter
 * mais de um quadro, cada um de um TIPO:
 *
 *   cliente     — funil comercial (lead → ativo), estágios livres.
 *   tarefas     — um cartão por tarefa do ClickUp; o estágio É o status da
 *                 tarefa, então só pode usar os status que existem de
 *                 verdade no ClickUp (`CLICKUP_STATUSES_DISPONIVEIS`), nunca
 *                 um nome inventado.
 *   colaborador — carga de trabalho por pessoa, mesmos números de
 *                 `operacao_por_colaborador` (agency-control-center) — não
 *                 duplica a conta, só mostra numa outra forma.
 *
 * Tudo em estado local da demo — não existe endpoint de pipeline ainda.
 */
export const PIPELINE_STAGE_COLORS = ['roxo-eletrico', 'info', 'aviso', 'sinal', 'erro', 'ametista'] as const;
export type PipelineStageColor = (typeof PIPELINE_STAGE_COLORS)[number];

export type PipelineTipo = 'cliente' | 'tarefas' | 'colaborador';

export interface PipelineStage {
  id: string;
  label: string;
  color: PipelineStageColor;
  /** Só pra tipo='tarefas': o status real do ClickUp que este estágio representa.
   *  Mudar um cartão de estágio muda ESTE campo na tarefa — nunca um nome livre. */
  clickupStatus?: string;
}

export interface PipelineBoard {
  id: string;
  nome: string;
  tipo: PipelineTipo;
  stages: PipelineStage[];
}

export interface PipelineCard {
  id: string;
  boardId: string;
  stageId: string;
  name: string;
  clientId: string | null;
  /** Só pra tipo='tarefas': liga o cartão de volta à tarefa real, pra mover
   *  de estágio escrever o status em `mockAgencyTasks`, não só no cartão. */
  taskId?: string;
  responsavel: string;
  valor: string | null;
  nota: string;
  /** Anexos já hospedados (POST /uploads). Nunca `blob:` local — ver o hook. */
  anexos: { id: string; nome: string; url: string; tipo: string }[];
  atualizadoEm: string;
}

/** Status que EXISTEM no ClickUp desta agência — a única fonte ao montar um
 *  quadro tipo='tarefas'. Mesmos nomes/tipos usados em `mocks/clickup-tasks.ts`. */
export const CLICKUP_STATUSES_DISPONIVEIS: Array<{ status: string; statusType: string; color: PipelineStageColor }> = [
  { status: 'Para fazer', statusType: 'open', color: 'info' },
  { status: 'Em produção', statusType: 'custom', color: 'aviso' },
  { status: 'Revisão', statusType: 'custom', color: 'ametista' },
  { status: 'Concluído', statusType: 'closed', color: 'sinal' },
];

export const mockPipelineBoards: PipelineBoard[] = [
  {
    id: 'board-comercial',
    nome: 'Comercial',
    tipo: 'cliente',
    stages: [
      { id: 'lead', label: 'Lead', color: 'info' },
      { id: 'proposta', label: 'Proposta enviada', color: 'aviso' },
      { id: 'onboarding', label: 'Onboarding', color: 'roxo-eletrico' },
      { id: 'ativo', label: 'Ativo', color: 'sinal' },
      { id: 'pausado', label: 'Pausado', color: 'ametista' },
    ],
  },
  {
    id: 'board-tarefas-equipe',
    nome: 'Tarefas da equipe',
    tipo: 'tarefas',
    stages: CLICKUP_STATUSES_DISPONIVEIS.map((s) => ({ id: s.status, label: s.status, color: s.color, clickupStatus: s.status })),
  },
  {
    id: 'board-carga-equipe',
    nome: 'Carga da equipe',
    tipo: 'colaborador',
    stages: [
      { id: 'disponivel', label: 'Disponível', color: 'sinal' },
      { id: 'com-carga', label: 'Com carga', color: 'info' },
      { id: 'sobrecarregado', label: 'Sobrecarregado', color: 'erro' },
    ],
  },
];

export const mockPipelineCards: PipelineCard[] = [
  { id: 'pipe-1', boardId: 'board-comercial', stageId: 'lead', name: 'Padaria Dona Luzia', clientId: null, responsavel: 'Pedro Gabriel', valor: null, nota: 'Chegou pelo Instagram, primeira conversa via WhatsApp.', anexos: [], atualizadoEm: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  { id: 'pipe-2', boardId: 'board-comercial', stageId: 'lead', name: 'Fit Box Treinos', clientId: null, responsavel: 'Matheus Rial', valor: null, nota: 'Indicação da Autovisual — aguardando retorno sobre orçamento.', anexos: [], atualizadoEm: new Date(Date.now() - 86_400_000).toISOString() },
  { id: 'pipe-3', boardId: 'board-comercial', stageId: 'proposta', name: 'Estética Automotiva Prime', clientId: 'client-estetica-automotiva-prime', responsavel: 'Pedro Gabriel', valor: 'R$ 3.500/mês', nota: 'Proposta enviada sexta — aguardando aprovação do sócio.', anexos: [], atualizadoEm: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { id: 'pipe-4', boardId: 'board-comercial', stageId: 'proposta', name: 'Doce & Cia Confeitaria', clientId: null, responsavel: 'Tami Alves', valor: 'R$ 1.800/mês', nota: 'Segunda reunião marcada pra quinta.', anexos: [], atualizadoEm: new Date(Date.now() - 3 * 86_400_000).toISOString() },
  { id: 'pipe-5', boardId: 'board-comercial', stageId: 'onboarding', name: 'Móveis Planejados SP', clientId: 'client-moveis-planejados-sp', responsavel: 'Pedro Gabriel', valor: 'R$ 4.200/mês', nota: 'Falta CNPJ e acesso ao Meta Ads pra liberar a conta.', anexos: [], atualizadoEm: new Date(Date.now() - 86_400_000).toISOString() },
  { id: 'pipe-6', boardId: 'board-comercial', stageId: 'onboarding', name: 'Instituto Vitalis', clientId: 'client-instituto-vitalis', responsavel: 'Julia Prado', valor: 'R$ 2.600/mês', nota: 'Briefing inicial agendado pra semana que vem.', anexos: [], atualizadoEm: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { id: 'pipe-7', boardId: 'board-comercial', stageId: 'ativo', name: 'Cosentino', clientId: 'client-cosentino', responsavel: 'Pedro Gabriel', valor: 'R$ 12.000/mês', nota: 'Cliente estratégico — campanha de outubro em produção.', anexos: [], atualizadoEm: new Date(Date.now() - 18 * 60_000).toISOString() },
  { id: 'pipe-8', boardId: 'board-comercial', stageId: 'ativo', name: 'G4 Educação', clientId: 'client-g4-educacao', responsavel: 'Pedro Gabriel', valor: 'R$ 7.500/mês', nota: 'Lançamento de turma em andamento.', anexos: [], atualizadoEm: new Date(Date.now() - 42 * 60_000).toISOString() },
  { id: 'pipe-9', boardId: 'board-comercial', stageId: 'ativo', name: 'Clínica Belá', clientId: 'client-clinica-bela', responsavel: 'Pedro Gabriel', valor: 'R$ 5.000/mês', nota: 'Campanha semanal recorrente.', anexos: [], atualizadoEm: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'pipe-10', boardId: 'board-comercial', stageId: 'ativo', name: 'Autovisual', clientId: 'client-autovisual', responsavel: 'Matheus Rial', valor: 'R$ 3.900/mês', nota: 'Produção de vídeo semanal.', anexos: [], atualizadoEm: new Date(Date.now() - 3 * 3_600_000).toISOString() },
  { id: 'pipe-11', boardId: 'board-comercial', stageId: 'pausado', name: 'Auto Peças União', clientId: 'client-auto-pecas-uniao', responsavel: 'Pedro Gabriel', valor: 'R$ 2.200/mês', nota: 'Pausado a pedido do cliente — revisar em novembro.', anexos: [], atualizadoEm: new Date(Date.now() - 22 * 86_400_000).toISOString() },

  // tipo='tarefas' — um cartão por tarefa real de `mockAgencyTasks`, estágio = status atual.
  ...mockAgencyTasks.map((t) => ({
    id: `pipe-task-${t.id}`,
    boardId: 'board-tarefas-equipe',
    stageId: t.status ?? 'Para fazer',
    name: t.name,
    clientId: t.client?.id ?? null,
    taskId: t.id,
    responsavel: t.assignees[0] ?? 'Sem responsável',
    valor: null,
    nota: t.description ?? '',
    anexos: [],
    atualizadoEm: new Date(t.updated_at ?? Date.now()).toISOString(),
  })),

  // tipo='colaborador' — um cartão por pessoa, estágio = carga atual (mesmos
  // números de `operacao_por_colaborador`, ver mocks/handlers.ts).
  ...mockTeamMembers.map((m) => {
    const carga = m.id === 'user-admin-master' ? { clientes: 4, andamento: 5, atrasados: 2 } : { clientes: 2, andamento: 2, atrasados: 0 };
    const estagio = carga.atrasados > 0 ? 'sobrecarregado' : carga.andamento > 2 ? 'com-carga' : 'disponivel';
    return {
      id: `pipe-colab-${m.id}`,
      boardId: 'board-carga-equipe',
      stageId: estagio,
      name: m.name,
      clientId: null,
      responsavel: m.name,
      valor: null,
      nota: `${carga.clientes} cliente(s) · ${carga.andamento} em andamento${carga.atrasados > 0 ? ` · ${carga.atrasados} atrasado(s)` : ''}.`,
      anexos: [],
      atualizadoEm: new Date().toISOString(),
    };
  }),
];

/** GET /clients/:id/brand-kit. Cliente sem entrada aqui = sem kit cadastrado. */
export interface PipelineAnexo {
  id: string;
  nome: string;
  tipo: string;
  url: string;
  tamanho: number;
}

export const mockPipelineAnexos: Record<string, PipelineAnexo[]> = {};
