'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { StatusDot, type Estado } from './primitives';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useClickUpIntegration } from '@/hooks/use-clickup-integration';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMcpStatus } from '@/hooks/use-mcp-status';

/**
 * O ESTADO TÉCNICO EM UMA LINHA.
 *
 * Substitui, na home, a faixa de seis cartões — MCP, Claude, ClickUp, API, Nós,
 * Fila. Os seis continuam inteiros em /health, que é a tela de quem foi olhar
 * infraestrutura de propósito.
 *
 * POR QUE ENCOLHEU: quem abre esta tela pergunta "como está a agência", e
 * recebia primeiro "Fila: 0 na espera". Seis cartões que dizem "tudo bem" todo
 * dia são seis cartões que se aprende a não ler — e no dia em que um ficar
 * vermelho, ele estará no meio de um bloco que o olho já pula. Uma linha que
 * muda de cor é mais difícil de ignorar do que seis que não mudam.
 *
 * A REGRA QUE NÃO ENCOLHEU junto: desconhecido não é saudável. Se alguma fonte
 * não respondeu, a linha diz "parcial" e fica cinza — nunca verde. Resumir seis
 * sinais em um não pode virar a desculpa para o resumo ser otimista, que é
 * exatamente como um painel de monitoramento passa a mentir.
 */
export function LinhaDoSistema() {
  const { isMaster } = useIsMaster();
  const { data: infra, isPending: infraPendente, isError: infraErro } = useInfrastructureHealth(isMaster);
  const { data: clickup, isPending: clickupPendente } = useClickUpIntegration();
  const { data: mcp, isPending: mcpPendente, isError: mcpErro } = useMcpStatus();

  const sinais: Array<{ nome: string; estado: Estado }> = [
    {
      nome: 'MCP',
      estado: mcpErro ? 'erro' : mcpPendente || !mcp ? 'desconhecido' : mcp.endpoint ? 'ok' : 'atencao',
    },
    {
      nome: 'ClickUp',
      estado: clickupPendente ? 'desconhecido' : clickup?.connected ? 'ok' : 'atencao',
    },
    {
      nome: 'API',
      estado: infraErro
        ? 'erro'
        : infraPendente || !infra
          ? 'desconhecido'
          : infra.allSystemsOnline
            ? 'ok'
            : infra.overallHealthPercent >= 60
              ? 'atencao'
              : 'erro',
    },
    {
      nome: 'fila',
      estado:
        !infra?.worker ? 'desconhecido' : !infra.worker.online ? 'erro' : infra.worker.jobsWaiting > 20 ? 'atencao' : 'ok',
    },
  ];

  const comErro = sinais.filter((s) => s.estado === 'erro');
  const comAtencao = sinais.filter((s) => s.estado === 'atencao');
  const desconhecidos = sinais.filter((s) => s.estado === 'desconhecido');

  /**
   * A ORDEM DE PRECEDÊNCIA É A DA GRAVIDADE, e "não sei" vem antes de "tudo
   * bem" de propósito: só dá para afirmar que está tudo certo depois de ter
   * olhado tudo.
   */
  const { estado, texto } = comErro.length
    ? {
        estado: 'erro' as Estado,
        texto: `${comErro.map((s) => s.nome).join(' e ')} ${comErro.length === 1 ? 'está' : 'estão'} fora`,
      }
    : comAtencao.length
      ? {
          estado: 'atencao' as Estado,
          texto: `${comAtencao.map((s) => s.nome).join(', ')} ${comAtencao.length === 1 ? 'pede' : 'pedem'} atenção`,
        }
      : desconhecidos.length
        ? {
            estado: 'desconhecido' as Estado,
            texto:
              desconhecidos.length === sinais.length
                ? 'ainda consultando o estado do sistema'
                : `${desconhecidos.map((s) => s.nome).join(', ')} sem resposta — o resto está no ar`,
          }
        : { estado: 'ok' as Estado, texto: 'sistema no ar, tudo respondendo' };

  return (
    <Link
      href="/health"
      className="mb-8 flex items-center justify-between gap-3 rounded-lg border border-grafite-elevado bg-grafite px-4 py-2.5 transition-colors hover:border-nevoa/40"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusDot estado={estado} />
        <span className="truncate text-[13px] text-nevoa">{texto}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-nevoa">
        Saúde
        <ArrowRight size={12} />
      </span>
    </Link>
  );
}
