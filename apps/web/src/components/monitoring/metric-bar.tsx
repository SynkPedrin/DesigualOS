import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export function MetricBar({
  label,
  value,
  unit = '%',
  warnAt = 80,
}: {
  label: string;
  value: number;
  unit?: string;
  warnAt?: number;
}) {
  const isHot = value >= warnAt;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-nevoa">
        <span>{label}</span>
        <span className={cn('tabular-nums', isHot ? 'text-aviso' : 'text-nevoa')}>
          {value}
          {unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-carbono">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, value)}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={cn('h-full rounded-full', isHot ? 'bg-aviso' : 'bg-roxo-eletrico')}
        />
      </div>
    </div>
  );
}
