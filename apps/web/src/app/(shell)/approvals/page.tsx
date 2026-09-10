'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, Megaphone, ShieldAlert, Trash2, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Surface } from '@/components/ui/surface';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/stores/toast-store';
import { AGENT_META } from '@/lib/agent-meta';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useIsMaster } from '@/hooks/use-is-master';
import { useApproveToolCall, useToolCalls } from '@/hooks/use-tool-calls';
import { ApiRequestError } from '@/lib/api/client';
import type { ToolCall } from '@/lib/api/contracts';

/** Ferramentas críticas do Tool Gateway (seção 6.6) que passam por esta fila hoje. Qualquer
 * `tool` fora deste mapa ainda aparece (rótulo cru + ícone genérico) em vez de sumir da lista. */
const TOOL_META: Record<string, { label: string; icon: typeof Wallet }> = {
  meta_ads: { label: 'Orçamento de Meta Ads', icon: Wallet },
  instagram: { label: 'Publicação no Instagram', icon: Megaphone },
  'clickup.delete_task': { label: 'Excluir tarefa do ClickUp', icon: Trash2 },
};

function toolMeta(tool: string) {
  return TOOL_META[tool] ?? { label: tool, icon: ShieldAlert };
}

/** `input` é livre por tool (ver apps/api/src/tool-calls/routes.ts): meta_ads/instagram
 * carregam `proposal`, clickup.delete_task carrega só `task_id`. */
function proposalText(call: ToolCall): string {
  if (typeof call.input.proposal === 'string' && call.input.proposal.trim()) {
    return call.input.proposal;
  }
  if (typeof call.input.task_id === 'string') {
    return `Tarefa do ClickUp: ${call.input.task_id}`;
  }
  return 'Sem detalhes adicionais registrados para esta ação.';
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const approve = useApproveToolCall();
  const agentMeta = AGENT_META[call.agent];
  const { label, icon: Icon } = toolMeta(call.tool);

  function handleApprove() {
    approve.mutate(call.id, {
      onSuccess: () => toast(`Ação de ${agentMeta.label} aprovada.`, 'success'),
      onError: (error) => {
        const message =
          error instanceof ApiRequestError ? error.message : 'Não foi possível aprovar esta ação.';
        toast(message, 'error');
      },
    });
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <Surface className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AgentAvatar agent={call.agent} size="sm" />
            <span className={cn('text-sm font-semibold', agentMeta.textClass)}>{agentMeta.label}</span>
            <span className="text-nevoa">·</span>
            <span className="flex items-center gap-1.5 text-sm text-branco-cru">
              <Icon size={14} className="text-nevoa" />
              {label}
            </span>
          </div>
          <span
            className="shrink-0 font-mono text-[11px] text-nevoa"
            title={new Date(call.createdAt).toLocaleString('pt-BR')}
          >
            {formatRelativeTime(call.createdAt)}
          </span>
        </div>

        <p className="rounded-md border border-grafite-elevado bg-carbono/40 px-3.5 py-3 text-sm leading-relaxed text-branco-cru">
          {proposalText(call)}
        </p>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleApprove}
            disabled={approve.isPending}
            className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approve.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <CheckCircle2 size={15} />
            )}
            {approve.isPending ? 'Aprovando…' : 'Aprovar'}
          </button>
        </div>
      </Surface>
    </motion.div>
  );
}

export default function ApprovalsPage() {
  const { isMaster, isPending: rolePending } = useIsMaster();
  const { data: toolCalls, isPending, isError, refetch } = useToolCalls(isMaster);

  if (!rolePending && !isMaster) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="Aprovações de ações críticas são visíveis só para o papel Administrador Master."
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Governança"
        title="Aprovações"
        description="Orçamento de Meta Ads, publicações no Instagram e exclusões no ClickUp propostas pelos agentes ficam pendentes aqui até um master aprovar."
      />

      {rolePending || isPending ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <InlineSectionError
          message="Não conseguimos carregar as aprovações pendentes."
          onRetry={() => refetch()}
        />
      ) : !toolCalls || toolCalls.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nenhuma aprovação pendente"
          description="Quando um agente propuser uma ação crítica - orçamento de Meta Ads, publicação no Instagram ou exclusão de tarefa no ClickUp - ela aparece aqui."
        />
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Toaster />
    </div>
  );
}
