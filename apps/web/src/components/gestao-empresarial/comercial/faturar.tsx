'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useComercialAcoes, type FaturamentoWire, type PedidoDeVendaWire } from '@/hooks/use-gestao-comercial';
import { formatarCentavos, formatarDia, hojeIso } from '@/lib/gestao-empresarial/formato';
import { toast } from '@/stores/toast-store';
import { Aviso, BOTAO, BOTAO_SECUNDARIO, Campo, CAMPO, Dialogo, mensagemDeErro } from '../kit';
import { previaDasParcelas } from './parcelas';

export function Faturar({ pedido, onFechar }: { pedido: PedidoDeVendaWire; onFechar: () => void }) {
  const { faturar } = useComercialAcoes();
  const [parcelas, setParcelas] = useState(1);
  const [primeiro, setPrimeiro] = useState(hojeIso());
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<FaturamentoWire | null>(null);
  const previa = previaDasParcelas(pedido.totalCents, parcelas, primeiro);

  if (feito) {
    return (
      <Dialogo titulo={`Pedido ${pedido.number} faturado`} onFechar={onFechar}>
        <Aviso tom="info" titulo={`${feito.lancamentos.length} ${feito.lancamentos.length === 1 ? 'conta a receber criada' : 'contas a receber criadas'}`}>As parcelas já estão no financeiro, em aberto.</Aviso>
        <ul className="mt-3 space-y-1 text-sm text-branco-cru">
          {feito.lancamentos.map((l) => <li key={l.id} className="flex justify-between tabular-nums"><span>{l.installmentNo}/{l.installmentTotal} · vence {formatarDia(l.dueDate)}</span><span>{formatarCentavos(l.amountCents)}</span></li>)}
        </ul>
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Fechar</button><Link href="/gestao-empresarial/financeiro/receber" className={BOTAO}>Ver no financeiro</Link></div>
      </Dialogo>
    );
  }
  return (
    <Dialogo titulo={`Faturar pedido ${pedido.number}`} onFechar={onFechar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); faturar.mutate({ id: pedido.id, parcelas, primeiroVencimento: primeiro }, { onSuccess: (r) => { toast(`Pedido ${pedido.number} faturado.`, 'success'); setFeito(r); }, onError: (er) => setErro(mensagemDeErro(er, 'Não foi possível faturar.')) }); }}>
        <p className="text-sm text-nevoa">Faturar cria as <strong className="text-branco-cru">contas a receber</strong> deste pedido no financeiro, de {formatarCentavos(pedido.totalCents)} no total. Acontece uma única vez.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Parcelas">{(p) => <input {...p} type="number" min={1} max={120} step={1} value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))} className={CAMPO} />}</Campo>
          <Campo rotulo="Primeiro vencimento">{(p) => <input {...p} type="date" required value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} className={CAMPO} />}</Campo>
        </div>
        {previa.length > 0 ? (
          <ul aria-label="Prévia das parcelas" className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-grafite-elevado bg-carbono p-2 text-sm text-branco-cru">
            {previa.map((p) => <li key={p.numero} className="flex justify-between tabular-nums"><span>{p.numero}/{previa.length} · {formatarDia(p.vencimento)}</span><span>{formatarCentavos(p.valor)}</span></li>)}
          </ul>
        ) : <p className="text-sm text-red-500">Informe de 1 a 120 parcelas e um vencimento válido.</p>}
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button><button type="submit" disabled={faturar.isPending || previa.length === 0} className={BOTAO}>{faturar.isPending ? 'Faturando…' : 'Faturar'}</button></div>
      </form>
    </Dialogo>
  );
}
