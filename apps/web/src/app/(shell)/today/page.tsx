'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Inbox,
  MapPin,
  MessageSquare,
  Plus,
  Video,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { MidiaHojePanel } from '@/components/media/hub/midia-hoje';
import { BotaoNovaTarefa } from '@/components/tasks/nova-tarefa';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { BentoBriefing, type InsightDoBento } from '@/components/bento/painel-de-insights';
import { useCalendarEvents } from '@/hooks/use-calendar';
import { useAgendas } from '@/components/calendar/microsoft-calendar-connect';
import { COR_PADRAO, semRepetidas, type AgendaPintada } from '@/components/calendar/cores-das-agendas';
import type { CalendarEventWire } from '@/lib/api/contracts';
import { useTodaySummary, type SecaoAprovacoes, type SecaoClientes, type SecaoTarefas, type SecaoThreads } from '@/hooks/use-today-summary';
import { formatClockTime, formatRelativeTime } from '@/lib/format';
import { ApiRequestError } from '@/lib/api/client';
import { TETO_DE_PAGINA, comoPiso, veioCheia } from '@/lib/teto-de-pagina';
import { cn } from '@/lib/utils';
import { tarefaConcluida } from '@/lib/tarefa-concluida';
import { EquipeNoHoje } from '@/components/gestao/equipe-no-hoje';
import { AguardandoAprovacao, faixaDaLinha, Prazo } from '@/components/ui/prazo';
import { urgenciaDoPrazo } from '@/lib/prazo';
import { useIsMaster } from '@/hooks/use-is-master';

/** 409 de "Minhas tarefas" = e-mail do ClickUp ainda não vinculado, estado
 *  esperado (resolve-se em /tasks), nunca uma falha de verdade. */
function clickupNaoVinculado(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409;
}

/**
 * HOJE, "o que eu preciso fazer agora", não um painel de números soltos.
 *
 * Cada stat/painel é uma contagem ou lista REAL de uma query que já existe.
 * Nada aqui inventa KPI. "Prioridades de hoje" mescla conversa aguardando,
 * demanda nova, tarefa atrasada e próxima reunião numa tabela só, mas cada
 * linha carrega o link pra ONDE o dado de verdade vive, nunca um resumo que
 * não dá pra abrir e conferir.
 *
 * REESCRITA DE 09/10/2026 pra bater o mockup `assets/TELASS - TUTORIAL/
 * tela-hoje.png`. O que entrou: o briefing do Bento no topo, as abas de
 * recorte em Prioridades, a tabela no lugar da lista, a tira da semana em
 * "Seu dia", o painel "Saúde operacional" e as proporções em "Tarefas do
 * dia". O que NÃO entrou, de propósito: nenhum número que o dado não
 * sustente. Onde o mockup mostra um valor que a nossa fonte não tem, o lugar
 * fica com o que é verdade aqui.
 */

function inicioDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function fimDoDia(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}
function somaDias(d: Date, dias: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + dias);
  return c;
}
function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function saudacao(hora: number): string {
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}
/**
 * `nome` é tipado como string, e mesmo assim chega `undefined` na prática: o
 * /me vem do servidor e o tipo é uma promessa do contrato, não uma garantia de
 * runtime. Sem esta guarda, um perfil sem nome derrubava a tela HOJE, a
 * primeira que um colaborador recém-convidado abre (medido em 08/10/2026 pelo
 * teste de fumaça do sidebar).
 */
function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim();
  return limpo ? (limpo.split(/\s+/)[0] ?? limpo) : 'Time';
}

type Tom = 'urgent' | 'warning' | 'neutral';
const BADGE_CLASS: Record<Tom, string> = {
  urgent: 'bg-erro/15 text-erro',
  warning: 'bg-aviso/15 text-aviso',
  neutral: 'bg-roxo-eletrico/15 text-roxo-eletrico',
};
const PONTO_CLASS: Record<Tom, string> = {
  urgent: 'bg-erro',
  warning: 'bg-aviso',
  neutral: 'bg-info',
};

/**
 * "Bloqueada" não é um campo do nosso contrato: o ClickUp manda `status` como
 * texto livre por workspace. Isto é uma HEURÍSTICA sobre esse texto, declarada
 * como tal, e é por isso que a aba some quando não acha nada em vez de mostrar
 * um zero que pareceria um fato apurado.
 */
function pareceBloqueada(status: string | null): boolean {
  const s = (status ?? '').toLowerCase();
  return s.includes('block') || s.includes('bloque') || s.includes('impedid');
}

type Recorte = 'minhas' | 'hoje' | 'atrasadas' | 'bloqueadas' | 'equipe';

interface ItemDePrioridade {
  id: string;
  /** O que é, na coluna "Item". */
  titulo: string;
  /** Nome do cliente, na coluna "Cliente / Projeto". Usado também no avatar. */
  cliente: string;
  badge: { label: string; tom: Tom };
  quando: string;
  /**
   * O prazo de verdade, quando o item tem um (tarefa, demanda). Com ele a coluna Prazo vira o selo de bater o olho
   * (HOJE, ATRASADA · 3 DIAS, Amanhã); sem ele (conversa, reunião) fica o `quando` em texto.
   */
  prazo?: string | number | null;
  href: string;
  /** `true` manda a linha pro recorte "Atrasadas". */
  atrasada: boolean;
  /** `true` manda a linha pro recorte "Hoje". */
  venceHoje: boolean;
  bloqueada: boolean;
  /** Linha de outra pessoa: só aparece no recorte "Equipe". */
  daEquipe: boolean;
  externo?: boolean;
}

