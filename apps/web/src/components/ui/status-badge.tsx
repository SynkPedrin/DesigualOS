import { cn } from '@/lib/utils';

export function StatusBadge({
  label,
  dotClass,
  textClass,
  pulse = false,
  className,
}: {
  label: string;
  dotClass: string;
  textClass: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-grafite-elevado bg-carbono px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        textClass,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotClass, pulse && 'animate-pulse')} />
      {label}
    </span>
  );
}
