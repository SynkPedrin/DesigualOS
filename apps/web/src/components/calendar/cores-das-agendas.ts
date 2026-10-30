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
}

export const COR_PADRAO = AGENCIA;

export function pintarAgendas(vinculadas: Array<{ external_calendar_id: string }>, daConta: Array<{ id: string; name: string | null; is_default?: boolean }>): AgendaPintada[] {
  const nomeDe = new Map(daConta.map((c) => [c.id, c.name ?? 'Agenda']));
  const principal = daConta.find((c) => c.is_default)?.id ?? vinculadas[0]?.external_calendar_id;
  let proxima = 0;
  return vinculadas.map(({ external_calendar_id: id }) => {
    const nome = nomeDe.get(id) ?? 'Agenda';
    const cor = /manada/i.test(nome) ? MANADA : id === principal ? AGENCIA : OUTRAS[proxima++ % OUTRAS.length]!;
    return { id, nome, cor };
  });
}
