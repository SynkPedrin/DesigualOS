'use client';

import { useState } from 'react';
import { Download, Loader2, MessageSquareText, Search, X } from 'lucide-react';
import { useChatFiles, type ChatAttachment } from '@/hooks/use-internal-chat';
import { IconeDoArquivo, VisualizadorDeAnexo, baixarAnexo, tamanhoLegivel } from './anexos';
import { cn } from '@/lib/utils';

const FILTROS = [
  { key: '', label: 'Todos' },
  { key: 'image', label: 'Imagens' },
  { key: 'video', label: 'Vídeos' },
  { key: 'document', label: 'Documentos' },
  { key: 'archive', label: 'ZIP' },
] as const;

/** Tudo que foi compartilhado na conversa aberta, do mais novo para o mais velho. */
export function PainelDeArquivos({ conversationId, onClose, onJump }: { conversationId: string; onClose: () => void; onJump: (messageId: string, threadRootId?: string | null) => void }) {
  const [filtro, setFiltro] = useState<string>('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<ChatAttachment | null>(null);
  const arquivos = useChatFiles(conversationId, filtro, busca.trim());

  return (
    <aside aria-label="Arquivos compartilhados" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-grafite-elevado px-4 py-2.5">
        <h2 className="font-heading text-sm font-semibold text-branco-cru">Arquivos</h2>
        <button type="button" onClick={onClose} aria-label="Fechar arquivos" className="text-nevoa hover:text-branco-cru"><X size={16} /></button>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-grafite-elevado p-2">
        {FILTROS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFiltro(f.key)} className={cn('rounded-full px-2.5 py-1 text-xs font-medium', filtro === f.key ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado')}>{f.label}</button>
        ))}
      </div>
      <div className="border-b border-grafite-elevado p-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome..." aria-label="Buscar arquivo pelo nome" className="w-full rounded-md border border-grafite-elevado bg-grafite py-1.5 pl-8 pr-2 text-[13px] text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {arquivos.isPending && <p className="flex justify-center py-8 text-nevoa"><Loader2 className="animate-spin" /></p>}
        {arquivos.isError && <p className="p-4 text-center text-sm text-erro">Não foi possível carregar os arquivos.</p>}
        {arquivos.data?.length === 0 && <p className="p-6 text-center text-sm text-nevoa">{busca || filtro ? 'Nada encontrado com esse filtro.' : 'Nenhum arquivo compartilhado ainda.'}</p>}
        <ul className="divide-y divide-grafite-elevado">
          {arquivos.data?.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <button type="button" onClick={() => (a.kind === 'image' || a.kind === 'video' || a.mimetype === 'application/pdf' ? setAberto(a) : void baixarAnexo(a))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-grafite-elevado text-nevoa"><IconeDoArquivo anexo={a} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-branco-cru" title={a.filename}>{a.filename}</span>
                  <span className="block truncate font-mono text-[10px] text-nevoa">
                    {a.sender_name ?? 'Colaborador'} · {new Date(a.created_at).toLocaleDateString('pt-BR')} · {tamanhoLegivel(a.size_bytes)}
                  </span>
                </span>
              </button>
              {a.message_id && (
                <button type="button" onClick={() => onJump(a.message_id!, a.thread_root_id)} aria-label="Ver na conversa" title="Ver na conversa" className="text-nevoa hover:text-branco-cru"><MessageSquareText size={15} /></button>
              )}
              <button type="button" onClick={() => void baixarAnexo(a)} aria-label={`Baixar ${a.filename}`} title="Baixar" className="text-nevoa hover:text-branco-cru"><Download size={15} /></button>
            </li>
          ))}
        </ul>
      </div>
      {aberto && <VisualizadorDeAnexo anexo={aberto} onClose={() => setAberto(null)} />}
    </aside>
  );
}
