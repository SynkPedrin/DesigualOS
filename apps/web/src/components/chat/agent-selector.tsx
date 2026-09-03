import { motion } from 'framer-motion';
import { AGENT_SELECTIONS, type AgentSelection } from '@/lib/api/contracts';
import { AGENT_META, AUTO_META } from '@/lib/agent-meta';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { cn } from '@/lib/utils';

export function AgentSelector({
  value,
  onChange,
}: {
  value: AgentSelection;
  onChange: (agent: AgentSelection) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {AGENT_SELECTIONS.map((selection) => {
        const isActive = value === selection;
        const label = selection === 'auto' ? AUTO_META.label : AGENT_META[selection].label;
        return (
          <button
            key={selection}
            type="button"
            onClick={() => onChange(selection)}
            className={cn(
              'relative flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                : 'border-grafite-elevado bg-grafite text-nevoa hover:text-branco-cru',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="agent-selector-active"
                className="absolute inset-0 rounded-full border border-roxo-eletrico shadow-glow"
                transition={{ duration: 0.2, ease: 'easeOut' }}
              />
            )}
            <AgentAvatar agent={selection} size="sm" />
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
