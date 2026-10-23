'use client';

import { useState } from 'react';
import { toast } from '@/stores/toast-store';
import { useCategorias, useCentros, useContas, useCriarLancamento, useEditarLancamento, usePessoas, type Kind, type LancamentoWire } from '@/hooks/use-gestao-financeiro';
import { formatarCentavos } from '@/lib/gestao-empresarial/formato';
import { Aviso, BOTAO, BOTAO_SECUNDARIO, Campo, CampoDinheiro, CAMPO, mensagemDeErro } from '../kit';

/** Busca um cadastro por nome ou documento e deixa escolher; vazio = sem cadastro (fica só o texto da descrição). */
export function SeletorDePessoa({ valor, onChange, rotulo = 'Cadastro (opcional)' }: { valor: string | null; onChange: (id: string | null) => void; rotulo?: string }) {
  const [busca, setBusca] = useState('');
  const { data } = usePessoas(busca);
  const itens = data?.items ?? [];
  return (
    <div className="space-y-1">
      <Campo rotulo={`${rotulo}: buscar`}>{(p) => <input {...p} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, e-mail ou documento" className={CAMPO} />}</Campo>
      <Campo rotulo={rotulo}>{(p) => (
        <select {...p} value={valor ?? ''} onChange={(e) => onChange(e.target.value || null)} className={CAMPO}>
          <option value="">Sem cadastro</option>
          {valor && !itens.some((i) => i.id === valor) && <option value={valor}>Selecionado</option>}
          {itens.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      )}</Campo>
    </div>
  );
}

export function FormularioDeLancamento({ kind, inicial, onPronto }: { kind: Kind; inicial?: LancamentoWire; onPronto: () => void }) {
  const edicao = !!inicial;
  const criar = useCriarLancamento();
  const editar = useEditarLancamento();
  const categorias = useCategorias();
  const centros = useCentros();
  const contas = useContas();
  const [descricao, setDescricao] = useState(inicial?.description ?? '');
  const [valor, setValor] = useState<number | null>(inicial?.amountCents ?? null);
  const [vencimento, setVencimento] = useState(inicial?.dueDate ?? '');
  const [competencia, setCompetencia] = useState(inicial?.competenceDate ?? '');
  const [parcelas, setParcelas] = useState(1);
  const [pessoa, setPessoa] = useState<string | null>(inicial?.partyId ?? null);
  const [categoria, setCategoria] = useState(inicial?.categoryId ?? '');
  const [centro, setCentro] = useState(inicial?.costCenterId ?? '');
  const [conta, setConta] = useState(inicial?.accountId ?? '');
  const [documento, setDocumento] = useState(inicial?.docNumber ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const cats = (categorias.data?.items ?? []).filter((c) => c.kind === kind && c.active);
  const pendente = criar.isPending || editar.isPending;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (valor === null || valor <= 0) return setErro('Informe um valor maior que zero.');
    setErro(null);
    const comum = { description: descricao.trim(), amountCents: valor, dueDate: vencimento, competenceDate: competencia || null, partyId: pessoa, categoryId: categoria || null, costCenterId: centro || null, accountId: conta || null, docNumber: documento.trim() || null };
    const ok = () => { toast(edicao ? 'Lançamento atualizado.' : parcelas > 1 ? `${parcelas} parcelas lançadas.` : 'Lançamento criado.', 'success'); onPronto(); };
    const falha = (x: unknown) => setErro(mensagemDeErro(x));
    if (inicial) editar.mutate({ id: inicial.id, corpo: comum }, { onSuccess: ok, onError: falha });
    else criar.mutate({ kind, ...comum, ...(parcelas > 1 && { parcelas }) }, { onSuccess: ok, onError: falha });
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      {inicial && inicial.installmentNo && <Aviso tom="info">Esta é a parcela {inicial.installmentNo}/{inicial.installmentTotal}. A edição vale só para ela.</Aviso>}
      <Campo rotulo="Descrição">{(p) => <input {...p} required maxLength={300} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={CAMPO} />}</Campo>
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoDinheiro rotulo={edicao || parcelas === 1 ? 'Valor' : 'Valor total'} centavos={inicial?.amountCents ?? null} onChange={setValor} obrigatorio />
        <Campo rotulo={parcelas > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'}>{(p) => <input {...p} type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={CAMPO} />}</Campo>
        <Campo rotulo="Competência (opcional)">{(p) => <input {...p} type="date" value={competencia} onChange={(e) => setCompetencia(e.target.value)} className={CAMPO} />}</Campo>
      </div>
      {!edicao && (
        <Campo rotulo="Parcelas" ajuda={valor && parcelas > 1 ? `Divide ${formatarCentavos(valor)} em ${parcelas} parcelas mensais que somam exatamente o total.` : 'Uma parcela = lançamento único.'}>
          {(p) => <input {...p} type="number" min={1} max={120} value={parcelas} onChange={(e) => setParcelas(Math.min(120, Math.max(1, Number(e.target.value) || 1)))} className={`${CAMPO} sm:w-32`} />}
        </Campo>
      )}
      <SeletorDePessoa valor={pessoa} onChange={setPessoa} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Categoria">{(p) => <select {...p} value={categoria} onChange={(e) => setCategoria(e.target.value)} className={CAMPO}><option value="">Sem categoria</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
        <Campo rotulo="Centro de custo">{(p) => <select {...p} value={centro} onChange={(e) => setCentro(e.target.value)} className={CAMPO}><option value="">Nenhum</option>{(centros.data?.items ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
        <Campo rotulo="Conta prevista">{(p) => <select {...p} value={conta} onChange={(e) => setConta(e.target.value)} className={CAMPO}><option value="">Definir ao baixar</option>{(contas.data?.items ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
      </div>
      <Campo rotulo="Número do documento (opcional)">{(p) => <input {...p} maxLength={60} value={documento} onChange={(e) => setDocumento(e.target.value)} className={CAMPO} />}</Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onPronto} className={BOTAO_SECUNDARIO}>Voltar</button><button type="submit" disabled={pendente} className={BOTAO}>{pendente ? 'Salvando…' : edicao ? 'Salvar' : 'Lançar'}</button></div>
    </form>
  );
}
