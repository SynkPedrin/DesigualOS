/**
 * prazo.ts: em que DIA cai um prazo, do ponto de vista de quem olha a tela (fuso de São Paulo).
 *
 * Todo painel usa esta mesma régua para o destaque de "HOJE", "ATRASADA" e "Amanhã". Antes cada tela tinha a sua
 * (horas desde agora, `new Date()` no fuso da máquina, "há 3 dias" em texto corrido) e a pessoa precisava LER para
 * descobrir o que era para hoje. A comparação é por dia de calendário: um prazo às 23h59 de hoje é "HOJE", não
 * "em 14 horas"; um prazo às 9h de hoje, olhado às 15h, já é "ATRASADA".
 */
export type Urgencia = 'atrasado' | 'hoje' | 'amanha' | 'semana' | 'depois';

const FUSO = 'America/Sao_Paulo';
const diaFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "AAAA-MM-DD" do dia em São Paulo. Data só de dia ("2026-10-26") é tratada como esse dia, sem fuso. */
export function diaEmSaoPaulo(valor: Date | string | number): string {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  return diaFormatter.format(new Date(valor));
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Quão perto está o prazo. Nulo quando não há prazo. Com hora (`temHora`), passar da hora no próprio dia já é
 * atraso; sem hora (prazo só de dia), o dia inteiro conta como "hoje".
 */
export function urgenciaDoPrazo(prazo: Date | string | number | null | undefined, opcoes: { agora?: Date; temHora?: boolean } = {}): Urgencia | null {
  if (prazo === null || prazo === undefined || prazo === '') return null;
  const agora = opcoes.agora ?? new Date();
  const soDia = typeof prazo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(prazo);
  const temHora = opcoes.temHora ?? !soDia;
  const dias = diasEntre(diaEmSaoPaulo(agora), diaEmSaoPaulo(prazo));
  if (dias < 0) return 'atrasado';
  if (dias === 0) return temHora && new Date(prazo).getTime() < agora.getTime() ? 'atrasado' : 'hoje';
  if (dias === 1) return 'amanha';
  if (dias <= 7) return 'semana';
  return 'depois';
}

/** Texto curto do prazo: "HOJE", "ATRASADA · 3 DIAS", "Amanhã", "Em 4 dias", "12/11". */
export function textoDoPrazo(prazo: Date | string | number, urgencia: Urgencia, opcoes: { agora?: Date; feminino?: boolean } = {}): string {
  const agora = opcoes.agora ?? new Date();
  const dias = diasEntre(diaEmSaoPaulo(agora), diaEmSaoPaulo(prazo));
  const atrasada = opcoes.feminino === false ? 'ATRASADO' : 'ATRASADA';
  switch (urgencia) {
    case 'atrasado':
      return dias === 0 ? `${atrasada} · HOJE` : `${atrasada} · ${-dias} ${-dias === 1 ? 'DIA' : 'DIAS'}`;
    case 'hoje':
      return 'HOJE';
    case 'amanha':
      return 'Amanhã';
    case 'semana':
      return `Em ${dias} dias`;
    default: {
      const [, m, d] = diaEmSaoPaulo(prazo).split('-');
      return `${d}/${m}`;
    }
  }
}

/**
 * A coluna (ou o status) diz que o item está esperando a decisão de alguém? No quadro geral a categoria já vem
 * `em_aprovacao`; nos quadros do ClickUp o nome da coluna é livre ("Aprovação", "Aguardando aprovação do cliente",
 * "Em aprovação"), então vale o texto. Só "aprova": "revisão" é trabalho da equipe, não espera de decisão.
 */
export function estaEmAprovacao(estagio: { categoria?: string | null; label?: string | null; clickupStatus?: string | null } | string | null | undefined): boolean {
  if (!estagio) return false;
  if (typeof estagio === 'string') return /aprova|approval/i.test(estagio);
  if (estagio.categoria === 'em_aprovacao') return true;
  if (estagio.categoria) return false;
  return /aprova|approval/i.test(`${estagio.label ?? ''} ${estagio.clickupStatus ?? ''}`);
}
