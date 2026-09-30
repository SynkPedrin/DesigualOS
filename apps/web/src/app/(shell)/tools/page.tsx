'use client';

import { ControlHeader, Secao, SemNadaAinda, Tabela, Td, Th } from '@/components/control/primitives';
import { FERRAMENTAS_MCP } from '@/lib/mcp-tools';
import { useMcpStatus } from '@/hooks/use-mcp-status';

/**
 * FERRAMENTAS — o que a inteligência PODE fazer, e sob qual permissão.
 *
 * Nome, escopo, acesso e descrição vêm do código real de `apps/mcp/src/tools`
 * (ver lib/mcp-tools.ts). A contagem de chamadas vem do audit_log, por
 * `/mcp/status`.
 *
 * A distinção que a coluna preserva: ferramenta com ZERO chamada mostra "—", e
 * não "0". Zero parece medição ("foi usada zero vezes"); o travessão diz o que
 * de fato é o caso na maioria delas hoje — ninguém chamou ainda, e isso não é
 * nota de desempenho.
 */
export default function ToolsPage() {
  const { data: mcp } = useMcpStatus();
  const chamadasPorTool = new Map((mcp?.por_ferramenta ?? []).map((f) => [f.tool, f]));

  const escrita = FERRAMENTAS_MCP.filter((f) => f.acesso === 'WRITE');
  const leitura = FERRAMENTAS_MCP.filter((f) => f.acesso === 'READ');
  const usadas = FERRAMENTAS_MCP.filter((f) => chamadasPorTool.has(f.nome)).length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="Ferramentas"
        description={`${FERRAMENTAS_MCP.length} ferramentas escritas no servidor MCP: ${leitura.length} de leitura, ${escrita.length} de escrita.`}
      />

      <Secao titulo="Uso nas últimas 24h">
        {(mcp?.chamadas_24h ?? 0) === 0 ? (
          <SemNadaAinda
            titulo="Nenhuma chamada em 24h"
            explicacao="As ferramentas estão no ar e ninguém as chamou nesta janela. Silêncio, não falha."
          />
        ) : (
          <p className="text-sm text-nevoa">
            <span className="text-branco-cru">{mcp?.chamadas_24h}</span> chamada(s), de{' '}
            <span className="text-branco-cru">{usadas}</span> ferramenta(s) diferentes. As outras{' '}
            {FERRAMENTAS_MCP.length - usadas} estão escritas e não foram chamadas — o que não é nota de desempenho
            delas.
          </p>
        )}
      </Secao>

      <Secao titulo="Escrita — alteram a operação">
        <Inventario lista={escrita} chamadas={chamadasPorTool} />
      </Secao>

      <Secao titulo="Leitura — só consultam">
        <Inventario lista={leitura} chamadas={chamadasPorTool} />
      </Secao>
    </div>
  );
}

function Inventario({
  lista,
  chamadas,
}: {
  lista: typeof FERRAMENTAS_MCP;
  chamadas: Map<string, { tool: string; total: number; sucesso: number }>;
}) {
  return (
    <Tabela>
      <thead>
        <tr>
          <Th className="w-56">Ferramenta</Th>
          <Th className="w-36">Escopo</Th>
          <Th className="w-28">Chamadas 24h</Th>
          <Th>O que faz</Th>
        </tr>
      </thead>
      <tbody>
        {lista.map((f) => (
          <tr key={f.nome}>
            <Td className="whitespace-nowrap font-mono text-[13px]">{f.nome}</Td>
            <Td>
              <span
                className={
                  f.acesso === 'WRITE' ? 'font-mono text-[11px] text-aviso' : 'font-mono text-[11px] text-nevoa'
                }
              >
                {f.escopo}
              </span>
            </Td>
            <Td className="font-mono text-[13px]">
              {/* "—" e não "0": zero parece medição, travessão diz que ninguém
               * chamou — que é o caso da maioria delas hoje. */}
              {chamadas.has(f.nome) ? (
                <span>
                  {chamadas.get(f.nome)!.total}
                  {chamadas.get(f.nome)!.sucesso < chamadas.get(f.nome)!.total && (
                    <span className="text-erro"> ({chamadas.get(f.nome)!.total - chamadas.get(f.nome)!.sucesso} erro)</span>
                  )}
                </span>
              ) : (
                <span className="text-nevoa">—</span>
              )}
            </Td>
            <Td className="text-nevoa">{f.descricao || '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Tabela>
  );
}
