import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SystemEvent } from '@/lib/api/contracts';

const LEVEL_META = {
  info: { icon: Info, textClass: 'text-info' },
  warning: { icon: AlertTriangle, textClass: 'text-aviso' },
  error: { icon: AlertTriangle, textClass: 'text-erro' },
};

export function EventTimeline({ events }: { events: SystemEvent[] }) {
  return (
    <div className="space-y-1">
      {events.map((event) => {
        const level = LEVEL_META[event.level];
        const Icon = level.icon;
        return (
          <div
            key={event.id}
            className="flex items-start gap-3 border-b border-grafite-elevado/60 py-2.5 last:border-b-0"
          >
            <Icon size={14} className={cn('mt-0.5 shrink-0', level.textClass)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-branco-cru">{event.message}</p>
              <p className="font-mono text-[11px] text-nevoa">{event.nodeLabel}</p>
            </div>
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-nevoa">
              {formatRelativeTime(event.timestamp)}
            </span>
          </div>
        );
      })}
      {events.length === 0 && (
        <div className="flex items-center gap-2 py-4 text-sm text-nevoa">
          <CheckCircle2 size={14} className="text-sucesso" />
          Nenhum evento recente.
        </div>
      )}
    </div>
  );
}