export default function TodayPage() {
  // Quem administra a operação vê a equipe ao vivo no topo do Hoje (22/10/2026, pedido para a Tammy).
  const { isMaster } = useIsMaster();
  // Fixado no MOUNT: recalcular a cada render mudaria a queryKey das consultas
  // de calendário (intervalo [from,to] levemente diferente toda vez) e elas
  // nunca estabilizariam. Achado real, não hipotético (travou a aba Calendário
  // da ficha de cliente antes deste mesmo fix).
  const agora = useMemo(() => new Date(), []);

  const [recorte, setRecorte] = useState<Recorte>('minhas');
  const [deslocamentoDeDia, setDeslocamentoDeDia] = useState(0);

  const intervaloDeHoje = useMemo(() => ({ from: inicioDoDia(agora), to: fimDoDia(agora) }), [agora]);

  /**
   * UMA CHAMADA SÓ (13/10/2026). As treze requisições que esta tela disparava
   * viraram o agregado /today/summary: o servidor chama as mesmas rotas por
   * dentro e devolve cada resposta na própria seção, no mesmo formato de
   * leitura dos hooks individuais (`data`/`isPending`/`isError`/`error`). Um
   * `error` de seção carrega o status original da rota — é por isso que
   * `clickupNaoVinculado` (409) e o "nenhum ClickUp conectado" (400) seguem
   * funcionando abaixo sem mudança, e que uma lista vazia real nunca aparece
   * como falha de leitura.
   *
   * Efeito colateral proposital: "minhas demandas" não espera mais o /me. O
   * dono é resolvido no servidor, na mesma chamada — a dança anterior (busca
   * sem filtro seguida de correção, que por um instante mostrava demanda de
   * outra pessoa como prioridade sua) deixou de existir.
   */
  const resumo = useTodaySummary(intervaloDeHoje);
  const me = resumo.me.data;
  const minhasTarefas = resumo.minhasTarefas;
  const tarefasDaAgencia = resumo.tarefasDaAgencia;
  const conversasAguardando = resumo.conversasAguardando;
  const conversasAguardandoMinhas = resumo.conversasAguardandoMinhas;
  const eventosHojeBrutos = resumo.eventosHoje;
  // A mesma reunião chega uma vez por agenda vinculada (agora que toda agenda da conta entra): conta e mostra uma vez.
  const eventosHoje = { ...eventosHojeBrutos, data: eventosHojeBrutos.data && semRepetidas(eventosHojeBrutos.data) };
  const { agendas } = useAgendas();
  const aprovacoesPendentes = resumo.aprovacoesPendentes;
  const minhasDemandas = resumo.minhasDemandas;

  // "Seu dia" acompanha o dia escolhido na tira da semana, enquanto o cartão
  // "Reuniões hoje" continua preso a HOJE. São duas perguntas diferentes.
  // Enquanto o dia olhado É hoje, os eventos são os que o agregado já trouxe;
  // a query própria só dispara quando a pessoa navega pra outro dia.
  const diaSelecionado = useMemo(() => somaDias(agora, deslocamentoDeDia), [agora, deslocamentoDeDia]);
  const intervaloDoDiaEscolhido = useMemo(
    () => ({ from: inicioDoDia(diaSelecionado), to: fimDoDia(diaSelecionado) }),
    [diaSelecionado],
  );
  const olhandoHoje = deslocamentoDeDia === 0;
  // Com `memberId`: sem ele a consulta trazia a agenda da organização inteira ao navegar para outro dia.
  const eventosDoDiaRemoto = useCalendarEvents({ ...intervaloDoDiaEscolhido, memberId: me?.id }, { enabled: !olhandoHoje && Boolean(me?.id) });
  const eventosDoDia = olhandoHoje
    ? { data: eventosHoje.data, isPending: eventosHoje.isPending }
    : { data: eventosDoDiaRemoto.data && semRepetidas(eventosDoDiaRemoto.data), isPending: eventosDoDiaRemoto.isPending };
  /**
   * CONTAGEM DERIVADA DE PÁGINA É PISO, NÃO TOTAL. As duas listas abaixo vêm
   * paginadas em 30, então tudo que eu filtrar delas (demanda vencendo hoje,
   * cliente aguardando retorno) é no máximo o que coube. Com a página cheia,
   * o Bento diz "pelo menos N"; com página parcial, diz N, porque aí contou
   * tudo que existe. A alternativa seria o Bento afirmar um número exato que
   * ninguém apurou, e ele é justamente a parte da tela que a pessoa lê como
   * conclusão pronta.
   */
  const demandasSaoPiso = veioCheia(minhasDemandas.data?.length);
  const conversasSaoPiso = veioCheia(conversasAguardandoMinhas.data?.length);
  const aoMenos = (ehPiso: boolean) => (ehPiso ? 'pelo menos ' : '');
  const fimHoje = fimDoDia(agora).getTime();
  const inicioHoje = inicioDoDia(agora).getTime();
  const demandasVencendoHoje = (minhasDemandas.data ?? []).filter(
    (d) => d.dueDate !== null && new Date(d.dueDate).getTime() <= fimHoje && d.status !== 'done' && d.status !== 'cancelled',
  ).length;

  const tarefasAbertas = (minhasTarefas.data?.tasks ?? []).filter((t) => !tarefaConcluida(t));
  const tarefasAtrasadas = tarefasAbertas.filter((t) => t.due_date !== null && t.due_date < Date.now()).length;
  const tarefasNoPrazo = tarefasAbertas.length - tarefasAtrasadas;
  const tarefasConcluidas = (minhasTarefas.data?.tasks ?? []).filter((t) => tarefaConcluida(t)).length;
  const conversasUrgentes = (conversasAguardando.data ?? []).filter(
    (t) => t.lastMessageAt && Date.now() - new Date(t.lastMessageAt).getTime() > 10 * 60_000,
  ).length;
  const aprovacoesParadas = (aprovacoesPendentes.data ?? []).filter(
    (a) => Date.now() - new Date(a.created_at).getTime() > 2 * 24 * 60 * 60_000,
  ).length;

  const prioridades: ItemDePrioridade[] = [];
  for (const t of [...(conversasAguardando.data ?? [])].sort((a, b) => (a.lastMessageAt ?? '').localeCompare(b.lastMessageAt ?? ''))) {
    const urgente = t.lastMessageAt ? Date.now() - new Date(t.lastMessageAt).getTime() > 10 * 60_000 : false;
    prioridades.push({
      id: `conversa-${t.id}`,
      titulo: t.lastMessagePreview?.trim() || 'Conversa aguardando retorno',
      cliente: t.clientName ?? t.contactName,
      badge: urgente ? { label: 'Urgente', tom: 'urgent' } : { label: 'Pendente', tom: 'warning' },
      quando: t.lastMessageAt ? formatClockTime(t.lastMessageAt) : '',
      href: `/inbox?t=${t.id}`,
      atrasada: urgente,
      venceHoje: t.lastMessageAt ? new Date(t.lastMessageAt).getTime() >= inicioHoje : false,
      bloqueada: false,
      daEquipe: t.assignedToUserId !== null && t.assignedToUserId !== me?.id,
    });
  }
  // Prioridades são DA PESSOA: demanda nova de outro dono não é prioridade
  // minha só por existir. minhasDemandas já vem filtrada por ownerId.
  for (const d of (minhasDemandas.data ?? []).filter((d) => d.status === 'new')) {
    prioridades.push({
      id: `demanda-${d.id}`,
      titulo: d.title,
      cliente: d.clientName ?? 'Cliente',
      badge: { label: 'Nova quinzena', tom: 'neutral' },
      quando: formatRelativeTime(d.requestedAt),
      prazo: d.dueDate,
      href: `/demands/${d.id}`,
      atrasada: false,
      venceHoje: d.dueDate !== null && new Date(d.dueDate).getTime() <= fimHoje,
      bloqueada: false,
      daEquipe: false,
    });
  }
  // Demanda que vence hoje mas não é nova (já em briefing/produção) some do
  // painel sem isto. `!== 'new'` evita entrar duas vezes na mesma demanda.
  for (const d of (minhasDemandas.data ?? []).filter(
    (d) => d.status !== 'new' && d.status !== 'done' && d.status !== 'cancelled' && d.dueDate !== null && new Date(d.dueDate).getTime() <= fimHoje,
  )) {
    prioridades.push({
      id: `demanda-vence-${d.id}`,
      titulo: d.title,
      cliente: d.clientName ?? 'Cliente',
      badge: { label: 'Vence hoje', tom: 'urgent' },
      quando: formatRelativeTime(d.dueDate!),
      prazo: d.dueDate,
      href: `/demands/${d.id}`,
      atrasada: new Date(d.dueDate!).getTime() < Date.now(),
      venceHoje: true,
      bloqueada: false,
      daEquipe: false,
    });
  }
  // Tarefa atrasada é a mesma contagem do cartão "Tarefas para hoje". Antes só
  // existia como número ali, nunca como item que dá pra abrir daqui.
  for (const t of tarefasAbertas.filter((t) => t.due_date !== null && t.due_date < Date.now())) {
    prioridades.push({
      id: `tarefa-${t.id}`,
      titulo: t.name,
      cliente: t.client?.name ?? 'Sem cliente',
      badge: { label: 'Atrasada', tom: 'urgent' },
      quando: formatRelativeTime(new Date(t.due_date!).toISOString()),
      prazo: t.due_date,
      href: t.url ?? '/tasks',
      atrasada: true,
      venceHoje: t.due_date! >= inicioHoje,
      bloqueada: pareceBloqueada(t.status),
      daEquipe: false,
      externo: Boolean(t.url),
    });
  }
  // Tarefa que vence HOJE e ainda não passou da hora: antes só a atrasada entrava, e a aba "Hoje" deixava de fora
  // justamente o que é para hoje.
  for (const t of tarefasAbertas.filter((t) => t.due_date !== null && t.due_date >= Date.now() && urgenciaDoPrazo(t.due_date) === 'hoje')) {
    prioridades.push({
      id: `tarefa-hoje-${t.id}`,
      titulo: t.name,
      cliente: t.client?.name ?? 'Sem cliente',
      badge: { label: 'Vence hoje', tom: 'warning' },
      quando: formatClockTime(new Date(t.due_date!).toISOString()),
      prazo: t.due_date,
      href: t.url ?? '/tasks',
      atrasada: false,
      venceHoje: true,
      bloqueada: pareceBloqueada(t.status),
      daEquipe: false,
      externo: Boolean(t.url),
    });
  }
  const proximoEvento = (eventosHoje.data ?? []).find((e) => new Date(e.start_at).getTime() > Date.now());
  if (proximoEvento) {
    prioridades.push({
      id: `evento-${proximoEvento.id}`,
      titulo: proximoEvento.title ?? 'Reunião',
      cliente: proximoEvento.location ?? 'Agenda',
      badge: { label: 'Reunião', tom: 'neutral' },
      quando: formatClockTime(proximoEvento.start_at),
      href: '/calendar',
      atrasada: false,
      venceHoje: true,
      bloqueada: false,
      daEquipe: false,
    });
  }

  // O recorte "Equipe" troca a fonte: sai "o que é meu" e entra "o que está
  // aberto e atrasado na agência inteira", que é outra pergunta e por isso
  // outra query. Sem isto a aba mostraria as minhas linhas de novo.
  const prioridadesDaEquipe: ItemDePrioridade[] = (tarefasDaAgencia.data?.tasks ?? [])
    .filter((t) => !tarefaConcluida(t) && t.due_date !== null && t.due_date < Date.now())
    .map((t) => ({
      id: `equipe-${t.id}`,
      titulo: t.name,
      cliente: t.client?.name ?? 'Sem cliente',
      badge: { label: 'Atrasada', tom: 'urgent' as Tom },
      quando: formatRelativeTime(new Date(t.due_date!).toISOString()),
      prazo: t.due_date,
      href: t.url ?? '/tasks',
      atrasada: true,
      venceHoje: t.due_date! >= inicioHoje,
      bloqueada: pareceBloqueada(t.status),
      daEquipe: true,
      externo: Boolean(t.url),
    }));

  const temBloqueada = prioridades.some((p) => p.bloqueada) || prioridadesDaEquipe.some((p) => p.bloqueada);

  const porRecorte: Record<Recorte, ItemDePrioridade[]> = {
    minhas: prioridades,
    hoje: prioridades.filter((p) => p.venceHoje),
    atrasadas: prioridades.filter((p) => p.atrasada),
    bloqueadas: [...prioridades, ...prioridadesDaEquipe].filter((p) => p.bloqueada),
    equipe: prioridadesDaEquipe,
  };
  const selecionadas = porRecorte[recorte];
  // Teto de 10: com tarefa atrasada e demanda vencendo entrando na lista, 4
  // escondia a maioria do que o cartão de tarefas já avisava existir.
  const prioridadesOrdenadas = [...selecionadas]
    .sort((a, b) => (a.badge.tom === 'urgent' ? -1 : b.badge.tom === 'urgent' ? 1 : 0))
    .slice(0, 10);

  const algumPending = minhasTarefas.isPending || conversasAguardando.isPending || minhasDemandas.isPending || eventosHoje.isPending;

  /**
   * VAZIO NÃO É ERRO. "Nada pedindo atenção" só pode ser dito por quem
   * CONSEGUIU LER as fontes; com uma seção em falha e nenhuma prioridade
   * montada, a frase certa é a de leitura incompleta. O 409 do ClickUp não
   * entra: não é falha, é vínculo que ainda não existe.
   */
  const algumaFalhaDeLeitura =
    (minhasTarefas.isError && !clickupNaoVinculado(minhasTarefas.error)) ||
    conversasAguardando.isError ||
    minhasDemandas.isError ||
    eventosHoje.isError;

  /**
   * O BRIEFING DO BENTO. Cada marcador é uma contagem que esta mesma tela já
   * mostra em outro lugar, então nunca pode divergir do que está logo abaixo.
   * Cláusula com zero não entra: dizer "0 aprovações paradas" não ajuda
   * ninguém, e a lista vazia vira a frase de "nada fora do lugar".
   */
  const briefingPendente = minhasTarefas.isPending || aprovacoesPendentes.isPending || eventosHoje.isPending || minhasDemandas.isPending;
  const insights: InsightDoBento[] = [];
  if (tarefasAtrasadas > 0) {
    insights.push({
      id: 'tarefas-atrasadas',
      tom: 'urgente',
      href: '/tasks',
      texto: (
        <>
          Você tem <strong className="font-semibold text-branco-cru">{tarefasAtrasadas} tarefa{tarefasAtrasadas > 1 ? 's' : ''} atrasada{tarefasAtrasadas > 1 ? 's' : ''}</strong> que{' '}
          {tarefasAtrasadas > 1 ? 'precisam' : 'precisa'} de atenção.
        </>
      ),
    });
  }
  if (aprovacoesParadas > 0) {
    insights.push({
      id: 'aprovacoes-paradas',
      tom: 'atencao',
      href: '/approvals',
      texto: (
        <>
          <strong className="font-semibold text-branco-cru">{aprovacoesParadas} aprovaç{aprovacoesParadas > 1 ? 'ões' : 'ão'}</strong> aguardando há mais de 2 dias.
        </>
      ),
    });
  }
  if (demandasVencendoHoje > 0) {
    insights.push({
      id: 'demandas-vencendo',
      tom: 'atencao',
      href: '/demands',
      texto: (
        <>
          {aoMenos(demandasSaoPiso)}
          <strong className="font-semibold text-branco-cru">{demandasVencendoHoje} quinzena{demandasVencendoHoje > 1 ? 's' : ''}</strong> sua{demandasVencendoHoje > 1 ? 's' : ''} vence{demandasVencendoHoje > 1 ? 'm' : ''} hoje.
        </>
      ),
    });
  }
  if ((conversasAguardandoMinhas.data?.length ?? 0) > 0) {
    const n = conversasAguardandoMinhas.data!.length;
    insights.push({
      id: 'conversas-aguardando',
      tom: 'atencao',
      href: '/inbox',
      texto: (
        <>
          {aoMenos(conversasSaoPiso)}
          <strong className="font-semibold text-branco-cru">{n} cliente{n > 1 ? 's' : ''}</strong> aguardando seu retorno.
        </>
      ),
    });
  }
  const nEventos = eventosHoje.data?.length ?? 0;
  /**
   * "Agenda livre" só pode ser dito por quem CONSEGUIU LER a agenda. Com a
   * consulta em erro, `nEventos` também é 0, e sem esta guarda o Bento daria
   * a boa notícia por omissão: anunciaria o dia livre de alguém que pode ter
   * três reuniões. Falha de leitura vira silêncio, não otimismo.
   */
  if (!eventosHoje.isError) {
    insights.push({
      id: 'agenda',
      tom: nEventos > 0 ? 'neutro' : 'bom',
      href: '/calendar',
      texto:
        nEventos > 0 ? (
          <>
            Agenda de hoje com <strong className="font-semibold text-branco-cru">{nEventos} reuni{nEventos > 1 ? 'ões' : 'ão'}</strong>.
          </>
        ) : (
          <>Agenda livre hoje, bom momento pra avançar o que está em andamento.</>
        ),
    });
  }

  /*
   * SEM `zoom` (03/11/2026, "pra alguns usuários as informações estão saindo quebradas"). Até aqui o Hoje encolhia
   * para 0,68-0,8 de quem não é master, menor quanto mais baixa a janela. Num notebook isso deixava o texto
   * ilegível e, pior, enganava as container queries: com zoom a área parece maior do que é, abria o layout de três
   * colunas e cortava o prazo das prioridades. O tamanho agora é o do resto do app (a escala fluida do html e a
   * preferência em Configurações), e as colunas acompanham a largura de verdade. `pb-16`: o último painel sobe
   * acima da bolha do Bento, fixa no canto, que cobria as porcentagens de "Tarefas do dia".
   */
  return (
    <div className="@container mx-auto w-full max-w-[2400px] space-y-3 pb-16">
      <div>
        <PageHeader
          compact
          eyebrow="Hoje"
          title={`${saudacao(agora.getHours())}, ${me ? primeiroNome(me.name) : '...'}.`}
          description={`${new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(agora).replace(/^\w/, (c) => c.toUpperCase())} · veja o que precisa da sua atenção hoje.`}
          actions={<BotaoNovaTarefa />}
        />
      </div>

      {isMaster && <EquipeNoHoje />}

      <div className="grid grid-cols-1 gap-3 @min-[1900px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
      <BentoBriefing
        itens={insights}
        carregando={briefingPendente}
        vazio="Nada fora do lugar agora. Bom momento pra avançar o que já está em andamento."
        {...(insights.length === 0 && (eventosHoje.isError || minhasDemandas.isError || aprovacoesPendentes.isError)
          ? { erro: 'Não consegui ler parte dos seus dados agora, então não dá pra dizer que está tudo em ordem.' }
          : {})}
        acao={{ label: 'Ver detalhes', href: '/chat' }}
      />

      <div className="grid content-start gap-3 grid-cols-1 @min-[480px]:grid-cols-2 @min-[1100px]:grid-cols-4">
        <StatCard
          icon={MessageSquare}
          iconClassName="bg-roxo-eletrico/15 text-roxo-eletrico"
          className="bg-gradient-to-br from-roxo-eletrico/20 via-grafite/90 to-grafite/90"
          label="Conversas não respondidas"
          value={conversasAguardando.data?.length ?? 0}
          isLoading={conversasAguardando.isPending}
          isError={conversasAguardando.isError}
          href="/inbox"
          formatValue={(v) => comoPiso(Math.round(v))}
          footer={
            (conversasAguardando.data?.length ?? 0) === 0
              ? 'Tudo respondido por aqui'
              : veioCheia(conversasAguardando.data?.length)
                ? `pelo menos ${TETO_DE_PAGINA}, veja todas na Inbox`
                : `${conversasUrgentes} parada(s) há mais de 10 min`
          }
          {...(conversasUrgentes > 0 ? { sublabel: { text: `${conversasUrgentes} urgentes`, tone: 'urgent' as const } } : {})}
        />
        <StatCard
          icon={CheckSquare}
          iconClassName="bg-sucesso/15 text-sucesso"
          className="bg-gradient-to-br from-sucesso/15 via-grafite/90 to-grafite/90"
          label="Tarefas para hoje"
          value={tarefasAbertas.length}
          isLoading={minhasTarefas.isPending}
          isError={minhasTarefas.isError && !clickupNaoVinculado(minhasTarefas.error)}
          href="/tasks"
          {...(clickupNaoVinculado(minhasTarefas.error)
            ? { sublabel: { text: 'vincular ClickUp', tone: 'neutral' as const }, footer: 'Vincule seu e-mail do ClickUp pra ver suas tarefas' }
            : {
                footer: tarefasAbertas.length === 0 ? 'Nenhuma tarefa aberta' : `${tarefasNoPrazo} no prazo · ${tarefasAtrasadas} atrasadas`,
                ...(tarefasAtrasadas > 0 ? { sublabel: { text: `${tarefasAtrasadas} atrasadas`, tone: 'warning' as const } } : {}),
              })}
        />
        <StatCard
          icon={Calendar}
          iconClassName="bg-magenta-spark/15 text-magenta-spark"
          className="bg-gradient-to-br from-magenta-spark/20 via-grafite/90 to-grafite/90"
          label="Reuniões hoje"
          value={nEventos}
          isLoading={eventosHoje.isPending}
          isError={eventosHoje.isError}
          href="/calendar"
          footer={nEventos === 0 ? 'Agenda livre hoje' : 'Veja os horários em Seu dia'}
        />
        <StatCard
          icon={ClipboardCheck}
          iconClassName="bg-sinal/15 text-sinal"
          className="bg-gradient-to-br from-sinal/[0.12] via-grafite/90 to-grafite/90"
          label="Aprovações pendentes"
          value={aprovacoesPendentes.data?.length ?? 0}
          isLoading={aprovacoesPendentes.isPending}
          isError={aprovacoesPendentes.isError}
          href="/approvals"
          formatValue={(v) => comoPiso(Math.round(v))}
          footer={
            (aprovacoesPendentes.data?.length ?? 0) === 0
              ? 'Tudo alinhado por aqui'
              : veioCheia(aprovacoesPendentes.data?.length)
                ? `pelo menos ${TETO_DE_PAGINA}, veja todas em Aprovações`
                : `${aprovacoesParadas} parada(s) há mais de 2 dias`
          }
        />
      </div>
      </div>

      {/* `items-start`: sem isto o grid iguala a altura das duas colunas, e numa
          conta sem pendência o painel de Prioridades esticava até a altura de
          "Seu dia" mais "Saúde operacional", virando um retângulo vazio de uma
          tela de altura com uma frase no meio. Cada painel agora tem a altura
          do que tem dentro. */}
      <div className="grid grid-cols-1 items-start gap-3 @min-[1000px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @min-[1800px]:grid-cols-[minmax(0,5fr)_minmax(0,3.3fr)_minmax(0,3.7fr)]">
        <Surface className="@container flex min-w-0 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-base font-semibold text-branco-cru">Prioridades de hoje</h2>
              {prioridadesOrdenadas.length > 0 && (
                <span className="rounded-full bg-sinal/20 px-2.5 py-1 text-xs font-semibold text-sinal">{prioridadesOrdenadas.length}</span>
              )}
            </div>
            <AbasDeRecorte atual={recorte} aoTrocar={setRecorte} mostrarBloqueadas={temBloqueada} />
          </div>

          {algumPending ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : prioridadesOrdenadas.length === 0 ? (
            <p className="py-10 text-center text-sm text-nevoa">
              {algumaFalhaDeLeitura ? 'Não consegui ler parte das suas prioridades agora.' : VAZIO_POR_RECORTE[recorte]}
            </p>
          ) : (
            <TabelaDePrioridades itens={prioridadesOrdenadas} />
          )}

          {selecionadas.length > prioridadesOrdenadas.length && (
            <p className="pt-1 text-center font-mono text-[11px] text-nevoa">
              + {selecionadas.length - prioridadesOrdenadas.length} outra(s). Veja tudo em Tarefas e Campanhas.
            </p>
          )}
        </Surface>

        <div className="flex min-w-0 flex-col gap-3">
          <Surface className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-base font-semibold text-branco-cru">Seu dia</h2>
              <Link href="/calendar" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
                Ver calendário
                <ArrowRight size={11} />
              </Link>
            </div>

            <TiraDaSemana
              hoje={agora}
              deslocamento={deslocamentoDeDia}
              aoEscolher={setDeslocamentoDeDia}
            />

            {eventosDoDia.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !eventosDoDia.data || eventosDoDia.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-nevoa">
                {mesmoDia(diaSelecionado, agora) ? 'Nenhuma reunião marcada pra hoje.' : 'Nenhuma reunião marcada nesse dia.'}
              </p>
            ) : (
              <ul className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                {eventosDoDia.data.map((evento) => (
                  <CompromissoDoDia key={evento.id} evento={evento} agendas={agendas} agora={agora} />
                ))}
              </ul>
            )}

            <Link
              href="/calendar"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-sinal/30 py-2 text-sm text-nevoa transition-colors hover:border-sinal/70 hover:bg-sinal/5 hover:text-branco-cru"
            >
              <Plus size={14} />
              Nova reunião
            </Link>
          </Surface>

          <SaudeOperacional consulta={tarefasDaAgencia} />
        </div>

        {/* Terceira coluna: o resumo do que está esperando, empilhado. Mais estreito, vira uma faixa embaixo: 2x2
            (quatro painéis em três colunas deixavam um sozinho na linha de baixo), e quatro lado a lado quando cabe. */}
        <div className="grid min-w-0 grid-cols-1 content-start gap-3 @min-[640px]:grid-cols-2 @min-[1000px]:col-span-2 @min-[1300px]:grid-cols-4 @min-[1800px]:col-span-1 @min-[1800px]:grid-cols-1">
        <MidiaHojePanel />
        <ConversasRecentesPanel consulta={resumo.conversasRecentes} />
        <TarefasDoDiaPanel
          atrasadas={tarefasAtrasadas}
          noPrazo={tarefasNoPrazo}
          concluidas={tarefasConcluidas}
          isPending={minhasTarefas.isPending}
          indisponivel={clickupNaoVinculado(minhasTarefas.error)}
        />
        <AprovacoesPendentesPanel aprovacoes={aprovacoesPendentes} clientes={resumo.clientes} />
        </div>
      </div>
    </div>
  );
}

