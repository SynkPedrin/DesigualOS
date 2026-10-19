'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { Surface } from './surface';
import { Skeleton } from './skeleton';
import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

export interface StatCardSublabel {
  text: string;
  /** 'urgent'/'warning' pintam a pill (3 urgentes, 2 atrasadas) — 'neutral' é texto
   *  simples sem pill, pra sublabel que só complementa sem alarmar. */
  tone?: 'urgent' | 'warning' | 'neutral';
}

const TONE_CLASS: Record<NonNullable<StatCardSublabel['tone']>, string> = {
  urgent: 'bg-erro/15 text-erro',
  warning: 'bg-aviso/15 text-aviso',
  neutral: 'text-nevoa',
};

export function StatCard({
  icon: Icon,
  iconClassName,
  label,
  value,
  sublabel,
  footer,
  href,
  accent = false,
  formatValue = (v) => Math.round(v).toLocaleString('pt-BR'),
  isLoading = false,
  isError = false,
}: {
  /** Ícone num círculo colorido à esquerda do número — opcional, card sem ele
   *  continua valendo (ex.: usos mais antigos/simples). */
  icon?: LucideIcon;
  iconClassName?: string;
  label: string;
  value: number;
  /** Chip complementar ("3 urgentes", "2 atrasadas") ao lado do número. Nunca
   *  inventado: só passa quem já tem a contagem real da pergunta associada. */
  sublabel?: StatCardSublabel;
  /** Terceira linha do card no mockup ("Tudo em dia!", "18 no prazo · 9
   *  atrasadas", "Agenda livre hoje"): a leitura do número em palavras, pra
   *  quem bate o olho e não quer interpretar o algarismo sozinho. Opcional,
   *  e sempre derivada de contagem real, nunca de um texto decorativo fixo. */
  footer?: string;
  /** Quando presente, o card inteiro vira link (rodapé com seta), igual ao
   *  mockup. Sem isso o card é só leitura, como já era. */
  href?: string;
  accent?: boolean;
  formatValue?: (value: number) => string;
  isLoading?: boolean;
  /** Fetch falhou pra essa métrica: mostra um indicador discreto no lugar do número em vez
   * de cair silenciosamente em "0" (que parece um dado real, só que errado). */
  isError?: boolean;
}) {
  const animated = useCountUp(isLoading ? 0 : value);

  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          {Icon && (
            <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl', iconClassName ?? 'bg-roxo-eletrico/15 text-roxo-eletrico')}>
              <Icon size={24} />
            </span>
          )}
          {/* ORDEM DO MOCKUP: a pergunta primeiro, a resposta embaixo.
            * Antes o número vinha no topo e o rótulo embaixo em caixa alta,
            * então o olho batia num "27" sem saber 27 do quê e só descobria
            * depois. Lendo de cima pra baixo agora sai "Tarefas para hoje: 27,
            * 18 no prazo e 9 atrasadas", que é como a pessoa fala. */}
          <div className="min-w-0">
            <p className="text-sm text-nevoa">{label}</p>
            {isLoading ? (
              <Skeleton className="mt-2 h-10 w-20" />
            ) : isError ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-erro" title="Não foi possível carregar essa métrica.">
                <span className="size-1.5 shrink-0 rounded-full bg-erro" />
                Falha ao carregar
              </p>
            ) : (
              <div className="flex items-center gap-2.5">
                <p className={cn('font-display text-4xl font-black tabular-nums', accent ? 'text-sinal' : 'text-branco-cru')}>
                  {formatValue(animated)}
                </p>
                {sublabel && (
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-semibold',
                      TONE_CLASS[sublabel.tone ?? 'neutral'],
                    )}
                  >
                    {sublabel.text}
                  </span>
                )}
              </div>
            )}
            {footer && !isLoading && !isError && <p className="mt-1 text-xs text-nevoa">{footer}</p>}
          </div>
        </div>
        {href && <ChevronRight size={18} className="mt-3 shrink-0 text-nevoa" />}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href}>
        <Surface level="grafite" className="p-5 transition-colors hover:border-roxo-eletrico/60">
          {conteudo}
        </Surface>
      </Link>
    );
  }

  return (
    <Surface level="grafite" className="p-5">
      {conteudo}
    </Surface>
  );
}
