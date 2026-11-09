'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Aviso, BOTAO, BOTAO_PERIGO, BOTAO_SECUNDARIO, Campo, CAMPO, Carregando, Dialogo, Dinheiro, mensagemDeErro } from '@/components/gestao-empresarial/kit';
import { EditorDeItens, itensParaEnvio, novoItem, type ItemEmEdicao } from '@/components/gestao-empresarial/comercial/editor-de-itens';
import { ACAO_DE_STATUS, SeloDeStatus } from '@/components/gestao-empresarial/comercial/rotulos';
import { SeletorDePessoa } from '@/components/gestao-empresarial/comercial/seletor-de-pessoa';
import { TRANSICOES_PROPOSTA, useComercialAcoes, useProposta, usePessoasPorId, type PessoaResumoWire, type PropostaDetalheWire, type StatusDaProposta } from '@/hooks/use-gestao-comercial';
import { formatarDia } from '@/lib/gestao-empresarial/formato';
import { toast } from '@/stores/toast-store';

function GerarContrato({ proposta, onFechar }: { proposta: PropostaDetalheWire; onFechar: () => void }) {
  const { criarContrato } = useComercialAcoes();
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo="Gerar contrato" onFechar={onFechar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); criarContrato.mutate({ proposalId: proposta.id, startsOn: inicio || null, endsOn: fim || null }, { onSuccess: (c) => { toast(`Contrato ${c.number} criado como rascunho.`, 'success'); onFechar(); }, onError: (er) => setErro(mensagemDeErro(er)) }); }}>
        <p className="text-sm text-nevoa">O contrato leva o título, o cliente e o total desta proposta e nasce como <strong className="text-branco-cru">rascunho</strong>. Cada proposta gera um contrato.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Início">{(p) => <input {...p} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={CAMPO} />}</Campo>
          <Campo rotulo="Fim">{(p) => <input {...p} type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} className={CAMPO} />}</Campo>
        </div>
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button><button type="submit" disabled={criarContrato.isPending} className={BOTAO}>{criarContrato.isPending ? 'Gerando…' : 'Gerar contrato'}</button></div>
      </form>
    </Dialogo>
  );
}

