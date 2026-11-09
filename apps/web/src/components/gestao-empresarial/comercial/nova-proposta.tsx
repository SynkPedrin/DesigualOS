'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useComercialAcoes, type PessoaResumoWire } from '@/hooks/use-gestao-comercial';
import { toast } from '@/stores/toast-store';
import { Campo, CAMPO, BOTAO, BOTAO_SECUNDARIO, Dialogo, mensagemDeErro } from '../kit';
import { EditorDeItens, itensParaEnvio, type ItemEmEdicao } from './editor-de-itens';
import { SeletorDePessoa } from './seletor-de-pessoa';

export function NovaProposta({ onFechar }: { onFechar: () => void }) {
  const router = useRouter();
  const { criarProposta } = useComercialAcoes();
  const [titulo, setTitulo] = useState('');
  const [cliente, setCliente] = useState<PessoaResumoWire | null>(null);
  const [validade, setValidade] = useState('');
  const [itens, setItens] = useState<ItemEmEdicao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const pronto = itensParaEnvio(itens);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!pronto) return setErro('Complete os itens: descrição, quantidade, preço e desconto precisam estar válidos.');
    criarProposta.mutate(
      { title: titulo.trim(), partyId: cliente?.id ?? null, validUntil: validade || null, items: pronto },
      {
        onSuccess: (p) => { toast(`Proposta ${p.number} criada.`, 'success'); onFechar(); router.push(`/gestao-empresarial/comercial/propostas/${p.id}`); },
        onError: (er) => setErro(mensagemDeErro(er, 'Não foi possível criar a proposta.')),
      },
    );
  }

  return (
    <Dialogo titulo="Nova proposta" onFechar={onFechar} largura="max-w-3xl">
      <form onSubmit={enviar} className="space-y-4">
        <Campo rotulo="Título *">{(p) => <input {...p} required minLength={1} maxLength={300} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={CAMPO} />}</Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <SeletorDePessoa rotulo="Cliente" papel="cliente" valor={cliente} onChange={setCliente} />
          <Campo rotulo="Válida até">{(p) => <input {...p} type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className={CAMPO} />}</Campo>
        </div>
        <EditorDeItens itens={itens} onChange={setItens} />
        {erro && <p role="alert" className="text-sm text-red-500">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={criarProposta.isPending || !titulo.trim()} className={BOTAO}>{criarProposta.isPending ? 'Criando…' : 'Criar proposta'}</button>
        </div>
      </form>
    </Dialogo>
  );
}
