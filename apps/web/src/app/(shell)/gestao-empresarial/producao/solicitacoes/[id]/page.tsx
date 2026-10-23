'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Aviso, BOTAO, BOTAO_PERIGO, BOTAO_SECUNDARIO, Campo, CampoDinheiro, CAMPO, Carregando, Dialogo, Dinheiro, TD, TH, TH_DIREITA, Tabela, Vazio, mensagemDeErro } from '@/components/gestao-empresarial/kit';
import { SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { SeletorDePessoa } from '@/components/gestao-empresarial/comercial/seletor-de-pessoa';
import type { PessoaResumoWire } from '@/hooks/use-gestao-comercial';
import { useCotacoes, useProducaoAcoes, type CotacaoWire, type SolicitacaoWire } from '@/hooks/use-gestao-producao';
import { formatarCentavos, formatarDia } from '@/lib/gestao-empresarial/formato';
import { toast } from '@/stores/toast-store';

type PapelDeFornecedor = 'fornecedor' | 'veiculo_midia' | 'prestador';

function NovaCotacao({ id, onFechar }: { id: string; onFechar: () => void }) {
  const { registrarCotacao } = useProducaoAcoes();
  const [papel, setPapel] = useState<PapelDeFornecedor>('fornecedor');
  const [fornecedor, setFornecedor] = useState<PessoaResumoWire | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [prazo, setPrazo] = useState('');
  const [notas, setNotas] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo="Registrar cotação" onFechar={onFechar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); if (!fornecedor || total === null || total <= 0) return setErro('Escolha o fornecedor e informe um valor maior que zero.'); registrarCotacao.mutate({ id, supplierId: fornecedor.id, totalCents: total, leadTimeDays: prazo === '' ? null : Number(prazo), notes: notas.trim() || null }, { onSuccess: () => { toast('Cotação registrada.', 'success'); onFechar(); }, onError: (er) => setErro(mensagemDeErro(er)) }); }}>
        <Campo rotulo="Tipo de fornecedor">{(p) => <select {...p} value={papel} onChange={(e) => { setPapel(e.target.value as PapelDeFornecedor); setFornecedor(null); }} className={CAMPO}><option value="fornecedor">Fornecedor</option><option value="veiculo_midia">Veículo de mídia</option><option value="prestador">Prestador</option></select>}</Campo>
        <SeletorDePessoa key={papel} rotulo="Quem cotou" papel={papel} valor={fornecedor} onChange={setFornecedor} obrigatorio />
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoDinheiro rotulo="Valor total da cotação *" centavos={total} obrigatorio onChange={setTotal} />
          <Campo rotulo="Prazo de entrega (dias)">{(p) => <input {...p} type="number" min={0} max={3650} step={1} value={prazo} onChange={(e) => setPrazo(e.target.value)} className={CAMPO} />}</Campo>
        </div>
        <Campo rotulo="Observações">{(p) => <textarea {...p} rows={2} maxLength={2000} value={notas} onChange={(e) => setNotas(e.target.value)} className={CAMPO} />}</Campo>
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button><button type="submit" disabled={registrarCotacao.isPending} className={BOTAO}>{registrarCotacao.isPending ? 'Salvando…' : 'Registrar cotação'}</button></div>
      </form>
    </Dialogo>
  );
}

function NovoPedido({ s, onFechar }: { s: SolicitacaoWire; onFechar: () => void }) {
  const router = useRouter();
  const { criarPedido } = useProducaoAcoes();
  const [titulo, setTitulo] = useState(s.title);
  const [venda, setVenda] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo="Abrir pedido de produção" onFechar={onFechar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); criarPedido.mutate({ requestId: s.id, title: titulo.trim(), saleCents: venda }, { onSuccess: (o) => { toast(`Pedido ${o.number} aberto.`, 'success'); onFechar(); router.push(`/gestao-empresarial/producao/pedidos/${o.id}`); }, onError: (er) => setErro(mensagemDeErro(er)) }); }}>
        <p className="text-sm text-nevoa">O pedido usa o fornecedor da cotação escolhida. Informe o valor cobrado do cliente para acompanhar a margem; se ainda não souber, deixe em branco (a margem fica sem percentual).</p>
        <Campo rotulo="Título">{(p) => <input {...p} required maxLength={300} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={CAMPO} />}</Campo>
        <CampoDinheiro rotulo="Valor cobrado do cliente" centavos={venda} onChange={setVenda} />
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button><button type="submit" disabled={criarPedido.isPending || !titulo.trim()} className={BOTAO}>{criarPedido.isPending ? 'Abrindo…' : 'Abrir pedido'}</button></div>
      </form>
    </Dialogo>
  );
}

