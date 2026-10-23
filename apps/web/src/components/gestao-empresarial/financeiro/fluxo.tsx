'use client';

import { InlineSectionError } from '@/components/ui/inline-section-error';
import { useFluxo } from '@/hooks/use-gestao-financeiro';
import { Aviso, Carregando, Dinheiro, TD, TH, TH_DIREITA, Tabela, Vazio } from '../kit';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeDoMes = (aaaamm: string) => {
  const mes = MESES[Number(aaaamm.slice(5, 7)) - 1] ?? aaaamm.slice(5, 7);
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} de ${aaaamm.slice(0, 4)}`;
};

export function FluxoDeCaixa() {
  const { data, isPending, isError, refetch } = useFluxo();
  if (isPending) return <Carregando linhas={4} />;
  if (isError) return <InlineSectionError message="Não conseguimos carregar o fluxo de caixa." onRetry={() => void refetch()} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-nevoa">Projeção do que está <strong className="text-branco-cru">em aberto</strong>. O que já foi pago ou recebido está no razão das contas; cancelados ficam de fora. O acumulado parte da soma dos saldos das contas.</p>
      {data.contasSemSaldoInicial > 0 && <Aviso tom="aviso">{data.contasSemSaldoInicial} {data.contasSemSaldoInicial === 1 ? 'conta está sem saldo inicial' : 'contas estão sem saldo inicial'} e fora do ponto de partida do acumulado. Informe o saldo de abertura na aba Contas para o acumulado representar o caixa de verdade.</Aviso>}
      {(data.vencidoACobrar > 0 || data.vencidoAPagar > 0) && (
        <Aviso tom="erro" titulo="Atrasados, já contados no mês atual">
          A receber em atraso: <strong><Dinheiro centavos={data.vencidoACobrar} /></strong> · a pagar em atraso: <strong><Dinheiro centavos={data.vencidoAPagar} /></strong>. É dinheiro que deveria ter entrado ou saído; não é entrada futura garantida.
        </Aviso>
      )}
      {data.meses.length === 0 ? <Vazio titulo="Nada em aberto para projetar">Lançamentos a receber e a pagar em aberto aparecem aqui, mês a mês.</Vazio> : (
        <Tabela legenda="Fluxo de caixa projetado por mês">
          <thead><tr className="border-b border-grafite-elevado"><th className={TH}>Mês</th><th className={TH_DIREITA}>A receber</th><th className={TH_DIREITA}>A pagar</th><th className={TH_DIREITA}>Saldo do mês</th><th className={TH_DIREITA}>Acumulado</th></tr></thead>
          <tbody>{data.meses.map((m) => (
            <tr key={m.mes} className="border-t border-grafite-elevado/60">
              <td className={TD}>{nomeDoMes(m.mes)}</td>
              <td className={`${TD} text-right`}><Dinheiro centavos={m.aReceber} /></td>
              <td className={`${TD} text-right`}><Dinheiro centavos={m.aPagar} /></td>
              <td className={`${TD} text-right`}><Dinheiro centavos={m.saldoDoMes} /></td>
              <td className={`${TD} text-right font-medium`}><Dinheiro centavos={m.acumulado} /></td>
            </tr>
          ))}</tbody>
        </Tabela>
      )}
    </div>
  );
}
