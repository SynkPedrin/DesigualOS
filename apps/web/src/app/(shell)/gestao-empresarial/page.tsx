'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, CalendarClock, FileWarning, Landmark } from 'lucide-react';
import { Aviso, AvisoHistoricoParcial, Carregando, Dinheiro } from '@/components/gestao-empresarial/kit';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { useVisaoGeral } from '@/hooks/use-gestao-visao-geral';
import { formatarCentavos } from '@/lib/gestao-empresarial/formato';
import { cn } from '@/lib/utils';

function Cartao({ icone: Icone, rotulo, valor, detalhe, tom = 'neutro', href }: { icone: typeof Landmark; rotulo: string; valor: React.ReactNode; detalhe?: React.ReactNode; tom?: 'neutro' | 'verde' | 'vermelho' | 'amarelo'; href?: string }) {
  const cor = { neutro: 'bg-grafite-elevado text-nevoa', verde: 'bg-sucesso/15 text-sucesso', vermelho: 'bg-red-500/15 text-red-500', amarelo: 'bg-aviso/15 text-aviso' }[tom];
  const corpo = (
    <>
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg', cor)}><Icone size={20} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block text-xs text-nevoa">{rotulo}</span>
        <span className="block font-heading text-2xl font-semibold leading-tight text-branco-cru">{valor}</span>
        {detalhe && <span className="block line-clamp-2 text-[11px] text-nevoa">{detalhe}</span>}
      </span>
    </>
  );
  const classe = 'flex items-center gap-3 rounded-xl border border-grafite-elevado bg-grafite p-3';
  return href ? <Link href={href} className={cn(classe, 'transition-colors hover:border-sinal/60')}>{corpo}</Link> : <div className={classe}>{corpo}</div>;
}

export default function VisaoGeralPage() {
  const { data, isPending, isError, refetch } = useVisaoGeral();
  if (isPending) return <Carregando linhas={4} />;
  if (isError || !data) return <InlineSectionError message="Não conseguimos carregar a visão geral." onRetry={() => void refetch()} />;
  const v = data;
  const vazio = v.receita.recebida + v.receita.aberta + v.despesa.paga + v.despesa.aberta + v.cancelado.receita + v.cancelado.despesa === 0;

  return (
    <div className="space-y-5">
      {v.importacaoPendente.linhas > 0 && (
        <Aviso tom="aviso" titulo={`${v.importacaoPendente.linhas} ${v.importacaoPendente.linhas === 1 ? 'linha importada espera' : 'linhas importadas esperam'} uma decisão`}>
          Elas ainda não viraram cadastro nem lançamento. <Link href="/gestao-empresarial/configuracoes/importacao" className="underline">Abrir a importação</Link>.
        </Aviso>
      )}
      {v.historicoParcial && <AvisoHistoricoParcial />}
      {vazio && !v.importacaoPendente.linhas && (
        <Aviso tom="info" titulo="Ainda não há movimento financeiro">
          Comece por <Link href="/gestao-empresarial/cadastros/clientes" className="underline">cadastrar clientes</Link> e <Link href="/gestao-empresarial/financeiro/receber" className="underline">lançar o primeiro valor a receber</Link>, ou <Link href="/gestao-empresarial/configuracoes/importacao" className="underline">importar os dados do Operand</Link>.
        </Aviso>
      )}

      <section aria-label="Resumo" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Cartao icone={ArrowDownCircle} tom="verde" rotulo="Receita recebida" valor={<Dinheiro centavos={v.receita.recebida} />} detalhe={`${formatarCentavos(v.receita.aberta)} ainda a receber`} href="/gestao-empresarial/financeiro/receber" />
        <Cartao icone={ArrowUpCircle} rotulo="Despesa paga" valor={<Dinheiro centavos={v.despesa.paga} />} detalhe={`${formatarCentavos(v.despesa.aberta)} ainda a pagar`} href="/gestao-empresarial/financeiro/pagar" />
        <Cartao
          icone={Landmark}
          rotulo="Saldo nas contas"
          valor={v.saldo.contasComSaldo > 0 ? <Dinheiro centavos={v.saldo.totalCents} /> : '—'}
          detalhe={v.saldo.contasSemSaldoInicial > 0 ? `${v.saldo.contasSemSaldoInicial} ${v.saldo.contasSemSaldoInicial === 1 ? 'conta' : 'contas'} sem saldo inicial informado` : 'Soma das contas cadastradas'}
          href="/gestao-empresarial/financeiro/contas"
        />
        <Cartao icone={FileWarning} rotulo="Cancelado (fora dos totais)" valor={<Dinheiro centavos={v.cancelado.receita + v.cancelado.despesa} />} detalhe="Nunca entra em receita nem despesa" />
      </section>

      <section aria-label="Atenção" className="grid gap-3 md:grid-cols-2">
        <Cartao icone={AlertTriangle} tom={v.vencidos.receita.quantidade > 0 ? 'vermelho' : 'neutro'} rotulo="A receber em atraso" valor={<Dinheiro centavos={v.vencidos.receita.totalCents} />} detalhe={`${v.vencidos.receita.quantidade} ${v.vencidos.receita.quantidade === 1 ? 'lançamento' : 'lançamentos'}`} href="/gestao-empresarial/financeiro/receber?situacao=vencido" />
        <Cartao icone={AlertTriangle} tom={v.vencidos.despesa.quantidade > 0 ? 'vermelho' : 'neutro'} rotulo="A pagar em atraso" valor={<Dinheiro centavos={v.vencidos.despesa.totalCents} />} detalhe={`${v.vencidos.despesa.quantidade} ${v.vencidos.despesa.quantidade === 1 ? 'lançamento' : 'lançamentos'}`} href="/gestao-empresarial/financeiro/pagar?situacao=vencido" />
        <Cartao icone={CalendarClock} tom="amarelo" rotulo="A receber nos próximos 7 dias" valor={<Dinheiro centavos={v.proximos7Dias.receita.totalCents} />} detalhe={`${v.proximos7Dias.receita.quantidade} ${v.proximos7Dias.receita.quantidade === 1 ? 'lançamento' : 'lançamentos'}`} />
        <Cartao icone={CalendarClock} tom="amarelo" rotulo="A pagar nos próximos 7 dias" valor={<Dinheiro centavos={v.proximos7Dias.despesa.totalCents} />} detalhe={`${v.proximos7Dias.despesa.quantidade} ${v.proximos7Dias.despesa.quantidade === 1 ? 'lançamento' : 'lançamentos'}`} />
      </section>

      {v.pagamentosSemData > 0 && (
        <p className="text-xs text-nevoa">
          {v.pagamentosSemData} {v.pagamentosSemData === 1 ? 'lançamento quitado não tem' : 'lançamentos quitados não têm'} a data real do pagamento (o arquivo de origem não a trazia). Eles contam como pagos, mas ficam fora do fluxo de caixa por data.
        </p>
      )}
    </div>
  );
}
