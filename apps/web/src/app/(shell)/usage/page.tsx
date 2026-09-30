'use client';

import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, Tabela, Td, Th } from '@/components/control/primitives';
import { useExecutions } from '@/hooks/use-executions';
import { AGENT_META } from '@/lib/agent-meta';
import { duracaoMs, formatarDuracao, percentil } from '@/lib/control/execucoes';

/**
 * USO — quanto cada pessoa pediu, e como foi.
 *
 * Fonte real: as 50 execuções mais recentes que a API devolve, agregadas por
 * autor. Não é "hoje" nem "este mês": é a janela que existe, e a tela diz isso
 * em vez de chamar de período.
 *
 * O que NÃO está aqui: token e custo. Eles existem no produto (a tela Tokens &
 * Custos, em Interno), e o briefing pediu pra não inventar consumo — as
 * execuções carregam tokens, mas só as que passam pelos agentes próprios, então
 * somar aqui daria um número que parece o gasto da agência e não é.
 */
export default function UsagePage() {
  const { data: execucoes, isPending, isError } = useExecutions();

  const porPessoa = new Map<
    string,
    { nome: string; total: number; entregues: number; falhas: number; duracoes: number[]; agentes: Set<string> }
  >();

  for (const e of execucoes ?? []) {
    const chave = e.userId ?? 'desconhecido';
    const atual = porPessoa.get(chave) ?? {
      nome: e.userName ?? '—',
      total: 0,
      entregues: 0,
      falhas: 0,
      duracoes: [] as number[],
      agentes: new Set<string>(),
    };
    atual.total += 1;
    if (e.status === 'completed') atual.entregues += 1;
    if (e.status === 'failed' || e.status === 'cancelled') atual.falhas += 1;
    const d = duracaoMs(e);
    if (d !== null) atual.duracoes.push(d);
    atual.agentes.add(AGENT_META[e.agent]?.label ?? e.agent);
    porPessoa.set(chave, atual);
  }

  const linhas = [...porPessoa.values()].sort((a, b) => b.total - a.total);

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Uso"
        description="Quem está usando a inteligência, quanto, e com que resultado."
      />

      <Secao titulo="Por pessoa — janela das 50 execuções mais recentes">
        {isPending ? (
          <LinhasFantasma linhas={5} />
        ) : isError ? (
          <SemNadaAinda titulo="Não consegui ler o uso" explicacao="A consulta às execuções falhou." />
        ) : linhas.length === 0 ? (
          <SemNadaAinda
            titulo="Ninguém usou ainda"
            explicacao="Assim que alguém pedir alguma coisa a um agente, o uso aparece aqui."
          />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Pessoa</Th>
                <Th className="w-24">Pedidos</Th>
                <Th className="w-24">Entregues</Th>
                <Th className="w-24">Falhas</Th>
                <Th className="w-28">Mediana</Th>
                <Th>Agentes</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <tr key={p.nome}>
                  <Td>{p.nome}</Td>
                  <Td className="font-mono text-[13px]">{p.total}</Td>
                  <Td className="font-mono text-[13px] text-sucesso">{p.entregues}</Td>
                  <Td className={p.falhas > 0 ? 'font-mono text-[13px] text-aviso' : 'font-mono text-[13px] text-nevoa'}>
                    {p.falhas}
                  </Td>
                  <Td className="font-mono text-[12px] text-nevoa">{formatarDuracao(percentil(p.duracoes, 50))}</Td>
                  <Td className="truncate text-nevoa">{[...p.agentes].join(', ')}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
        <p className="mt-3 font-mono text-[11px] text-nevoa/70">
          Sem consumo de token aqui de propósito: as execuções só contam o que passa pelos agentes próprios, e somar
          isso pareceria o gasto da agência sem ser. O gasto real fica em Tokens &amp; Custos.
        </p>
      </Secao>
    </div>
  );
}
