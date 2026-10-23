'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { BOTAO, BOTAO_PERIGO, BOTAO_SECUNDARIO, Campo, CampoDinheiro, CAMPO, Carregando, Dialogo, Dinheiro, Selo, TD, TH, TH_DIREITA, Tabela, Vazio, mensagemDeErro } from '@/components/gestao-empresarial/kit';
import { ACAO_DE_STATUS, SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { MargemDoPedido } from '@/components/gestao-empresarial/producao/margem';
import { TRANSICOES_PEDIDO_DE_PRODUCAO, usePedidoDeProducao, useProducaoAcoes, type CustoWire, type StatusDoPedidoDeProducao } from '@/hooks/use-gestao-producao';
import { formatarCentavos, formatarDia, hojeIso } from '@/lib/gestao-empresarial/formato';
import { toast } from '@/stores/toast-store';

function NovoCusto({ id, onFechar }: { id: string; onFechar: () => void }) {
  const { adicionarCusto } = useProducaoAcoes();
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState<number | null>(null);
  const [data, setData] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo="Adicionar custo" onFechar={onFechar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); if (valor === null || valor <= 0) return setErro('Informe um valor maior que zero.'); adicionarCusto.mutate({ id, description: descricao.trim(), amountCents: valor, incurredOn: data || null }, { onSuccess: () => { toast('Custo adicionado.', 'success'); onFechar(); }, onError: (er) => setErro(mensagemDeErro(er)) }); }}>
        <Campo rotulo="Descrição *">{(p) => <input {...p} required maxLength={300} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={CAMPO} />}</Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoDinheiro rotulo="Valor *" centavos={valor} obrigatorio onChange={setValor} />
          <Campo rotulo="Data do custo">{(p) => <input {...p} type="date" value={data} onChange={(e) => setData(e.target.value)} className={CAMPO} />}</Campo>
        </div>
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button><button type="submit" disabled={adicionarCusto.isPending || !descricao.trim()} className={BOTAO}>{adicionarCusto.isPending ? 'Salvando…' : 'Adicionar'}</button></div>
      </form>
    </Dialogo>
  );
}

function GerarDespesa({ custo, onFechar }: { custo: CustoWire; onFechar: () => void }) {
  const { gerarDespesa } = useProducaoAcoes();
  const [venc, setVenc] = useState(hojeIso());
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo="Gerar despesa no financeiro" onFechar={onFechar} largura="max-w-md">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); gerarDespesa.mutate({ custoId: custo.id, dueDate: venc }, { onSuccess: () => { toast('Despesa criada em aberto no financeiro.', 'success'); onFechar(); }, onError: (er) => setErro(mensagemDeErro(er)) }); }}>
        <p className="text-sm text-nevoa">Cria uma <strong className="text-branco-cru">conta a pagar em aberto</strong> de {formatarCentavos(custo.amountCents)} para “{custo.description}”, com o fornecedor do pedido. Cada custo gera uma despesa, uma única vez. Pagar é outra ação, no financeiro.</p>
        <Campo rotulo="Vencimento">{(p) => <input {...p} type="date" required value={venc} onChange={(e) => setVenc(e.target.value)} className={CAMPO} />}</Campo>
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button><button type="submit" disabled={gerarDespesa.isPending} className={BOTAO}>{gerarDespesa.isPending ? 'Gerando…' : 'Gerar despesa'}</button></div>
      </form>
    </Dialogo>
  );
}

