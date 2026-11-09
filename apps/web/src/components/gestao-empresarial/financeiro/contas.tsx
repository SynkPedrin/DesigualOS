'use client';

import { useState } from 'react';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { toast } from '@/stores/toast-store';
import { useContas, useCriarConta, useTransferir, type ContaWire } from '@/hooks/use-gestao-financeiro';
import { formatarCentavos, hojeIso } from '@/lib/gestao-empresarial/formato';
import { Aviso, BOTAO, BOTAO_SECUNDARIO, Campo, CampoDinheiro, CAMPO, Carregando, Dialogo, Dinheiro, mensagemDeErro, Selo, TD, TH, TH_DIREITA, Tabela, Vazio } from '../kit';

const TIPOS = [{ v: 'banco', r: 'Banco' }, { v: 'caixa', r: 'Caixa' }, { v: 'carteira', r: 'Carteira' }, { v: 'cartao', r: 'Cartão' }];

export function Contas() {
  const { data, isPending, isError, refetch } = useContas();
  const [dialogo, setDialogo] = useState<'conta' | 'transferencia' | null>(null);
  const contas = data?.items ?? [];
  const semSaldo = contas.filter((c) => c.balanceCents === null && c.active).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-nevoa">O saldo é o saldo inicial mais tudo o que o razão registrou na conta. Conta sem saldo inicial informado mostra “—”: o sistema não presume zero.</p>
        <div className="flex gap-2">
          <button type="button" disabled={contas.filter((c) => c.active).length < 2} onClick={() => setDialogo('transferencia')} className={BOTAO_SECUNDARIO}><ArrowRightLeft size={16} aria-hidden />Transferir</button>
          <button type="button" onClick={() => setDialogo('conta')} className={BOTAO}><Plus size={16} aria-hidden />Nova conta</button>
        </div>
      </div>
      {semSaldo > 0 && <Aviso tom="aviso">{semSaldo} {semSaldo === 1 ? 'conta está sem saldo inicial' : 'contas estão sem saldo inicial'}. Os saldos e o fluxo de caixa ficam incompletos até você informar o saldo de abertura.</Aviso>}
      {isPending ? <Carregando linhas={3} /> : isError ? <InlineSectionError message="Não conseguimos carregar as contas." onRetry={() => void refetch()} /> : contas.length === 0 ? (
        <Vazio titulo="Nenhuma conta cadastrada">Crie a primeira conta (banco, caixa…) para registrar recebimentos e pagamentos.</Vazio>
      ) : (
        <Tabela legenda="Contas financeiras e saldos">
          <thead><tr className="border-b border-grafite-elevado"><th className={TH}>Conta</th><th className={TH}>Tipo</th><th className={TH_DIREITA}>Saldo inicial</th><th className={TH_DIREITA}>Movimento</th><th className={TH_DIREITA}>Saldo</th></tr></thead>
          <tbody>{contas.map((c) => <Linha key={c.id} c={c} />)}</tbody>
        </Tabela>
      )}
      {dialogo === 'conta' && <Dialogo titulo="Nova conta" onFechar={() => setDialogo(null)}><FormularioDeConta onPronto={() => setDialogo(null)} /></Dialogo>}
      {dialogo === 'transferencia' && <Dialogo titulo="Transferir entre contas" onFechar={() => setDialogo(null)}><FormularioDeTransferencia contas={contas.filter((c) => c.active)} onPronto={() => setDialogo(null)} /></Dialogo>}
    </div>
  );
}

function Linha({ c }: { c: ContaWire }) {
  return (
    <tr className="border-t border-grafite-elevado/60">
      <td className={TD}>{c.name} {!c.active && <Selo>Inativa</Selo>}</td>
      <td className={`${TD} text-nevoa`}>{TIPOS.find((t) => t.v === c.kind)?.r ?? c.kind}</td>
      <td className={`${TD} text-right`}><Dinheiro centavos={c.openingBalanceCents} /></td>
      <td className={`${TD} text-right`}><Dinheiro centavos={c.movementCents} /></td>
      <td className={`${TD} text-right font-medium`}>{c.balanceCents === null ? <span title="Informe o saldo inicial para calcular" className="text-nevoa">—</span> : <Dinheiro centavos={c.balanceCents} />}</td>
    </tr>
  );
}

