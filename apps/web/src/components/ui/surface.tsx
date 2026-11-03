import { cn } from '@/lib/utils';

interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: 'grafite' | 'elevado';
  glow?: boolean;
}

export function Surface({ level = 'grafite', glow = false, className, ...props }: SurfaceProps) {
  return (
    <div
      className={cn(
        // Contorno verde-limão discreto e fundo levemente translúcido (03/11/2026): a luz animada do fundo aparece por
        // baixo sem atrapalhar a leitura, e todo cartão do sistema ganha a mesma borda da marca.
        'rounded-2xl border border-sinal/[0.14]',
        level === 'grafite' ? 'bg-grafite/90' : 'bg-grafite-elevado/90',
        glow ? 'shadow-elevated' : 'shadow-card',
        className,
      )}
      {...props}
    />
  );
}