/**
 * Um compromisso do "Seu dia" (03/11/2026, pedido do Pedro: "elementos desconexos e desproporcionais"). Antes eram
 * quatro linhas soltas numa linha do tempo (hora, título, "Link da reunião", local) com o mesmo ponto roxo para
 * tudo. Agora cada compromisso é um bloco só: horário de início e fim à esquerda, a cor e o nome da agenda, e o
 * "Entrar" como botão. O que está acontecendo agora ou começa em até uma hora ganha destaque.
 */
function CompromissoDoDia({ evento, agendas, agora }: { evento: CalendarEventWire; agendas: AgendaPintada[]; agora: Date }) {
  const agenda = evento.calendar_id ? agendas.find((a) => a.id === evento.calendar_id) : agendas.find((a) => a.principal);
  const cor = agenda?.cor ?? COR_PADRAO;
  const inicio = new Date(evento.start_at).getTime();
  const fim = new Date(evento.end_at).getTime();
  const acontecendo = inicio <= agora.getTime() && agora.getTime() < fim;
  const minutosParaComecar = Math.round((inicio - agora.getTime()) / 60_000);
  const emBreve = !acontecendo && minutosParaComecar > 0 && minutosParaComecar <= 60;
  const passou = fim <= agora.getTime();
  const titulo = evento.visible ? evento.title || 'Sem título' : 'Ocupado';
  const detalhes = [agenda?.nome, evento.visible ? evento.location : null].filter(Boolean).join(' · ');

  return (
    <li
      className={cn(
        'flex items-stretch gap-3 rounded-xl border bg-carbono/40 p-2.5 transition-colors',
        acontecendo ? 'border-sinal/60 shadow-[0_0_0_1px_rgba(225,249,0,0.15)]' : 'border-branco-cru/[0.06] hover:border-sinal/30',
        passou && 'opacity-60',
      )}
    >
      <div className="flex w-12 shrink-0 flex-col justify-center text-right font-mono tabular-nums">
        <span className="text-sm font-semibold text-branco-cru">{formatClockTime(evento.start_at)}</span>
        <span className="text-[11px] text-nevoa">{formatClockTime(evento.end_at)}</span>
      </div>
      <span aria-hidden className={cn('w-1 shrink-0 rounded-full', cor.ponto)} />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-branco-cru" title={titulo}>{titulo}</p>
          {acontecendo && <span className="shrink-0 rounded-full bg-sinal px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-carbono">Agora</span>}
          {emBreve && <span className="shrink-0 rounded-full bg-roxo-eletrico/20 px-2 py-0.5 text-[10px] font-semibold text-lilas">em {minutosParaComecar} min</span>}
        </div>
        {detalhes && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-nevoa">
            {evento.visible && evento.location && <MapPin size={11} className="shrink-0" />}
            {detalhes}
          </p>
        )}
      </div>
      {evento.visible && evento.meeting_url && !passou && (
        <a
          href={evento.meeting_url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'flex shrink-0 items-center gap-1 self-center rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
            acontecendo || emBreve ? 'bg-sinal text-carbono hover:shadow-sinal' : 'border border-branco-cru/10 text-nevoa hover:border-sinal/50 hover:text-branco-cru',
          )}
        >
          <Video size={12} /> Entrar
        </a>
      )}
    </li>
  );
}

