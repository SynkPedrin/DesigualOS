'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ExternalLink, LogOut, Pencil, UserPlus, X } from 'lucide-react';
import { useConversationActions, useConversationDetail, type ChatConversation } from '@/hooks/use-internal-chat';
import { InboxAvatar } from '@/components/inbox/inbox-avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/stores/toast-store';
import { AdicionarPessoas } from './modais';
import { cn } from '@/lib/utils';

const PRESENCA = { online: ['bg-sinal', 'online'], away: ['bg-aviso', 'ausente'], offline: ['bg-nevoa/30', 'offline'] } as const;

export function PainelDeDetalhes({ conversa, meId, onClose, onLeft }: { conversa: ChatConversation; meId: string; onClose: () => void; onLeft: () => void }) {
  const router = useRouter();
  const detalhe = useConversationDetail(conversa.id);
  const acoes = useConversationActions(conversa.id);
  const [adicionando, setAdicionando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saindo, setSaindo] = useState(false);
  const d = detalhe.data;
  const administravel = conversa.kind === 'channel' || conversa.kind === 'group';
  const podeEditar = d ? (conversa.kind === 'group' ? d.is_member : d.can_manage) : false;
  const erro = (e: Error) => toast(e.message, 'error');

  return (
    <aside aria-label="Detalhes da conversa" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-grafite-elevado px-4 py-2.5">
        <h2 className="font-heading text-sm font-semibold text-branco-cru">Detalhes</h2>
        <button type="button" onClick={onClose} aria-label="Fechar detalhes" className="text-nevoa hover:text-branco-cru"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {editando ? (
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            acoes.update.mutate(conversa.kind === 'channel' ? { name: nome, description: descricao } : { title: nome, description: descricao }, { onSuccess: () => setEditando(false), onError: erro });
          }}>
            <input aria-label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className="w-full rounded-md border border-grafite-elevado bg-carbono/40 px-2 py-1.5 text-sm text-branco-cru" />
            <textarea aria-label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} rows={2} className="w-full rounded-md border border-grafite-elevado bg-carbono/40 px-2 py-1.5 text-sm text-branco-cru" />
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditando(false)} className="text-xs text-nevoa">Cancelar</button><button type="submit" className="rounded-md bg-roxo-eletrico px-2 py-1 text-xs text-branco-cru">Salvar</button></div>
          </form>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-2">
              <p className="font-heading text-base font-semibold text-branco-cru">{conversa.kind === 'channel' ? `#${conversa.title}` : conversa.title}</p>
              {podeEditar && administravel && <button type="button" onClick={() => { setNome(d?.title ?? ''); setDescricao(d?.description ?? ''); setEditando(true); }} aria-label="Editar nome e descrição" className="text-nevoa hover:text-branco-cru"><Pencil size={14} /></button>}
            </div>
            {d?.description && <p className="mt-1 text-sm text-nevoa">{d.description}</p>}
            <p className="mt-1 font-mono text-[11px] text-nevoa">
              {conversa.kind === 'channel' ? (d?.visibility === 'private' ? 'Canal privado — só convidados' : 'Canal público — qualquer pessoa da equipe entra') : conversa.kind === 'group' ? 'Grupo privado — só participantes' : conversa.kind === 'discussion' ? 'Quem pode ver o item participa' : 'Conversa privada'}
            </p>
          </div>
        )}

        {conversa.kind === 'discussion' && d?.entity?.id && (
          <button type="button" onClick={() => router.push(d.entity!.type === 'client' ? `/clients/${d.entity!.id}` : '/demands')} className="inline-flex items-center gap-1 rounded-md bg-grafite-elevado px-2 py-1 text-xs text-branco-cru"><ExternalLink size={12} /> Abrir {d.entity.type === 'client' ? 'cliente' : 'quinzena'}</button>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-nevoa/70">Participantes · {d?.members.length ?? '…'}</p>
            {administravel && !d?.archived && (d?.is_member || d?.visibility === 'public') && (
              <button type="button" onClick={() => setAdicionando(true)} className="inline-flex items-center gap-1 text-xs text-roxo-eletrico hover:underline"><UserPlus size={12} /> Adicionar</button>
            )}
          </div>
          <ul className="space-y-1">
            {(d?.members ?? []).map((p) => {
              const [cor, rotulo] = PRESENCA[p.presence] ?? PRESENCA.offline;
              return (
                <li key={p.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-grafite-elevado/40">
                  <span className="relative"><InboxAvatar name={p.name} photoUrl={p.avatar_url} size="sm" /><span className={cn('absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-grafite', cor)} title={rotulo} /></span>
                  <span className="min-w-0 flex-1 truncate text-sm text-branco-cru">{p.name}{p.id === meId ? ' (você)' : ''}</span>
                  {p.role === 'owner' && <span className="font-mono text-[10px] text-nevoa">{conversa.kind === 'group' ? 'criou' : 'administra'}</span>}
                  {d?.can_manage && administravel && p.id !== meId && (
                    <button type="button" onClick={() => acoes.removeMember.mutate(p.id, { onError: erro, onSuccess: () => toast(`${p.name} saiu da conversa.`, 'info') })} aria-label={`Remover ${p.name}`} className="hidden text-nevoa hover:text-erro group-hover:block"><X size={13} /></button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-1 border-t border-grafite-elevado pt-3">
          {conversa.kind === 'channel' && d?.can_manage && (
            <button type="button" onClick={() => acoes.archive.mutate(!d.archived, { onError: erro, onSuccess: () => toast(d.archived ? 'Canal reativado.' : 'Canal arquivado.', 'info') })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-branco-cru hover:bg-grafite-elevado">
              {d.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {d.archived ? 'Reativar canal' : 'Arquivar canal'}
            </button>
          )}
          {(administravel || conversa.kind === 'discussion') && d?.is_member && (
            <button type="button" onClick={() => setSaindo(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-erro hover:bg-grafite-elevado"><LogOut size={14} /> Sair {conversa.kind === 'group' ? 'do grupo' : conversa.kind === 'discussion' ? 'da discussão' : 'do canal'}</button>
          )}
        </div>
      </div>
      {adicionando && d && <AdicionarPessoas conversationId={conversa.id} jaEstao={d.members.map((m) => m.id)} onClose={() => setAdicionando(false)} />}
      {saindo && (
        <ConfirmDialog
          title={`Sair ${conversa.kind === 'group' ? 'do grupo' : 'desta conversa'}?`}
          description={conversa.kind === 'channel' && d?.visibility === 'public' ? 'Você para de receber as mensagens e pode voltar quando quiser pela lista de canais.' : 'Você deixa de ver as mensagens. Para voltar, alguém precisa te adicionar de novo.'}
          confirmLabel="Sair"
          isPending={acoes.leave.isPending}
          onCancel={() => setSaindo(false)}
          onConfirm={() => acoes.leave.mutate(undefined, { onSuccess: () => { setSaindo(false); onLeft(); }, onError: (e) => { setSaindo(false); erro(e); } })}
        />
      )}
    </aside>
  );
}
