'use client';

import { CartaoDeEstado, type Estado } from './primitives';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useClickUpIntegration } from '@/hooks/use-clickup-integration';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMcpStatus } from '@/hooks/use-mcp-status';

/**
 * A primeira faixa do Control Plane: seis estados, uma olhada.
 *
 * A regra que sustenta esta tira, e que vale pro produto inteiro: DESCONHECIDO
 * NÃO É SAUDÁVEL. Quando a fonte não responde, ou quando ela não existe ainda,
 * o ponto fica cinza e o texto diz o que está acontecendo. Verde por omissão é
 * a mentira mais fácil de contar numa tela de monitoramento, e a mais cara —
 * é exatamente o mesmo defeito de "não sei" virando zero que o Bento cometia
 * em resposta de faturamento.
 *
 * MCP e Claude LEEM o estado, não o presumem — e isso não é preciosismo. A
 * primeira versão desta tira dizia "não publicado" escrito no código, porque
 * era verdade quando foi escrita. Três horas depois o servidor subiu no Railway
 * e a conta de atendimento conectou, e a tira continuou anunciando o contrário
 * com toda a confiança. Código que afirma um estado envelhece sem avisar.
 */
export function StatusDoSistema() {
  const { isMaster } = useIsMaster();
  const { data: infra, isPending: infraPendente, isError: infraErro } = useInfrastructureHealth(isMaster);
  const { data: clickup, isPending: clickupPendente } = useClickUpIntegration();
  const { data: mcp, isPending: mcpPendente, isError: mcpErro } = useMcpStatus();

  const estadoInfra: Estado = infraErro
    ? 'erro'
    : infraPendente || !infra
      ? 'desconhecido'
      : infra.allSystemsOnline
        ? 'ok'
        : infra.overallHealthPercent >= 60
          ? 'atencao'
          : 'erro';

  const textoInfra = infraErro
    ? 'Não consegui ler'
    : infraPendente || !infra
      ? 'Consultando'
      : `${infra.overallHealthPercent}% saudável`;

  const worker = infra?.worker ?? null;
  // Fila cheia não é falha, é aviso: alguém precisa olhar antes de virar falha.
  const estadoFila: Estado =
    worker === null ? 'desconhecido' : !worker.online ? 'erro' : worker.jobsWaiting > 20 ? 'atencao' : 'ok';

  const estadoClickUp: Estado = clickupPendente ? 'desconhecido' : clickup?.connected ? 'ok' : 'atencao';

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {/* O MCP é a razão de ser do Control Plane, então abre a faixa. */}
      <CartaoDeEstado
        rotulo="MCP"
        valor={mcpErro ? 'Não consegui ler' : mcpPendente ? 'Consultando' : mcp?.endpoint ? 'Publicado' : 'Sem endereço'}
        estado={mcpErro ? 'erro' : mcpPendente || !mcp ? 'desconhecido' : mcp.endpoint ? 'ok' : 'atencao'}
        detalhe={mcp?.endpoint ? new URL(mcp.endpoint).host : undefined}
      />
      <CartaoDeEstado
        rotulo="Claude"
        valor={
          mcpPendente || !mcp
            ? 'Consultando'
            : mcp.pessoas_conectadas === 0
              ? 'Sem conexões'
              : `${mcp.pessoas_conectadas} conectado(s)`
        }
        estado={!mcp ? 'desconhecido' : mcp.pessoas_conectadas > 0 ? 'ok' : 'atencao'}
        detalhe={mcp ? `${mcp.chamadas_24h} chamada(s) em 24h` : undefined}
      />
      <CartaoDeEstado
        rotulo="ClickUp"
        valor={clickupPendente ? 'Consultando' : clickup?.connected ? 'Conectado' : 'Desconectado'}
        estado={estadoClickUp}
      />
      <CartaoDeEstado rotulo="API" valor={textoInfra} estado={estadoInfra} />
      <CartaoDeEstado
        rotulo="Nós"
        valor={infra ? `${infra.agentsConnected.online}/${infra.agentsConnected.total} online` : ', '}
        estado={
          !infra ? 'desconhecido' : infra.agentsConnected.online === infra.agentsConnected.total ? 'ok' : 'atencao'
        }
      />
      <CartaoDeEstado
        rotulo="Fila"
        valor={worker === null ? 'Sem relato' : worker.online ? `${worker.jobsWaiting} na espera` : 'Fora do ar'}
        estado={estadoFila}
        detalhe={worker === null ? 'a API não reportou' : `${worker.jobsActive} em execução`}
      />
    </div>
  );
}
