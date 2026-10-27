'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ExternalLink, Plus, X } from 'lucide-react';
import { useClients } from '@/hooks/use-clients';
import { useClientWorkspace } from '@/hooks/use-client-workspace';
import { useCreateClickUpTask } from '@/hooks/use-create-clickup-task';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const PRIORIDADES = [
  { valor: 3, rotulo: 'Normal' },
  { valor: 2, rotulo: 'Alta' },
  { valor: 1, rotulo: 'Urgente' },
  { valor: 4, rotulo: 'Baixa' },
] as const;

/** Data escolhida (AAAA-MM-DD) como instante ao meio-dia local: prazo é dia, e meio-dia não escorrega de dia no fuso. */
export function prazoDoDia(dia: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return undefined;
  return new Date(`${dia}T12:00:00`).getTime();
}

function hojeMaisDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const campo = 'w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico focus:outline-none';

function Dialogo({ aoFechar, clienteInicial }: { aoFechar: () => void; clienteInicial?: string | undefined }) {
  const clientes = useClients();
  const criar = useCreateClickUpTask();
  const [clienteId, setClienteId] = useState(clienteInicial ?? '');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [dia, setDia] = useState(hojeMaisDias(0));
  const [prioridade, setPrioridade] = useState<1 | 2 | 3 | 4>(3);
  const tituloRef = useRef<HTMLInputElement>(null);
  const workspace = useClientWorkspace(clienteId || null);
  const listId = workspace.data?.client.clickupListId ?? null;

  useEffect(() => {
    tituloRef.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  const opcoes = useMemo(
    () => (clientes.data ?? []).filter((c) => c.natureza !== 'FIXTURE').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [clientes.data],
  );

  const semLista = Boolean(clienteId) && workspace.isSuccess && !listId;
  const podeEnviar = Boolean(listId) && titulo.trim().length > 0 && !criar.isPending;
  const erro = criar.error instanceof ApiRequestError ? criar.error.message : criar.error ? 'Não consegui criar a tarefa. Tente de novo.' : null;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!podeEnviar || !listId) return;
    const prazo = prazoDoDia(dia);
    criar.mutate({
      listId,
      name: titulo.trim(),
      ...(descricao.trim() ? { description: descricao.trim() } : {}),
      priority: prioridade,
      ...(prazo ? { dueDate: prazo } : {}),
    });
  }

  function criarOutra() {
    criar.reset();
    setTitulo('');
    setDescricao('');
    tituloRef.current?.focus();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-carbono/80 p-4" role="dialog" aria-modal="true" aria-label="Nova tarefa" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Nova tarefa</h2>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="rounded p-1 text-nevoa hover:text-branco-cru"><X size={16} /></button>
        </div>

        {criar.isSuccess ? (
          <div className="mt-5 space-y-4">
            <p className="flex items-center gap-2 text-sm text-sucesso"><CheckCircle2 size={16} />Tarefa criada no ClickUp{criar.data.assigned ? ' e atribuída a você' : ''}.</p>
            <div className="flex flex-wrap justify-end gap-2">
              {criar.data.url && (
                <a href={criar.data.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">
                  Abrir no ClickUp <ExternalLink size={13} />
                </a>
              )}
              <button type="button" onClick={criarOutra} className="rounded-md border border-grafite-elevado px-3 py-2 text-sm text-branco-cru hover:bg-grafite-elevado">Criar outra</button>
              <button type="button" onClick={aoFechar} className="rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-medium text-white hover:opacity-90">Pronto</button>
            </div>
          </div>
        ) : (
          <form onSubmit={enviar} className="mt-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-nevoa">Cliente</span>
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={campo} aria-label="Cliente">
                <option value="">{clientes.isPending ? 'Carregando clientes…' : 'Escolha o cliente'}</option>
                {opcoes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {clienteId && workspace.isPending && <span className="text-xs text-nevoa">Procurando a lista do ClickUp…</span>}
              {semLista && <span className="text-xs text-aviso">Este cliente não tem lista do ClickUp vinculada. Vincule em Integrações para criar tarefas nele.</span>}
              {clienteId && workspace.isError && <span className="text-xs text-erro">Não consegui ler a lista deste cliente.</span>}
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-nevoa">O que precisa ser feito</span>
              <input ref={tituloRef} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Criar 3 artes do dia das crianças" maxLength={200} className={campo} aria-label="Título da tarefa" />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-nevoa">Detalhes (opcional)</span>
              <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} className={campo} aria-label="Detalhes" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-nevoa">Prazo</span>
                <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className={campo} aria-label="Prazo" />
                <div className="flex gap-1.5">
                  {([['Hoje', 0], ['Amanhã', 1]] as const).map(([rotulo, n]) => (
                    <button key={rotulo} type="button" onClick={() => setDia(hojeMaisDias(n))} className={cn('whitespace-nowrap rounded border px-2 py-0.5 text-[11px]', dia === hojeMaisDias(n) ? 'border-sinal text-sinal' : 'border-grafite-elevado text-nevoa hover:text-branco-cru')}>{rotulo}</button>
                  ))}
                  <button type="button" onClick={() => setDia('')} className={cn('whitespace-nowrap rounded border px-2 py-0.5 text-[11px]', dia === '' ? 'border-sinal text-sinal' : 'border-grafite-elevado text-nevoa hover:text-branco-cru')}>Sem prazo</button>
                </div>
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-nevoa">Prioridade</span>
                <select value={prioridade} onChange={(e) => setPrioridade(Number(e.target.value) as 1 | 2 | 3 | 4)} className={campo} aria-label="Prioridade">
                  {PRIORIDADES.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                </select>
              </label>
            </div>

            {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={aoFechar} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
              <button type="submit" disabled={!podeEnviar} className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                {criar.isPending ? 'Criando…' : 'Criar tarefa'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Botão + diálogo para criar tarefa no ClickUp do cliente, direto da tela de Tarefas ou do Hoje. */
export function BotaoNovaTarefa({ className }: { className?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={cn('inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-medium text-white transition-all hover:opacity-90 hover:shadow-glow', className)}>
        <Plus size={15} />Nova tarefa
      </button>
      {aberto && typeof document !== 'undefined' && createPortal(<Dialogo aoFechar={() => setAberto(false)} />, document.body)}
    </>
  );
}
