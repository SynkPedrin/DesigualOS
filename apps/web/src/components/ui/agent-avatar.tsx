import Image from 'next/image';
import { cn } from '@/lib/utils';
import { AGENT_META, AUTO_META } from '@/lib/agent-meta';
import type { AgentSelection } from '@/lib/api/contracts';

const SIZE_CLASSES = {
  sm: 'size-6 text-[10px]',
  md: 'size-9 text-sm',
  lg: 'size-12 text-base',
};

const SIZE_PX = { sm: 24, md: 36, lg: 48 };

export function AgentAvatar({
  agent,
  size = 'md',
  className,
}: {
  agent: AgentSelection;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  if (agent === 'auto') {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-roxo-eletrico to-sinal font-mono font-semibold text-carbono',
          SIZE_CLASSES[size],
          className,
        )}
        title={AUTO_META.label}
        aria-label={AUTO_META.label}
      >
        AI
      </div>
    );
  }

  const meta = AGENT_META[agent];

  if (meta.photoSrc) {
    return (
      <div
        className={cn('relative shrink-0 overflow-hidden rounded-full ring-1 ring-white/10', SIZE_CLASSES[size], className)}
        title={meta.label}
      >
        <Image
          src={meta.photoSrc}
          alt={meta.label}
          width={SIZE_PX[size]}
          height={SIZE_PX[size]}
          className="size-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-mono font-semibold text-carbono',
        meta.bgClass,
        SIZE_CLASSES[size],
        className,
      )}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.initial}
    </div>
  );
}
