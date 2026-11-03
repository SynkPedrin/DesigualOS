/**
 * Cada agenda do Outlook numa cor (pedido do Pedro, 30/10/2026: "o calendário não só da agência, mas em outra cor o
 * da Manada Filmes também"). A principal é a da agência (roxo); uma agenda com "Manada" no nome é laranja; as outras
 * pegam as cores seguintes. As classes estão escritas por inteiro para o Tailwind encontrá-las.
 */

export interface CorDaAgenda {
  evento: string;
  ponto: string;
}

const AGENCIA: CorDaAgenda = { evento: 'border-roxo-eletrico/40 bg-roxo-eletrico/20 text-branco-cru hover:border-roxo-eletrico/70', ponto: 'bg-roxo-eletrico' };
const MANADA: CorDaAgenda = { evento: 'border-aviso/50 bg-aviso/20 text-branco-cru hover:border-aviso/80', ponto: 'bg-aviso' };
const OUTRAS: CorDaAgenda[] = [
  { evento: 'border-sinal/50 bg-sinal/15 text-branco-cru hover:border-sinal/80', ponto: 'bg-sinal' },
  { evento: 'border-sky-400/50 bg-sky-400/15 text-branco-cru hover:border-sky-400/80', ponto: 'bg-sky-400' },
  { evento: 'border-pink-400/50 bg-pink-400/15 text-branco-cru hover:border-pink-400/80', ponto: 'bg-pink-400' },
];

export interface AgendaPintada {
  id: string;
  nome: string;
  cor: CorDaAgenda;
  /** A agenda da agência: é nela que caem os eventos criados aqui no Desigual OS (sem agenda de origem). */
  principal: boolean;
}

export const COR_PADRAO = AGENCIA;

/** O Outlook chama a agenda padrão de "Calendário"; na aba, ela é a da agência (pedido do Pedro, 03/11/2026). */
const NOME_GENERICO = /^(calend[aá]rio|calendar|agenda)$/i;
const NOME_DA_AGENCIA = 'Desigual';

export function pintarAgendas(vinculadas: Array<{ external_calendar_id: string }>, daConta: Array<{ id: string; name: string | null; is_default?: boolean }>): AgendaPintada[] {
  const nomeDe = new Map(daConta.map((c) => [c.id, c.name ?? 'Agenda']));
  const ids = new Set(vinculadas.map((v) => v.external_calendar_id));
  // A padrão da conta, se estiver vinculada; senão a primeira vinculada. Sempre UMA principal quando há agenda.
  const principal = daConta.find((c) => c.is_default && ids.has(c.id))?.id ?? vinculadas[0]?.external_calendar_id;
  let proxima = 0;
  return vinculadas.map(({ external_calendar_id: id }) => {
    const nomeDoOutlook = nomeDe.get(id) ?? 'Agenda';
    const ehPrincipal = id === principal;
    const nome = ehPrincipal && NOME_GENERICO.test(nomeDoOutlook.trim()) ? NOME_DA_AGENCIA : nomeDoOutlook;
    const cor = /manada/i.test(nome) ? MANADA : ehPrincipal ? AGENCIA : OUTRAS[proxima++ % OUTRAS.length]!;
    return { id, nome, cor, principal: ehPrincipal };
  });
}

/** Aba "todas" ou o id de uma agenda. */
export const TODAS = 'todas';

/**
 * O evento entra na aba? Evento criado aqui (sem agenda de origem) é da agência, então aparece na aba da principal.
 * Evento de agenda que já foi desvinculada só aparece em "Todas": não some, mas também não finge ser de outra.
 */
export function eventoDaAba(calendarId: string | null | undefined, aba: string, agendas: AgendaPintada[]): boolean {
  if (aba === TODAS) return true;
  if (calendarId) return calendarId === aba;
  return agendas.some((a) => a.principal && a.id === aba);
}

/** Quantos eventos cada aba tem, para o número ao lado do nome. */
export function contarPorAba(eventos: Array<{ calendar_id?: string | null }>, agendas: AgendaPintada[]): Map<string, number> {
  const contagem = new Map<string, number>([[TODAS, eventos.length]]);
  for (const agenda of agendas) contagem.set(agenda.id, eventos.filter((e) => eventoDaAba(e.calendar_id, agenda.id, agendas)).length);
  return contagem;
}

