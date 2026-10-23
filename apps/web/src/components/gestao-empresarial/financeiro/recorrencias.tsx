'use client';

import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { toast } from '@/stores/toast-store';
import { useCategorias, useCriarRecorrencia, useGerarRecorrencias, useRecorrencias, type Kind } from '@/hooks/use-gestao-financeiro';
import { formatarDia, hojeIso } from '@/lib/gestao-empresarial/formato';
import { Aviso, BOTAO, BOTAO_SECUNDARIO, Campo, CampoDinheiro, CAMPO, Carregando, Dialogo, Dinheiro, mensagemDeErro, Selo, TD, TH, TH_DIREITA, Tabela, Vazio } from '../kit';

const FREQ: Record<string, string> = { semanal: 'Semanal', mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };

export function Recorrencias() {
  const { data, isPending, isError, refetch } = useRecorrencias();
  const gerar = useGerarRecorrencias();
  const [novo, setNovo] = useState(false);
  const [ate, setAte] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  function gerarAgora() {
    if (!ate) return setErro('Escolha até que data gerar os lançamentos.');
    setErro(null);
    gerar.mutate({ ate }, { onSuccess: (r) => toast(r.criados === 0 ? 'Nada novo a gerar: tudo até essa data já existe.' : `${r.criados} ${r.criados === 1 ? 'lançamento gerado' : 'lançamentos gerados'}.`, 'success'), onError: (x) => setErro(mensagemDeErro(x)) });
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44"><Campo rotulo="Gerar lançamentos até">{(p) => <input {...p} type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={CAMPO} />}</Campo></div>
          <button type="button" disabled={gerar.isPending} onClick={gerarAgora} className={BOTAO_SECUNDARIO}><RefreshCw size={16} aria-hidden />{gerar.isPending ? 'Gerando…' : 'Gerar'}</button>
        </div>
        <button type="button" onClick={() => setNovo(true)} className={BOTAO}><Plus size={16} aria-hidden />Nova recorrência</button>
      </div>
      <p className="text-sm text-nevoa">Gerar é seguro repetir: o que já foi criado não duplica. Os lançamentos gerados aparecem em A receber ou A pagar, em aberto.</p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {isPending ? <Carregando linhas={3} /> : isError ? <InlineSectionError message="Não conseguimos carregar as recorrências." onRetry={() => void refetch()} /> : data.items.length === 0 ? (
        <Vazio titulo="Nenhuma recorrência">Cadastre aluguel, mensalidades e outros valores que se repetem para gerá-los de uma vez.</Vazio>
      ) : (
        <Tabela legenda="Recorrências">
          <thead><tr className="border-b border-grafite-elevado"><th className={TH}>Descrição</th><th className={TH}>Tipo</th><th className={TH}>Frequência</th><th className={TH_DIREITA}>Valor</th><th className={TH}>Início</th><th className={TH}>Gerado até</th></tr></thead>
          <tbody>{data.items.map((r) => (
            <tr key={r.id} className="border-t border-grafite-elevado/60">
              <td className={TD}>{r.description} {!r.active && <Selo>Inativa</Selo>}</td>
              <td className={TD}><Selo classe={r.kind === 'receita' ? 'bg-sucesso/15 text-sucesso' : 'bg-grafite-elevado text-nevoa'}>{r.kind === 'receita' ? 'Receita' : 'Despesa'}</Selo></td>
              <td className={`${TD} text-nevoa`}>{FREQ[r.frequency] ?? r.frequency}</td>
              <td className={`${TD} text-right`}><Dinheiro centavos={r.amountCents} /></td>
              <td className={`${TD} tabular-nums`}>{formatarDia(r.startDate)}</td>
              <td className={`${TD} tabular-nums text-nevoa`}>{r.generatedUntil ? formatarDia(r.generatedUntil) : 'ainda não gerou'}</td>
            </tr>
          ))}</tbody>
        </Tabela>
      )}
      {novo && <Dialogo titulo="Nova recorrência" onFechar={() => setNovo(false)} largura="max-w-xl"><FormularioDeRecorrencia onPronto={() => setNovo(false)} /></Dialogo>}
    </div>
  );
}

function FormularioDeRecorrencia({ onPronto }: { onPronto: () => void }) {
  const criar = useCriarRecorrencia();
  const categorias = useCategorias();
  const [kind, setKind] = useState<Kind>('despesa');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState<number | null>(null);
  const [freq, setFreq] = useState('mensal');
  const [inicio, setInicio] = useState(hojeIso());
  const [fim, setFim] = useState('');
  const [categoria, setCategoria] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (valor === null || valor <= 0) return setErro('Informe um valor maior que zero.');
    setErro(null);
    criar.mutate({ kind, description: descricao.trim(), amountCents: valor, frequency: freq, startDate: inicio, endDate: fim || null, categoryId: categoria || null }, { onSuccess: () => { toast('Recorrência criada. Use “Gerar” para criar os lançamentos.', 'success'); onPronto(); }, onError: (x) => setErro(mensagemDeErro(x)) });
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Tipo">{(p) => <select {...p} value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={CAMPO}><option value="despesa">Despesa (a pagar)</option><option value="receita">Receita (a receber)</option></select>}</Campo>
        <Campo rotulo="Frequência">{(p) => <select {...p} value={freq} onChange={(e) => setFreq(e.target.value)} className={CAMPO}>{Object.entries(FREQ).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>}</Campo>
      </div>
      <Campo rotulo="Descrição">{(p) => <input {...p} required maxLength={300} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={CAMPO} />}</Campo>
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoDinheiro rotulo="Valor de cada ocorrência" centavos={null} onChange={setValor} obrigatorio />
        <Campo rotulo="Primeiro vencimento">{(p) => <input {...p} type="date" required value={inicio} onChange={(e) => setInicio(e.target.value)} className={CAMPO} />}</Campo>
        <Campo rotulo="Termina em (opcional)">{(p) => <input {...p} type="date" value={fim} onChange={(e) => setFim(e.target.value)} className={CAMPO} />}</Campo>
      </div>
      <Campo rotulo="Categoria (opcional)">{(p) => <select {...p} value={categoria} onChange={(e) => setCategoria(e.target.value)} className={CAMPO}><option value="">Sem categoria</option>{(categorias.data?.items ?? []).filter((c) => c.kind === kind && c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onPronto} className={BOTAO_SECUNDARIO}>Voltar</button><button type="submit" disabled={criar.isPending} className={BOTAO}>{criar.isPending ? 'Criando…' : 'Criar'}</button></div>
    </form>
  );
}
