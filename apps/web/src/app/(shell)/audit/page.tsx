'use client';

import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusLabel, Tabela, Td, Th, type Estado } from '@/components/control/primitives';
import { useExecutions } from '@/hooks/use-executions';
import { useClients } from '@/hooks/use-clients';
import { AGENT_META } from '@/lib/agent-meta';
import { duracaoMs, formatarDuracao } from '@/lib/control/execucoes';

/**
 * AUDITORIA — quem pediu o quê, quando, e no que deu.
 *
 * A diferença entre esta tela e Atividade é o propósito: aquela é pra
 * acompanhar, esta é pra conferir. Por isso tabela, com o id da execução
 * visível — sem identificador, ninguém consegue perguntar sobre uma linha
 * específica depois.
 *
 * Só existe porque a listagem passou a devolver o AUTOR em 29/09/2026. Antes,
 * "auditoria" teria sido uma lista de coisas que aconteceram sem ninguém
 * responsável por elas.
 */
export default function AuditPage() {
  const { data: execucoes, isPending, isError } = useExecutions();
  const { data: clientes } = useClients();
  const nomePorCliente = new Map((clientes ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="Auditoria"
        description="Cada pedido feito à inteligência, com autor, alvo, desfecho e identificador."
      />

      <Secao titulo="Últimas 50 execuções">
        {isPending ? (
          <LinhasFantasma linhas={10} />
        ) : isError ? (
          <SemNadaAinda titulo="Não consegui ler a auditoria" explicacao="A consulta às execuções falhou." />
        ) : (execucoes ?? []).length === 0 ? (
          <SemNadaAinda
            titulo="Nada registrado ainda"
            explicacao="Cada pedido a um agente vira uma linha aqui, com quem pediu e o que aconteceu."
          />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th className="w-20">Hora</Th>
                <Th className="w-36">Quem</Th>
                <Th className="w-24">Via</Th>
                <Th>Pedido</Th>
                <Th className="w-36">Cliente</Th>
                <Th className="w-28">Desfecho</Th>
                <Th className="w-20">Tempo</Th>
                <Th className="w-48">Execução</Th>
              </tr>
            </thead>
            <tbody>
              {(execucoes ?? []).map((e) => {
                const estado: Estado =
                  e.status === 'completed' ? 'ok' : e.status === 'failed' || e.status === 'cancelled' ? 'erro' : 'desconhecido';
                const quando = e.startedAt ?? e.createdAt;
                return (
                  <tr key={e.executionId}>
                    <Td className="whitespace-nowrap font-mono text-[12px] text-nevoa">
                      {quando ? new Date(quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ', '}
                    </Td>
                    {/* ", " e nunca em branco: usuário apagado precisa parecer
                     * ausência, não um autor sem nome. */}
                    <Td className="truncate">{e.userName ?? ', '}</Td>
                    <Td className="text-nevoa">{AGENT_META[e.agent]?.label ?? e.agent}</Td>
                    <Td className="truncate font-mono text-[12px] text-nevoa">{e.intent}</Td>
                    <Td className="truncate text-nevoa">
                      {e.clientId ? (nomePorCliente.get(e.clientId) ?? ', ') : ', '}
                    </Td>
                    <Td>
                      <StatusLabel estado={estado}>{e.status}</StatusLabel>
                    </Td>
                    <Td className="font-mono text-[12px] text-nevoa">{formatarDuracao(duracaoMs(e))}</Td>
                    <Td className="font-mono text-[11px] text-nevoa">{e.executionId}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        )}
      </Secao>
    </div>
  );
}
