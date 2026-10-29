'use client';

import { useRef, useState } from 'react';
import { CampoDeData } from './calendario';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useClients } from '@/hooks/use-clients';
import { useWorkMembers, useWorkTree } from '@/hooks/use-work';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import { toast } from '@/stores/toast-store';

const campo = 'w-full rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none';

/**
 * Criar tarefa do Daily Tasks a partir de uma mensagem da Comunicação. O par (mensagem → tarefa) é idempotente no
 * servidor: clicar duas vezes devolve a MESMA tarefa. A tarefa guarda de onde veio (conversa e mensagem).
 */
export function CriarTarefaDaily({ conversationId, messageId, senderName, texto, anexos = [], onClose }: { conversationId: string; messageId?: string | undefined; senderName: string | null; texto: string; anexos?: Array<{ id: string; filename: string }>; onClose: () => void }) {
  // Sem mensagem (rascunho do campo de escrever): a chave é desta abertura, então clicar duas vezes não duplica.
  const chaveRascunho = useRef(`rascunho:${crypto.randomUUID()}`);
  const [levar, setLevar] = useState(true);
  const arvore = useWorkTree().data?.spaces ?? [];
  const membros = useWorkMembers().data?.members ?? [];
  const clientes = useClients().data ?? [];
  const qc = useQueryClient();
  const primeira = texto.split('\n')[0]!.replace(/[*_`~]/g, '').replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '@$1').slice(0, 120);
  const [titulo, setTitulo] = useState(primeira);
  const [listId, setListId] = useState('');
  const [cliente, setCliente] = useState('');
  const [resp, setResp] = useState('');
  const [prazo, setPrazo] = useState('');
  const [prio, setPrio] = useState('3');
  const criar = useMutation({
    mutationFn: () => apiFetch<{ task: { key: string; id: string }; created: boolean }>('/work/tasks/from-source', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'communication', externalType: messageId ? 'message' : 'draft', externalId: messageId ?? chaveRascunho.current, listId, title: titulo.trim(),
        description: messageId ? `Origem: mensagem de ${senderName ?? 'alguém'} na Comunicação.\n\n> ${texto.slice(0, 1500)}\n\nAbrir a conversa: /comunicacao?c=${conversationId}&m=${messageId}` : `Criada na Comunicação.\n\nConversa: /comunicacao?c=${conversationId}`,
        ...(levar && anexos.length ? { chatAttachmentIds: anexos.map((a) => a.id) } : {}),
        ...(cliente ? { clientId: cliente } : {}), priority: Number(prio), ...(resp ? { assigneeIds: [resp] } : {}), ...(prazo ? { dueAt: new Date(`${prazo}T18:00:00`).toISOString() } : {}),
        meta: { conversationId },
      }),
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['work'] }); toast(r.created ? `Tarefa ${r.task.key} criada no Daily Tasks.` : `Essa mensagem já virou a tarefa ${r.task.key}.`, 'success'); onClose(); },
    onError: (e) => toast(e instanceof ApiRequestError ? e.message : 'Não foi possível criar a tarefa.', 'error'),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
      {messageId && <blockquote className="rounded-md border-l-2 border-nevoa/40 bg-grafite-elevado/40 px-3 py-2 text-xs text-nevoa"><span className="font-semibold">{senderName ?? 'Alguém'}:</span> {texto.slice(0, 300) || 'mensagem com anexo'}</blockquote>}
      {anexos.length > 0 && <label className="flex items-center gap-2 text-xs text-nevoa"><input type="checkbox" checked={levar} onChange={(e) => setLevar(e.target.checked)} /> Levar {anexos.length === 1 ? 'o arquivo' : `os ${anexos.length} arquivos`} da mensagem para a tarefa ({anexos.map((a) => a.filename).join(', ').slice(0, 80)})</label>}
      <label className="block text-xs text-nevoa">Título<input autoFocus required minLength={3} maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={`${campo} mt-1`} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-nevoa">Lista do Daily Tasks
          <select required value={listId} onChange={(e) => setListId(e.target.value)} className={`${campo} mt-1`} aria-label="Lista do Daily Tasks"><option value="">Escolha…</option>{arvore.map((s) => <optgroup key={s.id} label={s.name}>{s.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}</select>
        </label>
        <label className="block text-xs text-nevoa">Cliente
          <select value={cliente} onChange={(e) => setCliente(e.target.value)} className={`${campo} mt-1`}><option value="">Sem cliente</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="block text-xs text-nevoa">Responsável
          <select value={resp} onChange={(e) => setResp(e.target.value)} className={`${campo} mt-1`}><option value="">Ninguém</option>{membros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </label>
        <div className="block text-xs text-nevoa">Prazo<span className={`${campo} mt-1 block`}><CampoDeData rotulo="Prazo" valor={prazo || null} onChange={(dia) => setPrazo(dia ?? '')} /></span></div>
        <label className="block text-xs text-nevoa">Prioridade
          <select value={prio} onChange={(e) => setPrio(e.target.value)} className={`${campo} mt-1`}><option value="1">Urgente</option><option value="2">Alta</option><option value="3">Normal</option><option value="4">Baixa</option></select>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
        <button type="submit" disabled={!listId || titulo.trim().length < 3 || criar.isPending} className="rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-medium text-branco-cru disabled:opacity-50">{criar.isPending ? 'Criando…' : 'Criar no Daily Tasks'}</button>
      </div>
    </form>
  );
}