function Editor({ proposta }: { proposta: PropostaDetalheWire }) {
  const { editarProposta, statusProposta, criarPedido } = useComercialAcoes();
  const nomes = usePessoasPorId([proposta.partyId]);
  const editavel = proposta.status === 'rascunho';
  const [titulo, setTitulo] = useState(proposta.title);
  const [validade, setValidade] = useState(proposta.validUntil ?? '');
  const [notas, setNotas] = useState(proposta.notes ?? '');
  const [cliente, setCliente] = useState<PessoaResumoWire | null | undefined>(undefined);
  const [itens, setItens] = useState<ItemEmEdicao[]>(() => proposta.items.map((i) => novoItem(i)));
  const [erro, setErro] = useState<string | null>(null);
  const [contrato, setContrato] = useState(false);
  const [confirmar, setConfirmar] = useState<StatusDaProposta | null>(null);
  const pronto = itensParaEnvio(itens);

  function salvar() {
    setErro(null);
    if (!pronto) return setErro('Complete os itens antes de salvar.');
    editarProposta.mutate({ id: proposta.id, title: titulo.trim(), validUntil: validade || null, notes: notas.trim() || null, items: pronto, ...(cliente !== undefined && { partyId: cliente?.id ?? null }) }, { onSuccess: () => toast('Proposta salva.', 'success'), onError: (e) => setErro(mensagemDeErro(e, 'Não foi possível salvar.')) });
  }
  function mudar(status: StatusDaProposta) {
    statusProposta.mutate({ id: proposta.id, status }, { onSuccess: () => { toast(`Proposta: ${ACAO_DE_STATUS[status]?.toLowerCase() ?? status}.`, 'success'); setConfirmar(null); }, onError: (e) => { setConfirmar(null); toast(mensagemDeErro(e), 'error'); } });
  }
  const clienteAtual = cliente === undefined ? (proposta.partyId ? { id: proposta.partyId, name: nomes.data?.[proposta.partyId] ?? '…', document: null, roles: [] } : null) : cliente;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/gestao-empresarial/comercial/propostas" className="inline-flex items-center gap-1 text-xs text-nevoa hover:text-branco-cru"><ArrowLeft size={12} /> Propostas</Link>
          <h2 className="mt-1 font-heading text-xl font-semibold text-branco-cru"><span className="font-mono text-sm text-nevoa">{proposta.number}</span> {proposta.title}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-nevoa"><SeloDeStatus status={proposta.status} /> Total <Dinheiro centavos={proposta.totalCents} className="font-semibold text-branco-cru" /></div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Mudar situação">
          {proposta.status === 'aprovada' && <button type="button" onClick={() => setContrato(true)} className={BOTAO}>Gerar contrato</button>}
          {proposta.status === 'aprovada' && (
            <button type="button" disabled={criarPedido.isPending} onClick={() => criarPedido.mutate({ proposalId: proposta.id }, { onSuccess: (o) => toast(`Pedido ${o.number} criado. Fature-o em Pedidos de venda.`, 'success'), onError: (e) => toast(mensagemDeErro(e), 'error') })} className={BOTAO}>Gerar pedido de venda</button>
          )}
          {TRANSICOES_PROPOSTA[proposta.status].map((s) => (
            <button key={s} type="button" disabled={statusProposta.isPending} onClick={() => (s === 'cancelada' || s === 'recusada' || s === 'expirada' ? setConfirmar(s) : mudar(s))} className={s === 'cancelada' ? BOTAO_PERIGO : s === 'aprovada' || s === 'enviada' ? BOTAO : BOTAO_SECUNDARIO}>{ACAO_DE_STATUS[s]}</button>
          ))}
        </div>
      </div>

      {!editavel && <Aviso tom="info">Só uma proposta em <strong>rascunho</strong> pode ser editada.{proposta.status === 'enviada' ? ' Volte-a para rascunho se precisar mudar algo antes da decisão do cliente.' : ' Esta situação é final.'}</Aviso>}

      <section aria-label="Dados da proposta" className="grid gap-4 rounded-lg border border-grafite-elevado bg-grafite p-4 md:grid-cols-2">
        <Campo rotulo="Título">{(p) => <input {...p} value={titulo} disabled={!editavel} maxLength={300} onChange={(e) => setTitulo(e.target.value)} className={CAMPO} />}</Campo>
        <Campo rotulo="Válida até">{(p) => <input {...p} type="date" value={validade} disabled={!editavel} onChange={(e) => setValidade(e.target.value)} className={CAMPO} />}</Campo>
        {editavel ? <SeletorDePessoa rotulo="Cliente" papel="cliente" valor={clienteAtual} onChange={setCliente} /> : <div className="space-y-1"><p className="text-xs text-nevoa">Cliente</p><p className="text-sm text-branco-cru">{clienteAtual?.name ?? 'Sem cliente'}</p></div>}
        <Campo rotulo="Observações">{(p) => <textarea {...p} rows={2} value={notas} disabled={!editavel} maxLength={4000} onChange={(e) => setNotas(e.target.value)} className={CAMPO} />}</Campo>
      </section>

      <section aria-label="Itens">
        <h3 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Itens</h3>
        <EditorDeItens itens={itens} onChange={setItens} desabilitado={!editavel} />
      </section>

      {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
      {editavel && <div className="flex justify-end"><button type="button" onClick={salvar} disabled={editarProposta.isPending || !titulo.trim()} className={BOTAO}>{editarProposta.isPending ? 'Salvando…' : 'Salvar alterações'}</button></div>}
      {proposta.validUntil && <p className="text-xs text-nevoa">Validade: {formatarDia(proposta.validUntil)}</p>}

      {contrato && <GerarContrato proposta={proposta} onFechar={() => setContrato(false)} />}
      {confirmar && (
        <Dialogo titulo={ACAO_DE_STATUS[confirmar] ?? 'Confirmar'} onFechar={() => setConfirmar(null)} largura="max-w-sm">
          <p className="text-sm text-nevoa">A proposta ficará {confirmar === 'cancelada' ? 'cancelada' : confirmar === 'recusada' ? 'recusada' : 'expirada'}. Esta situação é final.</p>
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setConfirmar(null)} className={BOTAO_SECUNDARIO}>Voltar</button><button type="button" onClick={() => mudar(confirmar)} disabled={statusProposta.isPending} className={BOTAO_PERIGO}>Confirmar</button></div>
        </Dialogo>
      )}
    </div>
  );
}

export default function PropostaPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, refetch } = useProposta(id);
  if (isPending) return <Carregando linhas={6} />;
  if (isError || !data) return <InlineSectionError message="Não encontramos esta proposta." onRetry={() => void refetch()} />;
  // `key` reinicia o formulário quando a proposta muda de situação ou é salva (o servidor é a fonte da verdade).
  return <Editor key={`${data.id}:${data.status}:${data.totalCents}:${data.items.length}`} proposta={data} />;
}
