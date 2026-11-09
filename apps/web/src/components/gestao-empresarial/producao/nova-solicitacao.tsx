'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useProducaoAcoes } from '@/hooks/use-gestao-producao';
import type { PessoaResumoWire } from '@/hooks/use-gestao-comercial';
import { toast } from '@/stores/toast-store';
import { Campo, CAMPO, BOTAO, BOTAO_SECUNDARIO, Dialogo, mensagemDeErro } from '../kit';
import { SeletorDePessoa } from '../comercial/seletor-de-pessoa';

export function NovaSolicitacao({ onFechar }: { onFechar: () => void }) {
  const router = useRouter();
  const { criarSolicitacao } = useProducaoAcoes();
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [prazo, setPrazo] = useState('');
  const [cliente, setCliente] = useState<PessoaResumoWire | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialogo titulo="Nova solicitação de produção" onFechar={onFechar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErro(null); criarSolicitacao.mutate({ title: titulo.trim(), partyId: cliente?.id ?? null, description: descricao.trim() || null, dueOn: prazo || null }, { onSuccess: (s) => { toast(`Solicitação ${s.number} criada.`, 'success'); onFechar(); router.push(`/gestao-empresarial/producao/solicitacoes/${s.id}`); }, onError: (er) => setErro(mensagemDeErro(er, 'Não foi possível criar.')) }); }}>
        <Campo rotulo="O que precisa ser produzido *">{(p) => <input {...p} required maxLength={300} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={CAMPO} />}</Campo>
        <Campo rotulo="Detalhes">{(p) => <textarea {...p} rows={3} maxLength={4000} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={CAMPO} />}</Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <SeletorDePessoa rotulo="Cliente" papel="cliente" valor={cliente} onChange={setCliente} />
          <Campo rotulo="Prazo">{(p) => <input {...p} type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={CAMPO} />}</Campo>
        </div>
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button><button type="submit" disabled={criarSolicitacao.isPending || !titulo.trim()} className={BOTAO}>{criarSolicitacao.isPending ? 'Criando…' : 'Criar solicitação'}</button></div>
      </form>
    </Dialogo>
  );
}
