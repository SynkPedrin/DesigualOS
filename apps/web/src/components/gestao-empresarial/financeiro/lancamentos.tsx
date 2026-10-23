'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { toast } from '@/stores/toast-store';
import { useBaixar, useCancelar, useContas, useEstornar, useLancamentos, type Kind, type LancamentoWire, type Situacao } from '@/hooks/use-gestao-financeiro';
import { formatarCentavos, formatarDia } from '@/lib/gestao-empresarial/formato';
import { Aviso, BOTAO, BOTAO_PERIGO, BOTAO_SECUNDARIO, Campo, CampoDinheiro, CAMPO, Carregando, Dialogo, Dinheiro, mensagemDeErro, Paginacao, SeloDeSituacao, TD, TH, TH_DIREITA, Tabela, Vazio } from '../kit';
import { FormularioDeLancamento } from './formulario-de-lancamento';
import { hojeIso } from '@/lib/gestao-empresarial/formato';

const SITUACOES: Array<{ valor: '' | Situacao; rotulo: string }> = [
  { valor: '', rotulo: 'Todas as situações' },
  { valor: 'aberto', rotulo: 'Em aberto' },
  { valor: 'vencido', rotulo: 'Vencidos' },
  { valor: 'quitado', rotulo: 'Quitados' },
  { valor: 'cancelado', rotulo: 'Cancelados' },
];

type Acao = { tipo: 'baixar' | 'estornar' | 'cancelar' | 'editar'; l: LancamentoWire } | { tipo: 'novo' } | null;

