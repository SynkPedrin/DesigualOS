'use client';

import {
  CartaoDeEstado,
  ControlHeader,
  LinhasFantasma,
  Secao,
  SemNadaAinda,
  StatusLabel,
  Tabela,
  Td,
  Th,
  type Estado,
} from '@/components/control/primitives';
import { StatusDoSistema } from '@/components/control/status-do-sistema';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useExecutions } from '@/hooks/use-executions';
import { useIsMaster } from '@/hooks/use-is-master';
import { formatarDuracao, resumir } from '@/lib/control/execucoes';

/**
 * SAÚDE — e a separação que ela não pode perder.
 *
 * "Falhas" e "recusas seguras" aparecem como coisas diferentes porque são
 * coisas diferentes, e misturá-las já custou caro: um leitor que somava as duas
 * acusou 23% de falha num dia em que a maior parte era o sistema se comportando
 * bem (ver apps/worker/scripts/saude-do-bento.mts).
 *
 * A ressalva honesta desta tela: a listagem de execuções devolve as 50 mais
 * recentes e não traz o texto da resposta. Sem o texto não dá pra separar
 * quebra de recusa com precisão aqui, e por isso o número aparece rotulado como
 * "terminaram em falha" — não como "quebras". A classificação fina vive em
 * Incidentes, que carrega o detalhe.
 */
export default function HealthPage() {
  const { isMaster } = useIsMaster();
  const { data: infra, isPending, isError } = useInfrastructureHealth(isMaster);
  const { data: execucoes } = useExecutions();

  const resumo = resumir(execucoes ?? []);

  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="Saúde do sistema"
        description="O estado de cada peça, e o que aconteceu nas últimas execuções."
      />

      <Secao titulo="Agora">
        <StatusDoSistema />
      </Secao>

      <Secao titulo="Últimas 50 execuções">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          <CartaoDeEstado rotulo="Execuções" valor={String(resumo.total)} estado="ok" />
          <CartaoDeEstado
            rotulo="Entregues"
            valor={resumo.total > 0 ? `${Math.round((resumo.entregues / resumo.total) * 100)}%` : '—'}
            estado={resumo.total === 0 ? 'desconhecido' : resumo.entregues / resumo.total >= 0.9 ? 'ok' : 'atencao'}
            detalhe={`${resumo.entregues} de ${resumo.total}`}
          />
          <CartaoDeEstado
            rotulo="Terminaram em falha"
            valor={String(resumo.quebras)}
            estado={resumo.quebras === 0 ? 'ok' : 'atencao'}
            detalhe="inclui recusas — ver Incidentes"
          />
          <CartaoDeEstado rotulo="Em andamento" valor={String(resumo.andando)} estado="desconhecido" />
          <CartaoDeEstado rotulo="Mediana" valor={formatarDuracao(resumo.medianaMs)} estado="ok" />
          <CartaoDeEstado
            rotulo="p95 / pior"
            valor={formatarDuracao(resumo.p95Ms)}
            estado={resumo.p95Ms !== null && resumo.p95Ms > 60_000 ? 'atencao' : 'ok'}
            detalhe={`pior ${formatarDuracao(resumo.piorMs)}`}
          />
        </div>
      </Secao>

      <Secao titulo="Nós">
        {!isMaster ? (
          <SemNadaAinda
            titulo="Visível só para master"
            explicacao="A saúde da infraestrutura exige permissão de master. Isso é o controle de acesso funcionando, não um erro."
          />
        ) : isPending ? (
          <LinhasFantasma linhas={5} />
        ) : isError || !infra ? (
          <SemNadaAinda
            titulo="Não consegui ler a infraestrutura"
            explicacao="A consulta falhou. Enquanto ela não responder, o estado dos nós é desconhecido — e desconhecido não é saudável."
          />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Nó</Th>
                <Th className="w-28">Agente</Th>
                <Th className="w-28">Estado</Th>
                <Th className="w-24">Latência</Th>
                <Th className="w-40">Último sinal</Th>
              </tr>
            </thead>
            <tbody>
              {infra.nodes.map((n) => {
                const estado: Estado = n.status === 'online' ? 'ok' : n.status === 'degraded' ? 'atencao' : 'erro';
                return (
                  <tr key={n.nodeId}>
                    <Td className="font-mono text-[13px]">{n.nodeId}</Td>
                    <Td className="text-nevoa">{n.agent}</Td>
                    <Td>
                      <StatusLabel estado={estado}>{n.status}</StatusLabel>
                    </Td>
                    <Td className="font-mono text-[12px] text-nevoa">{n.latencyMs}ms</Td>
                    <Td className="font-mono text-[12px] text-nevoa">
                      {n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt).toLocaleString('pt-BR') : '—'}
                    </Td>
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