function FormularioDeConta({ onPronto }: { onPronto: () => void }) {
  const criar = useCriarConta();
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('banco');
  const [saldo, setSaldo] = useState<number | null>(null);
  const [data, setData] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (saldo !== null && !data) return setErro('Informe a data do saldo inicial.');
    setErro(null);
    criar.mutate({ name: nome.trim(), kind: tipo, openingBalanceCents: saldo, openingDate: saldo === null ? null : data }, { onSuccess: () => { toast('Conta criada.', 'success'); onPronto(); }, onError: (x) => setErro(mensagemDeErro(x)) });
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      <Campo rotulo="Nome">{(p) => <input {...p} required maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />}</Campo>
      <Campo rotulo="Tipo">{(p) => <select {...p} value={tipo} onChange={(e) => setTipo(e.target.value)} className={CAMPO}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select>}</Campo>
      <CampoDinheiro rotulo="Saldo inicial (opcional)" centavos={null} onChange={setSaldo} ajuda="Deixe em branco se não souber: o saldo ficará “—” em vez de R$ 0,00." />
      {saldo !== null && <Campo rotulo="Data do saldo inicial">{(p) => <input {...p} type="date" required value={data} onChange={(e) => setData(e.target.value)} className={CAMPO} />}</Campo>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onPronto} className={BOTAO_SECUNDARIO}>Voltar</button><button type="submit" disabled={criar.isPending} className={BOTAO}>{criar.isPending ? 'Criando…' : 'Criar conta'}</button></div>
    </form>
  );
}

function FormularioDeTransferencia({ contas, onPronto }: { contas: ContaWire[]; onPronto: () => void }) {
  const transferir = useTransferir();
  const [de, setDe] = useState(contas[0]?.id ?? '');
  const [para, setPara] = useState(contas[1]?.id ?? '');
  const [valor, setValor] = useState<number | null>(null);
  const [dia, setDia] = useState(hojeIso());
  const [memo, setMemo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (valor === null || valor <= 0) return setErro('Informe um valor maior que zero.');
    if (de === para) return setErro('A origem e o destino precisam ser contas diferentes.');
    setErro(null);
    transferir.mutate({ fromAccountId: de, toAccountId: para, amountCents: valor, occurredOn: dia, ...(memo.trim() && { memo: memo.trim() }) }, { onSuccess: () => { toast(`Transferência de ${formatarCentavos(valor)} registrada.`, 'success'); onPronto(); }, onError: (x) => setErro(mensagemDeErro(x)) });
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Sai da conta">{(p) => <select {...p} value={de} onChange={(e) => setDe(e.target.value)} className={CAMPO}>{contas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
        <Campo rotulo="Entra na conta">{(p) => <select {...p} value={para} onChange={(e) => setPara(e.target.value)} className={CAMPO}>{contas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoDinheiro rotulo="Valor" centavos={null} onChange={setValor} obrigatorio />
        <Campo rotulo="Data">{(p) => <input {...p} type="date" required value={dia} onChange={(e) => setDia(e.target.value)} className={CAMPO} />}</Campo>
      </div>
      <Campo rotulo="Observação (opcional)">{(p) => <input {...p} maxLength={300} value={memo} onChange={(e) => setMemo(e.target.value)} className={CAMPO} />}</Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onPronto} className={BOTAO_SECUNDARIO}>Voltar</button><button type="submit" disabled={transferir.isPending} className={BOTAO}>{transferir.isPending ? 'Transferindo…' : 'Transferir'}</button></div>
    </form>
  );
}
