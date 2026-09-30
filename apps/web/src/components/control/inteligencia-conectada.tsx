'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ClaudeMark, LinhasFantasma, SemNadaAinda, StatusLabel } from './primitives';
import { useMcpStatus } from '@/hooks/use-mcp-status';

/**
 * "INTELIGÊNCIA CONECTADA" — a seção que explica o produto em cinco segundos:
 * o Claude é onde a equipe conversa, o Desigual é o que dá a ele acesso à
 * verdade da operação.
 *
 * ERRO QUE ESTA SEÇÃO JÁ COMETEU, e que vale ficar escrito: a primeira versão
 * dizia, no código, "o MCP ainda não está publicado, nenhuma conexão pode
 * existir". Era verdade quando foi escrita, e falso três horas depois — o
 * servidor subiu no Railway e a conta de atendimento conectou. A tela seguiu
 * anunciando ausência com toda a confiança.
 *
 * A lição não é sobre MCP: é que afirmação sobre ESTADO precisa vir de leitura,
 * nunca de constante. Os números daqui vêm todos de `/mcp/status`, que lê
 * `mcp_tokens` e `audit_logs`. Quando não houver conexão, vai dizer isso porque
 * LEU zero — não porque alguém escreveu zero.
 */
export function InteligenciaConectada() {
  const { data: mcp, isPending, isError } = useMcpStatus();

  const taxa =
    mcp && mcp.chamadas_24h > 0 ? Math.round((mcp.sucessos_24h / mcp.chamadas_24h) * 100) : null;

  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-grafite-elevado px-5 py-4">
        <div className="flex items-center gap-3">
          <ClaudeMark size={36} />
          <div>
            <p className="font-heading text-base font-semibold text-branco-cru">Claude</p>
            {isPending ? (
              <StatusLabel estado="desconhecido">Consultando</StatusLabel>
            ) : isError ? (
              <StatusLabel estado="erro">Não consegui ler o estado</StatusLabel>
            ) : (mcp?.pessoas_conectadas ?? 0) > 0 ? (
              <StatusLabel estado="ok">
                {mcp!.pessoas_conectadas} pessoa(s) conectada(s) · {mcp!.conexoes_vivas} autorização(ões)
              </StatusLabel>
            ) : (
              <StatusLabel estado="atencao">Nenhuma conexão ativa</StatusLabel>
            )}
          </div>
        </div>
        <Link
          href="/mcp"
          className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-branco-cru transition-colors hover:bg-grafite-elevado"
        >
          Gerenciar conexões
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="px-5 py-5">
        <FluxoDaLigacao />

        {isPending ? (
          <div className="mt-5">
            <LinhasFantasma linhas={3} />
          </div>
        ) : isError ? (
          <div className="mt-5">
            <SemNadaAinda
              titulo="Não consegui ler o estado do MCP"
              explicacao="A consulta falhou. Enquanto ela não responder, não dá pra afirmar nem que há conexão nem que não há."
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Numero rotulo="Pessoas" valor={String(mcp?.pessoas_conectadas ?? 0)} />
            <Numero rotulo="Autorizações" valor={String(mcp?.conexoes_vivas ?? 0)} />
            <Numero rotulo="Chamadas 24h" valor={String(mcp?.chamadas_24h ?? 0)} />
            {/* Taxa só existe se houve chamada. "100%" sobre zero chamada é o
             * tipo de número que parece ótimo e não significa nada. */}
            <Numero rotulo="Sucesso" valor={taxa === null ? '—' : `${taxa}%`} />
          </div>
        )}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-nevoa">{rotulo}</p>
      <p className="mt-0.5 font-heading text-lg font-semibold text-branco-cru">{valor}</p>
    </div>
  );
}

/** O desenho da ligação. Serve quando há conexão e quando ainda não há. */
function FluxoDaLigacao() {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <Elo titulo="Claude" subtitulo="onde a equipe trabalha" icone={<ClaudeMark size={18} />} />
      <Seta />
      <Elo titulo="Desigual MCP" subtitulo="permissão, memória, auditoria" destaque />
      <Seta />
      <Elo titulo="Operação" subtitulo="ClickUp, clientes, decisões" />
    </div>
  );
}

function Elo({
  titulo,
  subtitulo,
  icone,
  destaque = false,
}: {
  titulo: string;
  subtitulo: string;
  icone?: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div
      className={[
        'flex-1 rounded-md border px-3.5 py-2.5',
        destaque ? 'border-sinal/40 bg-sinal/5' : 'border-grafite-elevado bg-carbono/40',
      ].join(' ')}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-branco-cru">
        {icone}
        {titulo}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-nevoa">{subtitulo}</p>
    </div>
  );
}

function Seta() {
  return (
    <span aria-hidden className="self-center font-mono text-nevoa/50 sm:px-1">
      <span className="hidden sm:inline">→</span>
      <span className="sm:hidden">↓</span>
    </span>
  );
}
