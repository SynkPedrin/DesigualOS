import { AlertTriangle, CalendarClock, CheckCircle2, Hourglass } from 'lucide-react';
import { textoDoPrazo, urgenciaDoPrazo, type Urgencia } from '@/lib/prazo';
import { cn } from '@/lib/utils';

/**
 * O PRAZO DE BATER O OLHO. Um só jeito de mostrar prazo em todos os painéis, para a pessoa saber o que é do dia
 * sem ler: HOJE em maiúsculas na cor de sinal, ATRASADA em vermelho cheio, Amanhã com contorno, o resto discreto.
 * A régua do dia (fuso de São Paulo) mora em lib/prazo.ts.
 */
const ESTILO: Record<Urgencia, { classe: string; icone: typeof CalendarClock | null }> = {
  atrasado: { classe: 'bg-erro text-white font-bold uppercase tracking-wide', icone: AlertTriangle },
  hoje: { classe: 'bg-sinal text-carbono font-bold uppercase tracking-wide', icone: CalendarClock },
  amanha: { classe: 'border border-aviso/60 text-aviso font-medium', icone: null },
  semana: { classe: 'text-branco-cru', icone: null },
  depois: { classe: 'text-nevoa', icone: null },
};

export function Prazo({
  prazo,
  feito = false,
  temHora,
  feminino = true,
  className,
}: {
  prazo: Date | string | number | null | undefined;
  /** Concluído não é urgente, por mais antigo que seja o prazo. */
  feito?: boolean;
  temHora?: boolean;
  /** "ATRASADA" (tarefa, demanda) ou "ATRASADO" (pedido, pagamento). */
  feminino?: boolean;
  className?: string;
}) {
  const urgencia = feito ? null : urgenciaDoPrazo(prazo, temHora === undefined ? {} : { temHora });
  if (prazo === null || prazo === undefined || prazo === '') return <span className={cn('text-xs text-nevoa/60', className)}>Sem prazo</span>;
  if (feito) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-sucesso', className)}>
        <CheckCircle2 size={12} aria-hidden />
        Feito
      </span>
    );
  }
  if (!urgencia) return null;
  const e = ESTILO[urgencia];
  const Icone = e.icone;
  const destaque = urgencia === 'atrasado' || urgencia === 'hoje' || urgencia === 'amanha';
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-[11px] leading-none', destaque && 'rounded px-1.5 py-1', e.classe, className)}>
      {Icone && <Icone size={11} aria-hidden />}
      {textoDoPrazo(prazo, urgencia, { feminino })}
    </span>
  );
}

/** Esperando a decisão de alguém. Roxo cheio, sempre igual, em qualquer tela. Parado há 2+ dias, diz há quanto. */
export function AguardandoAprovacao({ desde, rotulo = 'Aguardando aprovação', className }: { desde?: Date | string | null; rotulo?: string; className?: string }) {
  const dias = desde ? Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000) : 0;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded bg-roxo-eletrico px-1.5 py-1 text-[11px] font-bold uppercase leading-none tracking-wide text-white', className)}>
      <Hourglass size={11} aria-hidden />
      {rotulo}
      {dias >= 2 && <span className="font-medium normal-case opacity-90">· há {dias} dias</span>}
    </span>
  );
}

/** Faixa à esquerda da linha, para a lista inteira se ler de longe: vermelho atrasado, sinal hoje, roxo aprovação. */
export function faixaDaLinha(sinal: Urgencia | 'aprovacao' | null | undefined): string {
  if (sinal === 'atrasado') return 'border-l-[3px] border-l-erro';
  if (sinal === 'hoje') return 'border-l-[3px] border-l-sinal';
  if (sinal === 'aprovacao') return 'border-l-[3px] border-l-roxo-eletrico';
  return 'border-l-[3px] border-l-transparent';
}

export { urgenciaDoPrazo };
