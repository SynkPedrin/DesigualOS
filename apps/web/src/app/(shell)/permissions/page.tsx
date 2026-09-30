'use client';

import { ClaudeMark, ControlHeader, LinhasFantasma, Secao, SemNadaAinda, Tabela, Td, Th } from '@/components/control/primitives';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useFerramentasVivas } from '@/hooks/use-mcp-servidor';

/**
 * PERMISSÕES — o que cada pessoa pode fazer pela inteligência.
 *
 * Duas camadas, e elas são diferentes:
 *
 *   PAPEL     — o que a pessoa pode no produto (master, colaborador). Vem de
 *               `/collaborators`.
 *   ESCOPO    — o que ela autorizou o Claude a fazer em nome dela, concedido no
 *               momento da conexão MCP. Vem de `/mcp/status`, lendo os tokens.
 *
 * A segunda tabela já esteve escrita como "nenhum escopo concedido ainda,
 * porque o servidor não está publicado" — uma frase no código, não uma leitura.
 * Envelheceu em três horas. Agora ela lê, e por isso diz a verdade sozinha.
 *
 * O que continua valendo, e é o motivo de não haver grade de checkbox: escopo
 * é concedido por PESSOA na conexão, não configurado aqui. Esta tela mostra o
 * que foi concedido; revogar é no servidor.
 */
export default function PermissionsPage() {
  const { data: pessoas, isPending, isError } = useCollaborators();
  const { data: mcp, isPending: mcpPendente } = useMcpStatus();
  const { data: ferramentas } = useFerramentasVivas(mcp?.base);

  // Os escopos que EXISTEM no servidor, lidos dele. Uma lista fixa aqui
  // envelheceria igual à de ferramentas, que já nasceu com duas a menos.
  const escopos = [...new Set((ferramentas ?? []).map((f) => f.scope))].sort();

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Permissões"
        description="Quem pode o quê. Hoje: o papel de cada pessoa; em breve: o escopo concedido por conexão."
      />

      <Secao titulo="Papéis">
        {isPending ? (
          <LinhasFantasma linhas={5} />
        ) : isError ? (
          <SemNadaAinda titulo="Não consegui ler os papéis" explicacao="A consulta a colaboradores falhou." />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Pessoa</Th>
                <Th className="w-44">Papel</Th>
                <Th>O que isso significa</Th>
              </tr>
            </thead>
            <tbody>
              {(pessoas?.collaborators ?? []).map((p) => {
                const master = p.roles.includes('master');
                return (
                  <tr key={p.userId}>
                    <Td className="truncate">{p.name}</Td>
                    <Td>
                      <span className={master ? 'font-mono text-[11px] text-sinal' : 'font-mono text-[11px] text-nevoa'}>
                        {p.roles.join(', ') || '—'}
                      </span>
                    </Td>
                    <Td className="text-nevoa">
                      {master
                        ? 'Enxerga a operação inteira, custos e infraestrutura; aprova escrita sensível.'
                        : 'Enxerga o que sua organização compartilha; escreve nas contas a que tem acesso.'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        )}
      </Secao>

      <Secao titulo="Escopos concedidos ao Claude">
        {mcpPendente ? (
          <LinhasFantasma linhas={4} />
        ) : (mcp?.pessoas.length ?? 0) === 0 ? (
          <SemNadaAinda
            titulo="Ninguém autorizou o Claude ainda"
            explicacao={
              escopos.length > 0
                ? `Os escopos existem no servidor (${escopos.join(', ')}) e são concedidos por pessoa no momento da conexão. Nenhuma concessão foi feita até agora.`
                : 'Os escopos são concedidos por pessoa no momento em que ela autoriza o Claude. Nenhuma concessão foi feita até agora.'
            }
          />
        ) : (
          <>
            <Tabela>
              <thead>
                <tr>
                  <Th>Pessoa</Th>
                  <Th className="w-24">Via</Th>
                  <Th>Pode fazer em nome dela</Th>
                </tr>
              </thead>
              <tbody>
                {(mcp?.pessoas ?? []).map((p) => (
                  <tr key={p.user_id}>
                    <Td className="truncate">{p.nome ?? '—'}</Td>
                    <Td>
                      <span className="flex items-center gap-1.5">
                        <ClaudeMark size={16} />
                        <span className="text-nevoa">Claude</span>
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {p.scopes.map((e) => (
                          <span
                            key={e}
                            className={[
                              'rounded-full px-2 py-0.5 font-mono text-[10px]',
                              e.endsWith('.write') ? 'bg-aviso/10 text-aviso' : 'bg-grafite-elevado text-nevoa',
                            ].join(' ')}
                          >
                            {e}
                          </span>
                        ))}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
            <p className="mt-3 font-mono text-[11px] text-nevoa/70">
              Escopo terminado em <span className="text-aviso">.write</span> altera a operação de verdade. A concessão
              é feita por quem conecta, no servidor — esta tela mostra o que foi concedido, não configura.
            </p>
          </>
        )}
      </Secao>
    </div>
  );
}