export default function PedidoDeProducaoPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, refetch } = usePedidoDeProducao(id);
  const { statusPedido } = useProducaoAcoes();
  const [custoNovo, setCustoNovo] = useState(false);
  const [despesaDe, setDespesaDe] = useState<CustoWire | null>(null);
  const [cancelando, setCancelando] = useState(false);
  if (isPending) return <Carregando linhas={6} />;
  if (isError || !data) return <InlineSectionError message="Não encontramos este pedido de produção." onRetry={() => void refetch()} />;
  const { pedido: p, custos } = data;

  function mudar(status: StatusDoPedidoDeProducao) {
    statusPedido.mutate({ id, status }, { onSuccess: () => { toast(`Pedido: ${(ACAO_DE_STATUS[status] ?? status).toLowerCase()}.`, 'success'); setCancelando(false); }, onError: (e) => { setCancelando(false); toast(mensagemDeErro(e), 'error'); } });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/gestao-empresarial/producao/pedidos" className="inline-flex items-center gap-1 text-xs text-nevoa hover:text-branco-cru"><ArrowLeft size={12} /> Pedidos de produção</Link>
          <h2 className="mt-1 font-heading text-xl font-semibold text-branco-cru"><span className="font-mono text-sm text-nevoa">{p.number}</span> {p.title}</h2>
          <div className="mt-1"><SeloDeStatus status={p.status} /></div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Mudar situação">
          {TRANSICOES_PEDIDO_DE_PRODUCAO[p.status].map((s) => <button key={s} type="button" disabled={statusPedido.isPending} onClick={() => (s === 'cancelada' ? setCancelando(true) : mudar(s))} className={s === 'cancelada' ? BOTAO_PERIGO : BOTAO}>{s === 'cancelada' ? 'Cancelar pedido' : ACAO_DE_STATUS[s]}</button>)}
        </div>
      </div>

      <section aria-label="Resumo financeiro" className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-grafite-elevado bg-grafite p-3"><p className="text-xs text-nevoa">Valor cobrado do cliente</p><p className="font-heading text-2xl font-semibold text-branco-cru"><Dinheiro centavos={p.saleCents} /></p>{p.saleCents === null && <p className="text-[11px] text-nevoa">Não informado</p>}</div>
        <div className="rounded-xl border border-grafite-elevado bg-grafite p-3"><p className="text-xs text-nevoa">Custos lançados</p><p className="font-heading text-2xl font-semibold text-branco-cru"><Dinheiro centavos={data.custoCents} /></p></div>
        <div className="rounded-xl border border-grafite-elevado bg-grafite p-3"><p className="text-xs text-nevoa">Margem</p><p className="font-heading text-2xl font-semibold text-branco-cru"><MargemDoPedido margemCents={data.margemCents} percentual={data.percentual} /></p></div>
      </section>

      <section aria-label="Custos" className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Custos</h3>{p.status !== 'cancelada' && <button type="button" onClick={() => setCustoNovo(true)} className={BOTAO}>Adicionar custo</button>}</div>
        {custos.length === 0 ? <Vazio titulo="Nenhum custo lançado">Lance o que este pedido custou (material, mão de obra, frete) para ver a margem real.</Vazio> : (
          <Tabela legenda="Custos do pedido">
            <thead><tr><th className={TH}>Descrição</th><th className={TH}>Data</th><th className={TH_DIREITA}>Valor</th><th className={TH}>Financeiro</th></tr></thead>
            <tbody>
              {custos.map((c) => (
                <tr key={c.id} className="border-t border-grafite-elevado/60">
                  <td className={TD}>{c.description}</td>
                  <td className={`${TD} tabular-nums text-nevoa`}>{formatarDia(c.incurredOn) || '—'}</td>
                  <td className={`${TD} text-right`}><Dinheiro centavos={c.amountCents} /></td>
                  <td className={TD}>{c.entryId ? <span className="inline-flex items-center gap-2"><Selo classe="bg-sucesso/15 text-sucesso">Despesa gerada</Selo><Link href="/gestao-empresarial/financeiro/pagar" className="text-xs text-nevoa underline">ver</Link></span> : <button type="button" onClick={() => setDespesaDe(c)} className={`${BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>Gerar despesa</button>}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </section>

      {custoNovo && <NovoCusto id={id} onFechar={() => setCustoNovo(false)} />}
      {despesaDe && <GerarDespesa custo={despesaDe} onFechar={() => setDespesaDe(null)} />}
      {cancelando && (
        <Dialogo titulo="Cancelar pedido de produção?" onFechar={() => setCancelando(false)} largura="max-w-sm">
          <p className="text-sm text-nevoa">O pedido deixa de receber custos. Esta situação é final.</p>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCancelando(false)} className={BOTAO_SECUNDARIO}>Voltar</button><button type="button" disabled={statusPedido.isPending} onClick={() => mudar('cancelada')} className={BOTAO_PERIGO}>Cancelar pedido</button></div>
        </Dialogo>
      )}
    </div>
  );
}