export function Lancamentos({ kind }: { kind: Kind }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const receita = kind === 'receita';
  const situacao = (params.get('situacao') || undefined) as Situacao | undefined;
  const q = params.get('q') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const [acao, setAcao] = useState<Acao>(null);

  function mudar(novo: Record<string, string>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(novo)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!('page' in novo)) p.delete('page');
    router.replace(`${pathname}${p.size ? `?${p}` : ''}`);
  }

  const lista = useLancamentos({ kind, situacao, from: from || undefined, to: to || undefined, q: q || undefined, page });
  const filtrando = !!(situacao || q || from || to);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><Campo rotulo="Situação">{(p) => <select {...p} value={situacao ?? ''} onChange={(e) => mudar({ situacao: e.target.value })} className={CAMPO}>{SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}</select>}</Campo></div>
        <div className="w-40"><Campo rotulo="Vencimento de">{(p) => <input {...p} type="date" value={from} onChange={(e) => mudar({ from: e.target.value })} className={CAMPO} />}</Campo></div>
        <div className="w-40"><Campo rotulo="até">{(p) => <input {...p} type="date" value={to} onChange={(e) => mudar({ to: e.target.value })} className={CAMPO} />}</Campo></div>
        <div className="min-w-48 flex-1"><Campo rotulo="Buscar na descrição">{(p) => <input {...p} type="search" defaultValue={q} key={q} onKeyDown={(e) => e.key === 'Enter' && mudar({ q: e.currentTarget.value.trim() })} onBlur={(e) => e.target.value.trim() !== q && mudar({ q: e.target.value.trim() })} placeholder="Digite e tecle Enter" className={CAMPO} />}</Campo></div>
        <button type="button" onClick={() => setAcao({ tipo: 'novo' })} className={BOTAO}><Plus size={16} aria-hidden />{receita ? 'Novo a receber' : 'Novo a pagar'}</button>
      </div>

      {lista.isPending ? <Carregando /> : lista.isError ? <InlineSectionError message="Não conseguimos carregar os lançamentos." onRetry={() => void lista.refetch()} /> : lista.data.total === 0 ? (
        <Vazio titulo={filtrando ? 'Nenhum lançamento com esses filtros' : receita ? 'Nenhum valor a receber ainda' : 'Nenhuma conta a pagar ainda'}>
          {filtrando ? <button type="button" onClick={() => router.replace(pathname)} className="underline">Limpar filtros</button> : 'Use o botão acima para lançar o primeiro.'}
        </Vazio>
      ) : (
        <>
          <p className="text-sm text-nevoa" aria-live="polite">{lista.data.total} {lista.data.total === 1 ? 'lançamento' : 'lançamentos'}{filtrando ? ' neste filtro' : ''}, somando <strong className="text-branco-cru"><Dinheiro centavos={lista.data.somaCentavos} /></strong>{situacao !== 'cancelado' && <span className="text-nevoa/70"> (valor previsto, sem os cancelados)</span>}</p>
          <Tabela legenda={receita ? 'Valores a receber' : 'Contas a pagar'}>
            <thead><tr className="border-b border-grafite-elevado"><th className={TH}>Vencimento</th><th className={TH}>Descrição</th><th className={TH}>Parcela</th><th className={TH_DIREITA}>Valor</th><th className={TH}>Situação</th><th className={TH}><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {lista.data.items.map((l) => (
                <tr key={l.id} className="border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40">
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatarDia(l.dueDate)}</td>
                  <td className={TD}><span className="block max-w-sm truncate" title={l.description}>{l.description}</span>{l.partyLabel && <span className="block text-xs text-nevoa">{l.partyLabel}</span>}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums text-nevoa`}>{l.installmentNo ? `${l.installmentNo}/${l.installmentTotal}` : ''}</td>
                  <td className={`${TD} text-right`}><Dinheiro centavos={l.amountCents} />{l.paidAmountCents !== null && l.paidAmountCents !== l.amountCents && <span className="block text-xs text-nevoa">pago {formatarCentavos(l.paidAmountCents)}</span>}</td>
                  <td className={TD}><SeloDeSituacao situacao={l.situacao} />{l.status === 'quitado' && (l.paidAt ? <span className="mt-0.5 block text-xs text-nevoa">em {formatarDia(l.paidAt)}</span> : <span className="mt-0.5 block text-xs text-nevoa">data do pagamento desconhecida</span>)}</td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <div className="flex justify-end gap-1">
                      {l.status === 'aberto' && <><button type="button" onClick={() => setAcao({ tipo: 'baixar', l })} className={`${BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>{receita ? 'Receber' : 'Pagar'}</button><button type="button" onClick={() => setAcao({ tipo: 'editar', l })} className={`${BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>Editar</button><button type="button" onClick={() => setAcao({ tipo: 'cancelar', l })} className={`${BOTAO_PERIGO} px-2 py-1 text-xs`}>Cancelar</button></>}
                      {l.status === 'quitado' && l.paidAt && <button type="button" onClick={() => setAcao({ tipo: 'estornar', l })} className={`${BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>Estornar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Paginacao page={lista.data.page} totalPages={lista.data.totalPages} total={lista.data.total} pageSize={lista.data.pageSize} onPage={(n) => mudar({ page: String(n) })} />
        </>
      )}

      {acao?.tipo === 'novo' && <Dialogo titulo={receita ? 'Novo valor a receber' : 'Nova conta a pagar'} onFechar={() => setAcao(null)} largura="max-w-2xl"><FormularioDeLancamento kind={kind} onPronto={() => setAcao(null)} /></Dialogo>}
      {acao?.tipo === 'editar' && <Dialogo titulo="Editar lançamento" onFechar={() => setAcao(null)} largura="max-w-2xl"><FormularioDeLancamento kind={kind} inicial={acao.l} onPronto={() => setAcao(null)} /></Dialogo>}
      {acao?.tipo === 'baixar' && <Dialogo titulo={receita ? 'Registrar recebimento' : 'Registrar pagamento'} onFechar={() => setAcao(null)}><FormularioDeBaixa l={acao.l} receita={receita} onPronto={() => setAcao(null)} /></Dialogo>}
      {(acao?.tipo === 'estornar' || acao?.tipo === 'cancelar') && <Dialogo titulo={acao.tipo === 'estornar' ? 'Estornar baixa' : 'Cancelar lançamento'} onFechar={() => setAcao(null)}><FormularioDeMotivo tipo={acao.tipo} l={acao.l} onPronto={() => setAcao(null)} /></Dialogo>}
    </div>
  );
}

function FormularioDeBaixa({ l, receita, onPronto }: { l: LancamentoWire; receita: boolean; onPronto: () => void }) {
  const contas = useContas();
  const baixar = useBaixar();
  const ativas = (contas.data?.items ?? []).filter((c) => c.active);
  const [contaId, setContaId] = useState(l.accountId ?? '');
  const [dia, setDia] = useState(hojeIso());
  const [pago, setPago] = useState<number | null>(l.amountCents);
  const [erro, setErro] = useState<string | null>(null);
  const escolhida = contaId || ativas[0]?.id || '';
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!escolhida) return setErro('Cadastre uma conta antes (aba Contas).');
    if (pago === null || pago <= 0) return setErro('Informe o valor efetivamente pago.');
    setErro(null);
    baixar.mutate({ id: l.id, accountId: escolhida, paidOn: dia, ...(pago !== l.amountCents && { paidAmountCents: pago }) }, { onSuccess: () => { toast(receita ? 'Recebimento registrado.' : 'Pagamento registrado.', 'success'); onPronto(); }, onError: (x) => setErro(mensagemDeErro(x)) });
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      <p className="text-sm text-nevoa">{l.description} · previsto <strong className="text-branco-cru">{formatarCentavos(l.amountCents)}</strong></p>
      {!contas.isPending && ativas.length === 0 && <Aviso tom="aviso">Não há conta cadastrada. Crie uma na aba Contas para registrar a movimentação.</Aviso>}
      <Campo rotulo="Conta">{(p) => <select {...p} value={escolhida} onChange={(e) => setContaId(e.target.value)} className={CAMPO}>{ativas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
      <Campo rotulo={receita ? 'Data do recebimento' : 'Data do pagamento'}>{(p) => <input {...p} type="date" required value={dia} onChange={(e) => setDia(e.target.value)} className={CAMPO} />}</Campo>
      <CampoDinheiro rotulo={receita ? 'Valor recebido' : 'Valor pago'} centavos={l.amountCents} onChange={setPago} obrigatorio ajuda="Pode diferir do previsto (juros ou desconto). O valor previsto fica guardado." />
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onPronto} className={BOTAO_SECUNDARIO}>Voltar</button><button type="submit" disabled={baixar.isPending || !escolhida} className={BOTAO}>{baixar.isPending ? 'Registrando…' : 'Confirmar'}</button></div>
    </form>
  );
}

function FormularioDeMotivo({ tipo, l, onPronto }: { tipo: 'estornar' | 'cancelar'; l: LancamentoWire; onPronto: () => void }) {
  const estornar = useEstornar();
  const cancelar = useCancelar();
  const m = tipo === 'estornar' ? estornar : cancelar;
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!motivo.trim()) return setErro('Diga o motivo: ele fica no histórico.');
    setErro(null);
    m.mutate({ id: l.id, motivo: motivo.trim() }, { onSuccess: () => { toast(tipo === 'estornar' ? 'Baixa estornada. O lançamento voltou a ficar em aberto.' : 'Lançamento cancelado.', 'success'); onPronto(); }, onError: (x) => setErro(mensagemDeErro(x)) });
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      <p className="text-sm text-nevoa">{l.description} · <strong className="text-branco-cru">{formatarCentavos(l.amountCents)}</strong></p>
      <Aviso tom="info">{tipo === 'estornar' ? 'O estorno não apaga a baixa: o razão guarda os dois movimentos e o lançamento volta a ficar em aberto.' : 'O lançamento fica no histórico como cancelado e sai dos totais de receita e despesa.'}</Aviso>
      <Campo rotulo="Motivo">{(p) => <textarea {...p} required rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} />}</Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onPronto} className={BOTAO_SECUNDARIO}>Voltar</button><button type="submit" disabled={m.isPending} className={tipo === 'cancelar' ? BOTAO_PERIGO : BOTAO}>{m.isPending ? 'Salvando…' : tipo === 'estornar' ? 'Estornar baixa' : 'Cancelar lançamento'}</button></div>
    </form>
  );
}
