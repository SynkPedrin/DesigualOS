'use client';

import Link from 'next/link';
import { LinhasFantasma, SemNadaAinda, StatusDot, type Estado } from './primitives';
import { useExecutions } from '@/hooks/use-executions';
import { useClients } from '@/hooks/use-clients';
import { AGENT_META } from '@/lib/agent-meta';
import type { ExecutionListItem } from '@/lib/api/contracts';
import type { ExecutionStatus } from '@desigual-os/types';

/**
 * O que a inteligência ANDOU FAZENDO, com autor, alvo e desfecho.
 *
 * A fonte é `/executions`, que é real e já existia. O que faltava era o AUTOR:
 * a execução sempre soube de quem era e a listagem não devolvia (corrigido em
 * 29/09/2026, ver apps/api/src/executions/routes.ts). Atividade sem autor é
 * log; com autor, é auditoria.
 *
 * A distinção que esta lista não pode perder, e que custou caro pro produto
 * aprender: FALHA DE SISTEMA e RECUSA SEGURA são coisas diferentes. Uma execução
 * que terminou em "não tenho autorização de escrita" está o sistema se
 * comportando; uma que terminou em timeout está quebrada. Pintar as duas de
 * vermelho faz alguém ir consertar o que está certo — e, pior, ignorar o
 * vermelho na próxima vez.
 */

function estadoDaExecucao(status: ExecutionStatus): Estado {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'erro';
  return 'desconhecido';
}

function duracao(e: ExecutionListItem): string | null {
  if (!e.startedAt || !e.completedAt) return null;
  const ms = new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function horario(e: ExecutionListItem): string {
  const iso = e.startedAt ?? e.createdAt ?? e.completedAt;
  if (!iso) return ', ';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function FeedDeAtividade({ limite = 12 }: { limite?: number }) {
  const { data: execucoes, isPending, isError } = useExecutions();
  const { data: clientes } = useClients();

  const nomePorCliente = new Map((clientes ?? []).map((c) => [c.id, c.name]));

  if (isPending) return <LinhasFantasma linhas={6} />;

  if (isError) {
    return (
      <SemNadaAinda
        titulo="Não consegui ler a atividade"
        explicacao="A consulta às execuções falhou. Isso é a API, não a sua operação, se continuar, vale avisar quem cuida do sistema."
      />
    );
  }

  const lista = (execucoes ?? []).slice(0, limite);
  if (lista.length === 0) {
    return (
      <SemNadaAinda
        titulo="Nenhuma atividade ainda"
        explicacao="Quando alguém pedir alguma coisa a um agente, o pedido aparece aqui com autor, alvo e desfecho."
      />
    );
  }

  return (
    <ol className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado bg-grafite">
      {lista.map((e) => {
        const estado = estadoDaExecucao(e.status);
        const ms = duracao(e);
        const agente = AGENT_META[e.agent]?.label ?? e.agent;
        const cliente = e.clientId ? (nomePorCliente.get(e.clientId) ?? null) : null;
        return (
          <li key={e.executionId} className="flex items-start gap-3 px-4 py-3">
            <span className="w-11 shrink-0 pt-0.5 font-mono text-[11px] text-nevoa">{horario(e)}</span>
            <StatusDot estado={estado} className="mt-1.5" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-branco-cru">
                {/* O autor primeiro: é a pergunta que alguém faz olhando um log
                 * de auditoria. "—" quando o usuário foi apagado — nunca outro
                 * nome, nunca em branco parecendo dado. */}
                <span className="font-medium">{e.userName ?? 'sem dado'}</span>
                <span className="text-nevoa"> · via {agente}</span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-nevoa">
                {e.intent}
                {cliente && <span className="text-nevoa/70"> · {cliente}</span>}
                {ms && <span className="text-nevoa/70"> · {ms}</span>}
              </p>
            </div>
            <Link
              href={`/history?execution=${encodeURIComponent(e.executionId)}`}
              className="shrink-0 self-center font-mono text-[11px] text-nevoa underline-offset-2 hover:text-branco-cru hover:underline"
            >
              ver
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