export default function SolicitacaoPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, refetch } = useCotacoes(id);
  const { escolherCotacao, cancelarSolicitacao } = useProducaoAcoes();
  const [cotando, setCotando] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  const [escolhendo, setEscolhendo] = useState<CotacaoWire | null>(null);
  const [cancelando, setCancelando] = useState(false);
  if (isPending) return <Carregando linhas={6} />;
  if (isError || !data) return <InlineSectionError message="Não encontramos esta solicitação." onRetry={() => void refetch()} />;
  const { solicitacao: s, cotacoes } = data;
  const recebe = s.status === 'aberta' || s.status === 'cotando';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/gestao-empresarial/producao/solicitacoes" className="inline-flex items-center gap-1 text-xs text-nevoa hover:text-branco-cru"><ArrowLeft size={12} /> Solicitações</Link>
          <h2 className="mt-1 font-heading text-xl font-semibold text-branco-cru"><span className="font-mono text-sm text-nevoa">{s.number}</span> {s.title}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-nevoa"><SeloDeStatus status={s.status} />{s.dueOn && <span>Prazo {formatarDia(s.dueOn)}</span>}</div>
          {s.description && <p className="mt-2 max-w-2xl text-sm text-nevoa">{s.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {recebe && <button type="button" onClick={() => setCotando(true)} className={BOTAO}>Registrar cotação</button>}
          {s.status === 'aprovada' && <button type="button" onClick={() => setAbrindo(true)} className={BOTAO}>Abrir pedido de produção</button>}
          {recebe && <button type="button" onClick={() => setCancelando(true)} className={BOTAO_PERIGO}>Cancelar solicitação</button>}
        </div>
      </div>

      {s.status === 'cotando' && cotacoes.length >= 1 && <Aviso tom="info">Compare as cotações abaixo e escolha uma. As demais ficam descartadas e a solicitação é aprovada.</Aviso>}
      {s.status === 'aprovada' && <Aviso tom="info">Cotação escolhida. Abra o pedido de produção para registrar custos e acompanhar a margem.</Aviso>}

      {cotacoes.length === 0 ? (
        <Vazio titulo="Nenhuma cotação ainda">{recebe ? 'Registre a cotação de cada fornecedor para compará-las lado a lado.' : 'Esta solicitação não recebeu cotações.'}</Vazio>
      ) : (
        <Tabela legenda="Cotações da solicitação, da mais barata para a mais cara">
          <thead><tr><th className={TH}>Fornecedor</th><th className={TH_DIREITA}>Valor</th><th className={TH_DIREITA}>Diferença para a menor</th><th className={TH}>Prazo</th><th className={TH}>Situação</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {cotacoes.map((c, i) => (
              <tr key={c.id} className={`border-t border-grafite-elevado/60 ${c.status === 'descartada' ? 'opacity-60' : ''}`}>
                <td className={TD}>{c.fornecedor ?? '—'}{i === 0 && c.status !== 'descartada' && <span className="ml-2 text-[11px] text-sucesso">menor valor</span>}{c.notes && <span className="block text-xs text-nevoa">{c.notes}</span>}</td>
                <td className={`${TD} text-right`}><Dinheiro centavos={c.totalCents} /></td>
                <td className={`${TD} text-right tabular-nums text-nevoa`}>{c.diferencaParaMenorCents ? `+ ${formatarCentavos(c.diferencaParaMenorCents)}` : '—'}</td>
                <td className={`${TD} tabular-nums text-nevoa`}>{c.leadTimeDays === null ? '—' : `${c.leadTimeDays} d`}</td>
                <td className={TD}><SeloDeStatusCotacao status={c.status} /></td>
                <td className={`${TD} text-right`}>{s.status === 'cotando' && c.status === 'recebida' && <button type="button" onClick={() => setEscolhendo(c)} className={`${BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>Escolher</button>}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}

      {cotando && <NovaCotacao id={id} onFechar={() => setCotando(false)} />}
      {abrindo && <NovoPedido s={s} onFechar={() => setAbrindo(false)} />}
      {escolhendo && (
        <Dialogo titulo="Escolher esta cotação?" onFechar={() => setEscolhendo(null)} largura="max-w-sm">
          <p className="text-sm text-nevoa"><strong className="text-branco-cru">{escolhendo.fornecedor}</strong> por {formatarCentavos(escolhendo.totalCents)}. As outras cotações serão descartadas e isso não se desfaz.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setEscolhendo(null)} className={BOTAO_SECUNDARIO}>Voltar</button>
            <button type="button" disabled={escolherCotacao.isPending} onClick={() => escolherCotacao.mutate({ id, quoteId: escolhendo.id }, { onSuccess: () => { toast('Cotação escolhida.', 'success'); setEscolhendo(null); }, onError: (e) => { setEscolhendo(null); toast(mensagemDeErro(e), 'error'); } })} className={BOTAO}>Escolher</button>
          </div>
        </Dialogo>
      )}
      {cancelando && (
        <Dialogo titulo="Cancelar solicitação?" onFechar={() => setCancelando(false)} largura="max-w-sm">
          <p className="text-sm text-nevoa">Ela deixa de receber cotações. Esta situação é final.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setCancelando(false)} className={BOTAO_SECUNDARIO}>Voltar</button>
            <button type="button" disabled={cancelarSolicitacao.isPending} onClick={() => cancelarSolicitacao.mutate(id, { onSuccess: () => { toast('Solicitação cancelada.', 'success'); setCancelando(false); }, onError: (e) => { setCancelando(false); toast(mensagemDeErro(e), 'error'); } })} className={BOTAO_PERIGO}>Cancelar solicitação</button>
          </div>
        </Dialogo>
      )}
    </div>
  );
}

function SeloDeStatusCotacao({ status }: { status: string }) {
  return <SeloDeStatus status={status} />;
}
