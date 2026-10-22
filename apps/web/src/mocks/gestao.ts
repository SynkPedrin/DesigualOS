import { http, HttpResponse } from 'msw';

/** Gestão da equipe na demo: dois colaboradores de exemplo. Só modo mock. */
const agora = Date.now();
const H = 3_600_000;
const evento = (id: string, deH: number, ateH: number, title: string | null) => ({
  id, start_at: new Date(agora + deH * H).toISOString(), end_at: new Date(agora + ateH * H).toISOString(),
  visible: title !== null, title, location: null, meeting_url: null, status: 'confirmed',
});
const tarefa = (id: string, name: string, dueH: number | null, status: string, atrasada: boolean, emAndamento: boolean) => ({
  id, name, status, url: null, due_date: dueH === null ? null : agora + dueH * H, updated_at: agora - H, list_name: 'Conteúdo',
  client: { id: 'client-cosentino', name: 'Cosentino' }, atrasada, em_andamento: emAndamento,
});
const pessoas = [
  {
    id: 'user-ana', name: 'Ana Ribeiro', email: 'ana@desigual.demo', avatar_url: null, job_title: 'Atendimento', presenca: 'online', last_seen_at: new Date(agora - 2 * 60_000).toISOString(),
    tarefas: { abertas: 6, atrasadas: 2, vencem_hoje: 1, vencem_na_semana: 3, em_andamento: 2, sem_prazo: 1, concluidas_7d: 4, concluidas_hoje: 1,
      agora: [tarefa('t1', 'Carrossel de outubro', 4, 'alteração', false, true), tarefa('t2', 'Relatório mensal', -20, 'aberto', true, false)] },
    demandas: { abertas: 3, atrasadas: 1 }, aprovacoes_pendentes: 1, clientes: 4,
    agenda: { conectada: true, hoje: 2, agora: evento('e1', -0.2, 0.8, 'Reunião de pauta'), proximo: evento('e2', 3, 4, null), eventos: [evento('e1', -0.2, 0.8, 'Reunião de pauta'), evento('e2', 3, 4, null)] },
    ultima_atividade: { summary: 'Moveu "Post de lançamento" para pronto', source: 'clickup', client_name: 'Cosentino', at: new Date(agora - 25 * 60_000).toISOString() },
  },
  {
    id: 'user-bruno', name: 'Bruno Lima', email: 'bruno@desigual.demo', avatar_url: null, job_title: 'Tráfego', presenca: 'offline', last_seen_at: new Date(agora - 26 * H).toISOString(),
    tarefas: { abertas: 3, atrasadas: 0, vencem_hoje: 0, vencem_na_semana: 2, em_andamento: 1, sem_prazo: 0, concluidas_7d: 2, concluidas_hoje: 0,
      agora: [tarefa('t3', 'Ajuste de público da campanha', 30, 'em andamento', false, true)] },
    demandas: { abertas: 1, atrasadas: 0 }, aprovacoes_pendentes: 0, clientes: 2,
    agenda: { conectada: false, hoje: 0, agora: null, proximo: null, eventos: [] },
    ultima_atividade: null,
  },
];

export const gestaoHandlers = [
  http.get('/gestao/equipe', () => HttpResponse.json({
    gerado_em: new Date().toISOString(),
    tarefas: {
      disponivel: true, truncado: false, sem_responsavel: 2, sem_responsavel_atrasadas: 1,
      listas: {
        atrasadas: [{ ...tarefa('t2', 'Relatório mensal', -20, 'aberto', true, false), donos: ['user-ana'], dias_de_atraso: 1 }],
        vencem_hoje: [{ ...tarefa('t1', 'Carrossel de outubro', 4, 'alteração', false, true), donos: ['user-ana'], dias_de_atraso: 0 }],
        entregues_hoje: [{ ...tarefa('t4', 'Post de lançamento', null, 'pronto', false, false), donos: ['user-ana'], dias_de_atraso: 0 }],
        sem_responsavel_atrasadas: [],
      },
    },
    feed: [{ id: 'f1', user_id: 'user-ana', user_name: 'Ana Ribeiro', summary: 'Moveu "Post de lançamento" para pronto', source: 'clickup', type: 'task.status', client_name: 'Cosentino', at: new Date(agora - 25 * 60_000).toISOString() }],
    pessoas,
  })),
  http.get('/gestao/equipe/:id', ({ params }) => {
    const p = pessoas.find((x) => x.id === params.id);
    if (!p) return HttpResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
    const { tarefas, agenda, ...pessoa } = p;
    return HttpResponse.json({
      pessoa, tarefas: { disponivel: true, truncado: false, ...tarefas, lista: tarefas.agora }, agenda: { conectada: agenda.conectada, eventos: agenda.eventos },
      demandas: [], aprovacoes: [], clientes: [{ id: 'client-cosentino', name: 'Cosentino', responsabilidades: ['account'] }], atividade: p.ultima_atividade ? [{ ...p.ultima_atividade, type: 'task.status' }] : [],
    });
  }),
];