const ROTULO_DO_RECORTE: Record<Recorte, string> = {
  minhas: 'Minhas',
  hoje: 'Hoje',
  atrasadas: 'Atrasadas',
  bloqueadas: 'Bloqueadas',
  equipe: 'Equipe',
};
const VAZIO_POR_RECORTE: Record<Recorte, string> = {
  minhas: 'Nada pedindo atenção imediata agora.',
  hoje: 'Nada com prazo pra hoje.',
  atrasadas: 'Nenhum item atrasado. ',
  bloqueadas: 'Nenhum item marcado como bloqueado.',
  equipe: 'Nenhuma tarefa atrasada na agência agora.',
};

function AbasDeRecorte({
  atual,
  aoTrocar,
  mostrarBloqueadas,
}: {
  atual: Recorte;
  aoTrocar: (r: Recorte) => void;
  /** A aba "Bloqueadas" vive de uma heurística sobre texto de status. Quando
   *  nenhum status do workspace casa, ela some em vez de virar um zero que
   *  pareceria apuração. */
  mostrarBloqueadas: boolean;
}) {
  const abas: Recorte[] = mostrarBloqueadas
    ? ['minhas', 'hoje', 'atrasadas', 'bloqueadas', 'equipe']
    : ['minhas', 'hoje', 'atrasadas', 'equipe'];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {abas.map((aba) => (
        <button
          key={aba}
          type="button"
          onClick={() => aoTrocar(aba)}
          aria-pressed={atual === aba}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            atual === aba ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
          )}
        >
          {aba === 'atrasadas' && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-erro align-middle" />}
          {ROTULO_DO_RECORTE[aba]}
        </button>
      ))}
    </div>
  );
}

