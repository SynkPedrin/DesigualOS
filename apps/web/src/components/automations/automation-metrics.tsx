'use client';

import { motion } from 'framer-motion';
import { CalendarCheck, CheckCircle2, Clock, Zap, type LucideIcon } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useAutomationMetrics } from '@/hooks/use-automations';
import { cn } from '@/lib/utils';

function formatTimeSaved(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = minutes / 60;
  return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

interface MetricCardProps {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  value: string;
  delta?: string | null;
  deltaTone?: 'sucesso' | 'erro' | 'nevoa';
  caption?: string;
}

function MetricCard({ icon: Icon, iconClassName, label, value, delta, deltaTone = 'nevoa', caption }: MetricCardProps) {
  return (
    <Surface level="grafite" className="p-4">
      <div className="flex items-center gap-3">
        <span className={cn('flex size-9 items-center justify-center rounded-md', iconClassName)}>
          <Icon size={16} />
        </span>
        <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{label}</p>
      </div>
      <p className="mt-3 font-display text-3xl font-black tabular-nums text-branco-cru">{value}</p>
      {delta != null ? (
        <p
          className={cn(
            'mt-1 text-xs',
            deltaTone === 'sucesso' && 'text-sucesso',
            deltaTone === 'erro' && 'text-erro',
            deltaTone === 'nevoa' && 'text-nevoa',
          )}
        >
          {delta}
        </p>
      ) : caption ? (
        <p className="mt-1 text-xs text-nevoa">{caption}</p>
      ) : null}
    </Surface>
  );
}

export function AutomationMetrics() {
  const { data: metrics, isPending, isError } = useAutomationMetrics();

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
    );
  }

  const unavailable = { title: 'Não foi possível carregar esta métrica.' };

  const cards: MetricCardProps[] = isError || !metrics
    ? [
        { icon: Zap, iconClassName: 'bg-roxo-eletrico/10 text-ametista', label: 'Automações ativas', value: '-' },
        { icon: CalendarCheck, iconClassName: 'bg-info/10 text-info', label: 'Execuções hoje', value: '-' },
        { icon: Clock, iconClassName: 'bg-sinal/10 text-sinal', label: 'Economia de tempo', value: '-' },
        { icon: CheckCircle2, iconClassName: 'bg-sucesso/10 text-sucesso', label: 'Taxa de sucesso', value: '-' },
      ]
    : [
        {
          icon: Zap,
          iconClassName: 'bg-roxo-eletrico/10 text-ametista',
          label: 'Automações ativas',
          value: String(metrics.activeCount),
          delta: metrics.activeDeltaMonth !== null ? `${signed(metrics.activeDeltaMonth)} este mês` : null,
          deltaTone: metrics.activeDeltaMonth && metrics.activeDeltaMonth > 0 ? 'sucesso' : 'nevoa',
        },
        {
          icon: CalendarCheck,
          iconClassName: 'bg-info/10 text-info',
          label: 'Execuções hoje',
          value: String(metrics.runsToday),
          delta: metrics.runsTodayDelta !== null ? `${signed(metrics.runsTodayDelta)} que ontem` : null,
          deltaTone:
            metrics.runsTodayDelta === null ? 'nevoa' : metrics.runsTodayDelta >= 0 ? 'sucesso' : 'erro',
        },
        {
          icon: Clock,
          iconClassName: 'bg-sinal/10 text-sinal',
          label: 'Economia de tempo',
          value: metrics.timeSavedMinutes !== null ? formatTimeSaved(metrics.timeSavedMinutes) : '-',
          caption: metrics.timeSavedMinutes === null ? 'Cadastre estimativas nas automações' : 'estimativa acumulada',
        },
        {
          icon: CheckCircle2,
          iconClassName: 'bg-sucesso/10 text-sucesso',
          label: 'Taxa de sucesso',
          value: metrics.successRate !== null ? `${metrics.successRate}%` : '-',
          delta: metrics.successDeltaWeek !== null ? `${signed(metrics.successDeltaWeek)}% que semana passada` : null,
          deltaTone:
            metrics.successDeltaWeek === null ? 'nevoa' : metrics.successDeltaWeek >= 0 ? 'sucesso' : 'erro',
        },
      ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" {...(isError ? unavailable : {})}>
      {cards.map((card, i) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: i * 0.05, ease: 'easeOut' }}
        >
          <MetricCard {...card} />
        </motion.div>
      ))}
    </div>
  );
}
