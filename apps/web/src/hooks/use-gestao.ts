'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * GESTÃO DA EQUIPE — o que cada colaborador tem de trabalho agora (tarefas do
 * ClickUp, quinzenas, aprovações, agenda). Só administrador; o servidor decide
 * quem entra (colaboradores ativos da empresa) e esconde o que é particular.
 */

export interface TarefaDaGestao {
  id: string;
  name: string;
  status: string | null;
  url: string | null;
  due_date: number | null;
  updated_at: number | null;
  list_name: string | null;
  client: { id: string; name: string } | null;
  atrasada: boolean;
  em_andamento: boolean;
}

export interface ContagemDeTarefas {
  abertas: number;
  atrasadas: number;
  vencem_hoje: number;
  vencem_na_semana: number;
  em_andamento: number;
  sem_prazo: number;
  concluidas_7d: number;
  agora: TarefaDaGestao[];
}

export interface EventoDaGestao {
  id: string;
  start_at: string;
  end_at: string;
  /** false = compromisso particular: só "ocupado", sem título. */
  visible: boolean;
  title: string | null;
  location: string | null;
  meeting_url: string | null;
  status: string;
}

export interface PessoaDaGestao {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  job_title: string | null;
  last_seen_at: string | null;
  tarefas: ContagemDeTarefas | null;
  demandas: { abertas: number; atrasadas: number };
  aprovacoes_pendentes: number;
  clientes: number;
  agenda: { conectada: boolean; hoje: number; agora: EventoDaGestao | null; proximo: EventoDaGestao | null; eventos: EventoDaGestao[] };
  ultima_atividade: { summary: string | null; source: string; client_name: string | null; at: string } | null;
}

export interface PainelDaEquipe {
  gerado_em: string;
  tarefas: { disponivel: true; truncado: boolean; sem_responsavel: number; sem_responsavel_atrasadas: number } | { disponivel: false; erro: string };
  pessoas: PessoaDaGestao[];
}

export interface DetalheDoColaborador {
  pessoa: Pick<PessoaDaGestao, 'id' | 'name' | 'email' | 'avatar_url' | 'job_title' | 'last_seen_at'>;
  tarefas: ({ disponivel: true; truncado: boolean; lista: TarefaDaGestao[] } & ContagemDeTarefas) | { disponivel: false; erro: string };
  agenda: { conectada: boolean; eventos: EventoDaGestao[] };
  demandas: Array<{ id: string; title: string; status: string; priority: string; due_date: string | null; client_name: string | null; atrasada: boolean }>;
  aprovacoes: Array<{ id: string; resource_type: string; created_at: string; client_name: string | null }>;
  clientes: Array<{ id: string; name: string; responsabilidades: string[] }>;
  atividade: Array<{ summary: string | null; source: string; type: string; client_name: string | null; at: string }>;
}

export function usePainelDaEquipe() {
  return useQuery({
    queryKey: ['gestao', 'equipe'],
    queryFn: () => apiFetch<PainelDaEquipe>('/gestao/equipe'),
    // A tela fica aberta o dia todo: atualiza sozinha a cada 2 min (e ao voltar para a aba).
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });
}

export function useDetalheDoColaborador(id: string) {
  return useQuery({
    queryKey: ['gestao', 'equipe', id],
    queryFn: () => apiFetch<DetalheDoColaborador>(`/gestao/equipe/${id}`),
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });
}