/**
 * TABELA, não lista (mockup). A diferença não é estética: com colunas fixas
 * dá pra varrer a coluna "Prazo" sozinha e achar o que está mais atrasado,
 * que é a pergunta que esta tela existe pra responder. Na lista anterior o
 * prazo ficava no fim de cada linha, em posição variável.
 *
 * As colunas acompanham a largura do CARTÃO (container query), não a da janela
 * (03/11/2026): num notebook o cartão divide a linha com "Seu dia" e as quatro
 * colunas espremiam o título em "Preparar o..." e cortavam o selo do prazo.
 * Estreito, cada linha é um bloco empilhado; médio, cliente e status descem
 * pra baixo do título e o prazo fica na sua coluna; largo, as quatro colunas.
 * Layout automático: prazo, status e cliente têm a largura do que mostram (o
 * selo "ATRASADA · 182 DIAS" nunca é cortado) e o título fica com o resto.
 */
function TabelaDePrioridades({ itens }: { itens: ItemDePrioridade[] }) {
  const th = 'px-2 pb-2 font-mono text-[11px] font-normal uppercase tracking-wider text-nevoa';
  return (
    <div className="-mx-2">
      <table className="w-full border-collapse text-left">
        <thead className="hidden @min-[520px]:table-header-group">
          <tr className="border-b border-grafite-elevado">
            <th className={th}>Item</th>
            <th className={cn(th, 'hidden @min-[820px]:table-cell')}>Cliente / Projeto</th>
            <th className={cn(th, 'hidden @min-[820px]:table-cell')}>Status</th>
            <th className={cn(th, 'text-right')}>Prazo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-grafite-elevado">
          {itens.map((item) => (
            <tr key={item.id} className="group transition-colors hover:bg-sinal/[0.04]">
              <td className={cn('w-full max-w-0 px-2 py-3 align-middle', faixaDaLinha(item.prazo !== undefined ? urgenciaDoPrazo(item.prazo) : item.atrasada ? 'atrasado' : null))}>
                <LinhaDeItem item={item}>
                  <span className={cn('size-2 shrink-0 rounded-full', PONTO_CLASS[item.badge.tom])} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-branco-cru" title={item.titulo}>{item.titulo}</span>
                </LinhaDeItem>
                {/* Sem as colunas, cliente, status (e no estreito o prazo)
                    descem pra baixo do título em vez de sumirem. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 @min-[820px]:hidden">
                  <span className="min-w-0 max-w-full truncate text-xs text-nevoa">{item.cliente}</span>
                  <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE_CLASS[item.badge.tom])}>{item.badge.label}</span>
                  <span className="@min-[520px]:hidden">
                    {item.prazo !== undefined ? <Prazo prazo={item.prazo} /> : item.quando && <span className="text-xs text-nevoa">{item.quando}</span>}
                  </span>
                </div>
              </td>
              <td className="hidden px-2 py-3 align-middle @min-[820px]:table-cell">
                <div className="flex items-center gap-2">
                  <EntityAvatar name={item.cliente} kind="client" size="sm" />
                  <span className="block max-w-[11rem] truncate text-sm text-nevoa" title={item.cliente}>{item.cliente}</span>
                </div>
              </td>
              <td className="hidden px-2 py-3 align-middle @min-[820px]:table-cell">
                <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-1 align-middle text-xs font-semibold', BADGE_CLASS[item.badge.tom])}>{item.badge.label}</span>
              </td>
              <td className="hidden whitespace-nowrap px-2 py-3 text-right align-middle text-sm @min-[520px]:table-cell">
                {item.prazo !== undefined ? <Prazo prazo={item.prazo} /> : <span className={item.atrasada ? 'text-erro' : 'text-nevoa'}>{item.quando}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tarefa do ClickUp abre no ClickUp (outra aba); o resto navega aqui dentro. */
function LinhaDeItem({ item, children }: { item: ItemDePrioridade; children: React.ReactNode }) {
  const classe = 'flex items-center gap-2';
  if (item.externo) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={classe}>
        {children}
      </a>
    );
  }
  return (
    <Link href={item.href} className={classe}>
      {children}
    </Link>
  );
}

/**
 * A TIRA DA SEMANA do mockup. Sete dias a partir de hoje, e as setas andam de
 * semana em semana. Escolher um dia troca a consulta de eventos, então o que
 * aparece embaixo é sempre o dia que está destacado aqui.
 */
function TiraDaSemana({
  hoje,
  deslocamento,
  aoEscolher,
}: {
  hoje: Date;
  deslocamento: number;
  aoEscolher: (d: number) => void;
}) {
  // A janela acompanha o dia escolhido: andando pra frente, a tira se
  // reposiciona em blocos de 7 em vez de deixar o dia selecionado fora dela.
  const inicioDaJanela = Math.floor(deslocamento / 7) * 7;
  const dias = Array.from({ length: 7 }, (_, i) => inicioDaJanela + i);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => aoEscolher(Math.max(0, deslocamento - 7))}
        disabled={inicioDaJanela === 0}
        aria-label="Semana anterior"
        className="shrink-0 rounded-md p-1 text-nevoa transition-colors hover:text-branco-cru disabled:opacity-30"
      >
        <ChevronLeft size={14} />
      </button>

      <div className="flex flex-1 justify-between gap-1">
        {dias.map((offset) => {
          const dia = somaDias(hoje, offset);
          const escolhido = offset === deslocamento;
          return (
            <button
              key={offset}
              type="button"
              onClick={() => aoEscolher(offset)}
              aria-pressed={escolhido}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center rounded-lg px-1 py-1.5 transition-colors',
                escolhido ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
              )}
            >
              <span className="font-mono text-[10px] uppercase">
                {new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(dia).replace('.', '').slice(0, 3)}
              </span>
              <span className="text-sm font-semibold tabular-nums">{dia.getDate()}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => aoEscolher(deslocamento + 7)}
        aria-label="Próxima semana"
        className="shrink-0 rounded-md p-1 text-nevoa transition-colors hover:text-branco-cru"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

type AbaDeSaude = 'risco' | 'volume' | 'atrasadas';
const ROTULO_DA_SAUDE: Record<AbaDeSaude, string> = {
  risco: 'Clientes em risco',
  volume: 'Maior volume',
  atrasadas: 'Com tarefas atrasadas',
};

/**
 * SAÚDE OPERACIONAL (mockup). Tudo aqui sai de uma fonte só, as tarefas da
 * agência, agrupadas por cliente. O rótulo de risco é uma régua declarada
 * sobre contagem real de atrasadas, não um índice calculado que ninguém
 * conseguiria conferir:
 *
 *   5 ou mais atrasadas -> Atenção
 *   1 a 4 atrasadas     -> Em observação
 *   nenhuma             -> Saudável
 *
 * A barra mostra a fração do que está atrasado sobre o total aberto daquele
 * cliente, que é o que a régua mede.
 */
function SaudeOperacional({ consulta }: { consulta: SecaoTarefas }) {
  const [aba, setAba] = useState<AbaDeSaude>('risco');

  const porCliente = useMemo(() => {
    const mapa = new Map<string, { nome: string; abertas: number; atrasadas: number }>();
    for (const t of consulta.data?.tasks ?? []) {
      if (tarefaConcluida(t)) continue;
      const nome = t.client?.name ?? 'Sem cliente';
      const atual = mapa.get(nome) ?? { nome, abertas: 0, atrasadas: 0 };
      atual.abertas += 1;
      if (t.due_date !== null && t.due_date < Date.now()) atual.atrasadas += 1;
      mapa.set(nome, atual);
    }
    return [...mapa.values()];
  }, [consulta.data]);

  const linhas = useMemo(() => {
    if (aba === 'volume') return [...porCliente].sort((a, b) => b.abertas - a.abertas).slice(0, 5);
    if (aba === 'atrasadas') return porCliente.filter((c) => c.atrasadas > 0).sort((a, b) => b.atrasadas - a.atrasadas).slice(0, 5);
    return [...porCliente].sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas).slice(0, 5);
  }, [aba, porCliente]);

  return (
    <Surface className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-semibold text-branco-cru">Saúde operacional</h2>
        <Link href="/clients" className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
          Ver todos
          <ArrowRight size={11} />
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['risco', 'volume', 'atrasadas'] as AbaDeSaude[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            aria-pressed={aba === a}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              aba === a ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
            )}
          >
            {ROTULO_DA_SAUDE[a]}
          </button>
        ))}
      </div>

      {consulta.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : consulta.isError ? (
        /* O 400 desta rota tem um motivo só e ele é acionável: nenhuma
           organização visível tem ClickUp ligado. Dizer "falhou" mandaria a
           pessoa procurar um defeito onde só falta uma conexão. */
        <p className="py-4 text-center text-sm text-nevoa">
          {consulta.error instanceof ApiRequestError && consulta.error.status === 400 ? (
            <>
              Nenhum ClickUp conectado ainda, então não dá pra medir carga por cliente.{' '}
              <Link href="/integrations" className="text-roxo-eletrico hover:underline">
                Conectar
              </Link>
            </>
          ) : (
            'Não foi possível ler as tarefas da agência agora.'
          )}
        </p>
      ) : linhas.length === 0 ? (
        <p className="py-4 text-center text-sm text-nevoa">
          {aba === 'atrasadas' ? 'Nenhum cliente com tarefa atrasada.' : 'Sem tarefa aberta em cliente nenhum.'}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {linhas.map((c) => {
            const fracao = c.abertas === 0 ? 0 : c.atrasadas / c.abertas;
            const rotulo = c.atrasadas >= 5 ? 'Atenção' : c.atrasadas > 0 ? 'Em observação' : 'Saudável';
            const corDoRotulo = c.atrasadas >= 5 ? 'bg-erro/15 text-erro' : c.atrasadas > 0 ? 'bg-aviso/15 text-aviso' : 'bg-sucesso/15 text-sucesso';
            const corDaBarra = c.atrasadas >= 5 ? 'bg-erro' : c.atrasadas > 0 ? 'bg-aviso' : 'bg-sucesso';
            return (
              <li key={c.nome} className="flex items-center gap-2.5">
                <EntityAvatar name={c.nome} kind="client" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-branco-cru">{c.nome}</p>
                  <p className="truncate text-xs text-nevoa">
                    {c.atrasadas > 0 ? `${c.atrasadas} de ${c.abertas} atrasada(s)` : `${c.abertas} aberta(s), nenhuma atrasada`}
                  </p>
                </div>
                <div className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-grafite-elevado sm:block">
                  <div className={cn('h-full rounded-full', corDaBarra)} style={{ width: `${Math.max(fracao * 100, c.atrasadas > 0 ? 8 : 100)}%` }} />
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', corDoRotulo)}>{rotulo}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

function PainelDeRodape({
  titulo,
  href,
  isPending,
  isError = false,
  vazio,
  mensagemDeVazio = 'Nada por aqui no momento.',
  explicacaoDoVazio,
  children,
}: {
  titulo: string;
  href: string;
  isPending: boolean;
  /** Falha de leitura da seção. Distinta de vazio: um painel que não conseguiu
   *  ler não pode posar de "nada por aqui". */
  isError?: boolean;
  vazio: boolean;
  mensagemDeVazio?: string;
  /** Segunda linha do estado vazio (mockup): o que fará aparecer algo aqui. */
  explicacaoDoVazio?: string;
  children: React.ReactNode;
}) {
  return (
    <Surface className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-branco-cru">{titulo}</h2>
        <Link href={href} className="flex items-center gap-1 font-mono text-[11px] text-nevoa hover:text-branco-cru">
          Ver todas
          <ArrowRight size={11} />
        </Link>
      </div>
      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="py-6 text-center text-sm text-nevoa">Não consegui ler isto agora.</p>
      ) : vazio ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <Inbox size={22} className="text-nevoa/60" />
          <p className="text-sm text-nevoa">{mensagemDeVazio}</p>
          {explicacaoDoVazio && <p className="max-w-[26ch] text-xs text-nevoa/70">{explicacaoDoVazio}</p>}
        </div>
      ) : (
        children
      )}
    </Surface>
  );
}

/**
 * As 4 conversas do rodapé chegam pelo agregado (/today/summary), que pede
 * `assigned=me&limit=4` à mesma rota de antes. O corte em 4 continua seguro
 * porque o servidor ordena por `last_message_at` desc (communications/
 * service.ts), exatamente o critério que este painel usa.
 */
const RECENTES_NO_RODAPE = 4;

function ConversasRecentesPanel({ consulta }: { consulta: SecaoThreads }) {
  const threads = [...(consulta.data ?? [])].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

  return (
    <PainelDeRodape
      titulo="Conversas recentes"
      href="/inbox"
      isPending={consulta.isPending}
      isError={consulta.isError}
      vazio={threads.length === 0}
      mensagemDeVazio="Nenhuma conversa atribuída a você."
      explicacaoDoVazio="Conversas que chegarem pra você aparecem aqui."
    >
      <ul className="space-y-2.5">
        {threads.map((t) => (
          <li key={t.id}>
            <Link href={`/inbox?t=${t.id}`} className="flex items-start gap-2.5">
              <div className="relative shrink-0">
                <EntityAvatar name={t.clientName ?? t.contactName} kind="client" size="sm" />
                {t.channel === 'whatsapp' && (
                  <img src="/logos/whatsapp.webp" alt="" className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-1 ring-grafite" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-branco-cru">{t.clientName ?? t.contactName}</p>
                {/* A PRÉVIA, que o contrato já trazia e a tela nunca lia: sem
                    ela a pessoa via só o nome e tinha que abrir a conversa pra
                    saber se era urgente. */}
                {t.lastMessagePreview && <p className="truncate text-xs text-nevoa">{t.lastMessagePreview}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {t.lastMessageAt && <span className="text-[11px] text-nevoa">{formatClockTime(t.lastMessageAt)}</span>}
                {t.unreadCount > 0 && (
                  <span className="min-w-[18px] rounded-full bg-roxo-eletrico px-1.5 text-center text-[10px] font-semibold text-branco-cru">
                    {t.unreadCount}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </PainelDeRodape>
  );
}

/**
 * TAREFAS DO DIA como proporção (mockup), não como amostra de quatro nomes.
 * Quatro nomes de um total de 27 não dizem como o dia está; "9 atrasadas de
 * 27" diz. O caminho pra lista continua no "Ver todas" do cabeçalho.
 */
function TarefasDoDiaPanel({
  atrasadas,
  noPrazo,
  concluidas,
  isPending,
  indisponivel,
}: {
  atrasadas: number;
  noPrazo: number;
  concluidas: number;
  isPending: boolean;
  indisponivel: boolean;
}) {
  const total = atrasadas + noPrazo + concluidas;
  const faixas = [
    { id: 'atrasadas', rotulo: `${atrasadas} atrasada${atrasadas === 1 ? '' : 's'}`, valor: atrasadas, cor: 'bg-erro', ponto: 'bg-erro' },
    { id: 'no-prazo', rotulo: `${noPrazo} no prazo`, valor: noPrazo, cor: 'bg-roxo-eletrico', ponto: 'bg-roxo-eletrico' },
    { id: 'concluidas', rotulo: `${concluidas} concluída${concluidas === 1 ? '' : 's'}`, valor: concluidas, cor: 'bg-sucesso', ponto: 'bg-sucesso' },
  ];

  return (
    <PainelDeRodape
      titulo="Tarefas do dia"
      href="/tasks"
      isPending={isPending}
      vazio={indisponivel || total === 0}
      mensagemDeVazio={indisponivel ? 'ClickUp ainda não vinculado.' : 'Nenhuma tarefa atribuída a você.'}
      explicacaoDoVazio={indisponivel ? 'Vincule seu e-mail do ClickUp em Tarefas.' : 'Tarefas atribuídas a você aparecem aqui.'}
    >
      <>
        <p className="font-mono text-[11px] text-nevoa">{total} tarefa{total === 1 ? '' : 's'} no total</p>
        <ul className="space-y-2.5">
          {faixas.map((f) => {
            const pct = total === 0 ? 0 : Math.round((f.valor / total) * 100);
            return (
              <li key={f.id} className="flex items-center gap-2.5">
                <span className={cn('size-2 shrink-0 rounded-full', f.ponto)} />
                <span className="w-28 shrink-0 truncate text-xs text-branco-cru">{f.rotulo}</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-grafite-elevado">
                  <div className={cn('h-full rounded-full', f.cor)} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-nevoa">{pct}%</span>
              </li>
            );
          })}
        </ul>
      </>
    </PainelDeRodape>
  );
}

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  brief: 'Briefing',
  creative: 'Criativos',
  copy: 'Copy',
  task: 'Tarefa',
  campaign: 'Campanha',
  budget: 'Orçamento',
  publication: 'Publicação',
};

/**
 * As aprovações e os nomes de cliente chegam pelo agregado (/today/summary),
 * na mesma página de 30 que o cartão lá em cima lê — o corte para 4 é local.
 * A rota ordena por `created_at` desc (approvals/service.ts), então os 4
 * primeiros da lista são os 4 certos.
 */
function AprovacoesPendentesPanel({ aprovacoes, clientes }: { aprovacoes: SecaoAprovacoes; clientes: SecaoClientes }) {
  const nomeDoCliente = (clientId: string | null) => clientes.data?.find((c) => c.id === clientId)?.name ?? 'Interno';
  const lista = (aprovacoes.data ?? []).slice(0, RECENTES_NO_RODAPE);

  return (
    <PainelDeRodape
      titulo="Aprovações pendentes"
      href="/approvals"
      isPending={aprovacoes.isPending || clientes.isPending}
      isError={aprovacoes.isError || clientes.isError}
      vazio={lista.length === 0}
      mensagemDeVazio="Nada por aqui no momento."
      explicacaoDoVazio="Quando houver aprovações pendentes, elas aparecerão aqui."
    >
      <ul className="space-y-2">
        {lista.map((a) => (
          <li key={a.id}>
            <Link href="/approvals" className="flex items-center gap-2.5">
              <EntityAvatar name={nomeDoCliente(a.client_id)} kind="client" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-branco-cru">{RESOURCE_TYPE_LABEL[a.resource_type] ?? a.resource_type}</p>
                <p className="truncate text-xs text-nevoa">{nomeDoCliente(a.client_id)}{a.version ? ` · ${a.version}` : ''}</p>
              </div>
              <AguardandoAprovacao desde={a.created_at} rotulo="Aprovar" className="shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </PainelDeRodape>
  );
}
