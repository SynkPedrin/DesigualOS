'use client';

import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusDot, Tabela, Td, Th, type Estado } from '@/components/control/primitives';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useExecutions } from '@/hooks/use-executions';

/**
 * PESSOAS — quem é da CASA.
 *
 * A distinção que o briefing pediu e que o sistema já confundiu antes: pessoa
 * da equipe não é cliente. No cadastro isso chegou a se misturar — "Endrigo
 * Almada" e "André Almada" existem como linha em `clients`, e por causa disso
 * "quais tarefas dependem do Endrigo?" consultava a lista de cliente dele, que
 * é vazia.
 *
 * Aqui só entra gente: a fonte é `/collaborators`, que são usuários do sistema,
 * com o vínculo ClickUp quando existe. Cliente fica em Clientes, e o
 * classificador que separa carteira de projeto interno cuida do resto.
 */
export default function PeoplePage() {
  const { data: pessoas, isPending, isError } = useCollaborators();
  const { data: execucoes } = useExecutions();

  const pedidosPorPessoa = new Map<string, number>();
  for (const e of execucoes ?? []) {
    if (!e.userId) continue;
    pedidosPorPessoa.set(e.userId, (pedidosPorPessoa.get(e.userId) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Pessoas"
        description="Quem é da equipe, que papel tem, e quanto vem usando a inteligência."
      />

      <Secao titulo="Equipe">
        {isPending ? (
          <LinhasFantasma linhas={6} />
        ) : isError ? (
          <SemNadaAinda titulo="Não consegui ler a equipe" explicacao="A consulta a colaboradores falhou." />
        ) : (pessoas?.collaborators ?? []).length === 0 ? (
          <SemNadaAinda titulo="Nenhuma pessoa cadastrada" explicacao="Convide alguém pra que ela apareça aqui." />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Pessoa</Th>
                <Th className="w-52">E-mail</Th>
                <Th className="w-32">Papel</Th>
                <Th className="w-36">ClickUp</Th>
                <Th className="w-28">Pedidos</Th>
                <Th className="w-40">Visto por último</Th>
              </tr>
            </thead>
            <tbody>
              {(pessoas?.collaborators ?? []).map((p) => {
                // Sem vínculo no ClickUp, o sistema não consegue atribuir
                // task a essa pessoa — e isso é invisível até alguém tentar.
                const estado: Estado = p.clickup ? 'ok' : 'atencao';
                return (
                  <tr key={p.userId}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <StatusDot estado={estado} />
                        <span className="truncate">{p.name}</span>
                      </span>
                    </Td>
                    <Td className="truncate font-mono text-[12px] text-nevoa">{p.email}</Td>
                    <Td className="text-nevoa">{p.roles.join(', ') || '—'}</Td>
                    <Td className={p.clickup ? 'text-nevoa' : 'text-aviso'}>
                      {p.clickup ? p.clickup.username : 'sem vínculo'}
                    </Td>
                    <Td className="font-mono text-[13px]">{pedidosPorPessoa.get(p.userId) ?? 0}</Td>
                    <Td className="font-mono text-[12px] text-nevoa">
                      {p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString('pt-BR') : '—'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        )}
        <p className="mt-3 font-mono text-[11px] text-nevoa/70">
          Pessoa sem vínculo no ClickUp não pode receber task: o sistema não acha ela na hora de atribuir.
        </p>
      </Secao>
    </div>
  );
}
