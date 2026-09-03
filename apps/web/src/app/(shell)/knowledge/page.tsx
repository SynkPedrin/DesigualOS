import { AGENT_NAMES } from '@desigual-os/types';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { AGENT_META } from '@/lib/agent-meta';
import { SAMPLE_KNOWLEDGE_SOURCES } from '@/lib/knowledge/sample-sources';

export default function KnowledgePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Base de conhecimento"
        title="Conhecimento"
        description="Cada agente é dono do próprio vault, lido sob demanda. Exemplo ilustrativo: o Context Engine que serve isso de verdade ainda está em construção no backend."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {AGENT_NAMES.map((agent) => {
          const meta = AGENT_META[agent];
          return (
            <Surface key={agent} level="grafite" className="p-5">
              <div className="mb-4 flex items-center gap-3">
                <AgentAvatar agent={agent} />
                <div>
                  <p className="font-heading text-sm font-semibold text-branco-cru">{meta.label}</p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-nevoa">{meta.role}</p>
                </div>
              </div>
              <div className="space-y-1">
                {SAMPLE_KNOWLEDGE_SOURCES[agent].map((source) => (
                  <div
                    key={source.title}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-carbono"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-branco-cru">
                      <FileText size={14} className="shrink-0 text-nevoa" />
                      <span className="truncate">{source.title}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-nevoa">{source.updatedLabel}</span>
                  </div>
                ))}
              </div>
            </Surface>
          );
        })}
      </div>
    </div>
  );
}
