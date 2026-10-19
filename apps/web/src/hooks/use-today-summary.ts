import { useQuery } from '@tanstack/react-query';
import type { ResultadoDeSecao } from '@desigual-os/types';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import {
  mapClientSummary,
  mapDemand,
  mapInboxThread,
  type AgencyTasksResponseWire,
  type ApprovalRequestWire,
  type CalendarEventWire,
  type ClientSummary,
  type Demand,
  type InboxThread,
  type MeResponse,
  type TodaySummaryWire,
} from '@/lib/api/contracts';

/**
 * GET /today/summary — UMA chamada no lugar das treze que a tela "Hoje"
 * disparava (medido em 13/10/2026: pool de três conexões, ~270ms de piso por
 * rota, tela assentando em 8 a 11 segundos).
 *
 * O hook devolve cada seção no mesmo formato de leitura dos hooks individuais
 * (`data` / `isPending` / `isError` / `error`), pra tela trocar a fonte sem
 * trocar a lógica. As regras do contrato são preservadas aqui:
 *
 *   - seção que falhou na origem volta `isError: true` com um
 *     `ApiRequestError` carregando o MESMO status que a rota devolveu — é o
 *     que mantém `clickupNaoVinculado` (409) e o "nenhum ClickUp conectado"
 *     (400) funcionando na página sem reescrever nada;
 *   - lista vazia real é `data: []`, nunca erro;
 *   - se a chamada agregada em si falhar (rede, 401), TODAS as seções marcam
 *     erro — a tela mostra cada uma como "não consegui ler" em vez de um
 *     painel de zeros que pareceria apuração.
 *
 * Os hooks individuais (useMyTasks, useInboxThreads, ...) continuam existindo
 * pras outras telas; aqui só muda QUEM busca.
 */

/** O formato de leitura de uma seção, espelhando o que a página consumia dos
 *  hooks individuais. */
export interface SecaoDoResumo<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: ApiRequestError | null;
}

export function useTodaySummary(intervaloDeHoje: { from: Date; to: Date }) {
  // ISO fixado na queryKey, mesmo motivo do comentário da página: um `new
  // Date()` recalculado a cada render nunca deixaria a consulta estabilizar.
  const fromIso = intervaloDeHoje.from.toISOString();
  const toIso = intervaloDeHoje.to.toISOString();

  const consulta = useQuery({
    queryKey: ['today-summary', fromIso, toIso],
    queryFn: () => apiFetch<TodaySummaryWire>(`/today/summary?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`),
    // O mais curto dos staleTimes que as seções tinham (inbox/approvals/
    // demands, 15s): o agregado não pode segurar dado velho por mais tempo
    // do que a tela segurava antes.
    staleTime: 15_000,
  });

  function secao<T>(ler: (resumo: TodaySummaryWire) => ResultadoDeSecao<T>): SecaoDoResumo<T> {
    if (consulta.isPending) return { data: undefined, isPending: true, isError: false, error: null };
    if (consulta.isError || !consulta.data) {
      return {
        data: undefined,
        isPending: false,
        isError: true,
        error:
          consulta.error instanceof ApiRequestError
            ? consulta.error
            : new ApiRequestError('Não consegui ler o resumo de hoje.', 0),
      };
    }
    const bruto = ler(consulta.data);
    /**
     * RESPOSTA FORA DO CONTRATO (proxy, deploy velho, body cortado): a seção
     * ausente ou malformada é falha de leitura, nunca derruba a tela. O smoke
     * do sidebar (telas-do-sidebar.test.tsx) responde o objeto mais pobre
     * possível pra toda rota, e a tela "Hoje" tem que renderizar mesmo assim —
     * é exatamente a situação de quem acabou de ser convidado.
     */
    if (!bruto || typeof bruto !== 'object' || typeof (bruto as { ok?: unknown }).ok !== 'boolean') {
      return {
        data: undefined,
        isPending: false,
        isError: true,
        error: new ApiRequestError('Resposta fora do contrato do resumo de hoje.', 0),
      };
    }
    if (bruto.ok) return { data: bruto.dados, isPending: false, isError: false, error: null };
    return {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiRequestError(`Seção indisponível (HTTP ${bruto.status}).`, bruto.status),
    };
  }

  function mapear<W, T>(secaoBruta: SecaoDoResumo<W>, converter: (dados: W) => T): SecaoDoResumo<T> {
    return { ...secaoBruta, data: secaoBruta.data === undefined ? undefined : converter(secaoBruta.data) };
  }

  return {
    me: secao((s) => s.me),
    minhasTarefas: secao((s) => s.minhas_tarefas),
    tarefasDaAgencia: secao((s) => s.tarefas_da_agencia),
    conversasAguardando: mapear(secao((s) => s.conversas_aguardando), (d) => d.threads.map(mapInboxThread)),
    conversasAguardandoMinhas: mapear(secao((s) => s.conversas_aguardando_minhas), (d) => d.threads.map(mapInboxThread)),
    conversasRecentes: mapear(secao((s) => s.conversas_recentes), (d) => d.threads.map(mapInboxThread)),
    eventosHoje: mapear(secao((s) => s.eventos_hoje), (d) => d.events),
    aprovacoesPendentes: mapear(secao((s) => s.aprovacoes_pendentes), (d) => d.approvals),
    minhasDemandas: mapear(secao((s) => s.minhas_demandas), (d) => d.demands.map(mapDemand)),
    clientes: mapear(secao((s) => s.clientes), (d) => d.clients.map(mapClientSummary)),
  };
}

/** Os tipos de dados por seção, pra quem recebe a seção como prop. */
export type SecaoMe = SecaoDoResumo<MeResponse>;
export type SecaoTarefas = SecaoDoResumo<AgencyTasksResponseWire>;
export type SecaoThreads = SecaoDoResumo<InboxThread[]>;
export type SecaoEventos = SecaoDoResumo<CalendarEventWire[]>;
export type SecaoAprovacoes = SecaoDoResumo<ApprovalRequestWire[]>;
export type SecaoDemandas = SecaoDoResumo<Demand[]>;
export type SecaoClientes = SecaoDoResumo<ClientSummary[]>;
