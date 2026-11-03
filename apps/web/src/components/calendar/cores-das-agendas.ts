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
