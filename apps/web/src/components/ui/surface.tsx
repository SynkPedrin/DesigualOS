import { cn } from '@/lib/utils';

interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: 'grafite' | 'elevado';
  glow?: boolean;
}

export function Surface({ level = 'grafite', glow = false, className, ...props }: SurfaceProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-grafite-elevado',
        level === 'grafite' ? 'bg-grafite' : 'bg-grafite-elevado',
        glow ? 'shadow-elevated' : 'shadow-card',
        className,
      )}
      {...props}
    />
  );
}