/** GET /calendar/agendas: as agendas do Outlook vinculadas por toda a equipe, com o nome que cada uma tem no Outlook. */
export interface AgendaDaEquipe {
  calendar_id: string;
  user_id: string;
  nome: string | null;
  padrao: boolean;
}

/**
 * Agenda geral (pedido do Pedro, 03/11/2026: "junta todas as agendas em um único calendário"): as agendas da equipe
 * agrupadas pelo NOME, não pelo id, porque o Outlook dá um id diferente para a mesma agenda em cada conta. A agenda
 * padrão de cada pessoa é a da agência (Desigual); a "Manada Filmes" de qualquer pessoa cai numa aba só, em laranja.
 * Agenda sem nome conhecido fica fora das abas e aparece só em "Todas".
 */
export function agruparAgendasDaEquipe(lista: AgendaDaEquipe[]): { agendas: AgendaPintada[]; grupoDe: Map<string, string> } {
  const chaveDe = (nome: string) => `grupo:${nome.toLocaleLowerCase('pt-BR')}`;
  const nomes = new Map<string, string>([[chaveDe(NOME_DA_AGENCIA), NOME_DA_AGENCIA]]);
  const grupoDe = new Map<string, string>();
  for (const a of lista) {
    const nome = a.padrao && (!a.nome || NOME_GENERICO.test(a.nome.trim())) ? NOME_DA_AGENCIA : a.nome?.trim();
    if (!nome) continue;
    const chave = chaveDe(nome);
    if (!nomes.has(chave)) nomes.set(chave, nome);
    grupoDe.set(a.calendar_id, chave);
  }
  const daAgencia = chaveDe(NOME_DA_AGENCIA);
  const outras = [...nomes.entries()].filter(([k]) => k !== daAgencia).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  let proxima = 0;
  const agendas: AgendaPintada[] = [
    { id: daAgencia, nome: NOME_DA_AGENCIA, cor: AGENCIA, principal: true },
    ...outras.map(([id, nome]) => ({ id, nome, cor: /manada/i.test(nome) ? MANADA : OUTRAS[proxima++ % OUTRAS.length]!, principal: false })),
  ];
  return { agendas, grupoDe };
}

/**
 * Os eventos de toda a equipe num calendário só: cada um passa a apontar para o grupo da sua agenda (é o que as abas e
 * as cores leem), e a mesma reunião, que chega uma vez por convidado com Outlook, aparece uma vez. Entre as cópias
 * fica a da agenda mais específica: a reunião da Manada que caiu também na agenda padrão de quem foi convidado é da Manada.
 */
export function juntarEventos<E extends { id: string; visible: boolean; title: string | null; start_at: string; end_at: string; calendar_id?: string | null }>(
  eventos: E[],
  grupoDe: Map<string, string>,
  agendas: AgendaPintada[],
): E[] {
  const principal = new Set(agendas.filter((a) => a.principal).map((a) => a.id));
  const porChave = new Map<string, E>();
  for (const e of eventos) {
    const grupo = e.calendar_id ? (grupoDe.get(e.calendar_id) ?? e.calendar_id) : null;
    const evento = { ...e, calendar_id: grupo };
    const chave = e.visible && e.title ? `${e.title}|${e.start_at}|${e.end_at}` : e.id;
    const ja = porChave.get(chave);
    const generico = (x: E) => !x.calendar_id || principal.has(x.calendar_id);
    if (!ja || (generico(ja) && !generico(evento))) porChave.set(chave, evento);
  }
  return [...porChave.values()];
}

/**
 * A mesma reunião, vinda de duas agendas da mesma pessoa (a padrão e a da Manada, por exemplo), aparece uma vez só, e
 * reunião cancelada sai. Foi o "[SC] Inovação" que aparecia duas vezes no "Seu dia" do Hoje (03/11/2026).
 */
export function semRepetidas<E extends { id: string; visible: boolean; title: string | null; start_at: string; end_at: string; status?: string }>(eventos: E[]): E[] {
  const vistos = new Set<string>();
  return eventos.filter((e) => {
    if (e.status === 'cancelled') return false;
    const chave = e.visible && e.title ? `${e.title}|${e.start_at}|${e.end_at}` : e.id;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}
