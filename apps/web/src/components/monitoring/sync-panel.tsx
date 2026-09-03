'use client';

import { AlertTriangle, CheckCircle2, RefreshCw, Wrench } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { useAgentSync } from '@/hooks/use-agent-sync';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<string, string> = {
  online: 'text-sinal',
  degraded: 'text-aviso',
  offline: 'text-erro',
};

/**
 * "Sincronizar" não recarrega a tela: dispara uma sonda que vai até cada
 * agente, mede, grava e diagnostica. Antes disso o Monitoramento dependia de
 * heartbeat que nenhuma máquina mandava — a tela vivia em "0/2 conectados".
 */
export function SyncPanel() {
  const sync = useAgentSync();
  const report = sync.data;

  return (
    <Surface level="grafite" className="mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Sincronizar agentes</h2>
          <p className="mt-0.5 text-xs text-nevoa">
            Consulta cada máquina ao vivo, atualiza os dados e tenta resolver o que der pra resolver sozinho.
          </p>
        </div>
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50"
        >
          <RefreshCw size={15} className={sync.isPending ? 'animate-spin' : undefined} />
          {sync.isPending ? 'Sondando as máquinas…' : 'Sincronizar'}
        </button>
      </div>

      {sync.isError && (
        <p className="text-sm text-erro">
          {sync.error instanceof ApiRequestError ? sync.error.message : 'Não foi possível sincronizar.'}
        </p>
      )}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {report.agents.map((agent) => (
              <div key={agent.node_id} className="rounded-lg border border-grafite-elevado bg-carbono p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-branco-cru">{agent.label}</span>
                  <span className={cn('shrink-0 font-mono text-[11px] uppercase', STATUS_STYLE[agent.status])}>
                    {agent.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-nevoa">
                  <span>{agent.latency_ms}ms</span>
                  {agent.metrics.ram !== null && <span>RAM {agent.metrics.ram}%</span>}
                  {agent.metrics.vram !== null && <span>VRAM {agent.metrics.vram}%</span>}
                  {agent.metrics.queue_depth !== null && <span>fila {agent.metrics.queue_depth}</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {agent.services.map((service) => (
                    <span
                      key={service.name}
                      title={service.error ?? `HTTP ${service.http_status ?? '—'}`}
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                        service.ok ? 'border-sinal/40 text-sinal' : 'border-erro/40 text-erro',
                      )}
                    >
                      {service.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            {report.diagnoses.length === 0 ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-sinal">
                <CheckCircle2 size={14} /> Nenhum problema encontrado.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {report.diagnoses.map((d, index) => (
                  <li
                    key={`${d.agent}-${index}`}
                    className={cn(
                      'rounded-md border px-3 py-2 text-xs',
                      d.auto_fixed
                        ? 'border-sinal/30 bg-sinal/5'
                        : d.severity === 'erro'
                          ? 'border-erro/30 bg-erro/5'
                          : 'border-aviso/30 bg-aviso/5',
                    )}
                  >
                    <p className="flex items-start gap-1.5 text-branco-cru">
                      {d.auto_fixed ? (
                        <Wrench size={12} className="mt-0.5 shrink-0 text-sinal" />
                      ) : (
                        <AlertTriangle size={12} className={cn('mt-0.5 shrink-0', d.severity === 'erro' ? 'text-erro' : 'text-aviso')} />
                      )}
                      {d.problem}
                    </p>
                    <p className="mt-0.5 pl-[18px] text-nevoa">{d.suggestion}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 font-mono text-[10px] text-nevoa">
              {report.recorded} leitura(s) gravada(s) · {new Date(report.ran_at).toLocaleTimeString('pt-BR')}
            </p>
          </div>
        </>
      )}
    </Surface>
  );
}
