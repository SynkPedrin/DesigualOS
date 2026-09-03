import { cn } from '@/lib/utils';

export function MetricValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('font-mono tabular-nums', className)}>{children}</span>
  );
}
