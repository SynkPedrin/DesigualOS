'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Image as ImageIcon, Loader2, Paperclip, Upload, X } from 'lucide-react';
import { useProtectedObjectUrl } from '@/components/inbox/use-protected-object-url';
import type { WorkTaskDetail } from '@/hooks/use-work';
import { useTaskCrud } from '@/hooks/use-work-extra';
import { apiBlob, apiUploadWithProgress, ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast-store';

type Anexo = WorkTaskDetail['attachments'][number];
const ehImagem = (a: Anexo) => Boolean(a.mimeType?.startsWith('image/'));
const tamanho = (b: number | null) => (b === null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1).replace('.0', '')} MB`);

async function baixar(a: Anexo) {
  try {
    const blob = await apiBlob(`${a.url}${a.url.includes('?') ? '&' : '?'}download=1`);
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = a.fileName; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (e) { toast(e instanceof Error ? e.message : 'Não foi possível baixar o arquivo.', 'error'); }
}

function Miniatura({ a }: { a: Anexo }) {
  const m = useProtectedObjectUrl(ehImagem(a) ? a.url : null);
  if (m.url) return <img src={m.url} alt={a.fileName} className="size-9 shrink-0 rounded object-cover" />;
  return <span className="flex size-9 shrink-0 items-center justify-center rounded bg-grafite-elevado text-nevoa">{ehImagem(a) ? <ImageIcon size={15} /> : <FileText size={15} />}</span>;
}

/** Arquivos da tarefa: arraste para cá, escolha no computador ou cole um link. Arquivo fica no servidor, privado. */
export function AnexosDaTarefa({ taskId, anexos, erro }: { taskId: string; anexos: Anexo[]; erro: (e: unknown) => void }) {
  const crud = useTaskCrud(taskId);
  const qc = useQueryClient();
  const seletor = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState<Array<{ key: string; nome: string; fracao: number }>>([]);
  const [arrastando, setArrastando] = useState(false);
  const [link, setLink] = useState('');

  async function enviar(arquivos: File[]) {
    for (const f of arquivos) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      setSubindo((s) => [...s, { key, nome: f.name, fracao: 0 }]);
      try {
        const fd = new FormData(); fd.append('file', f);
        await apiUploadWithProgress(`/work/tasks/${taskId}/attachments/upload`, fd, (fracao) => setSubindo((s) => s.map((x) => (x.key === key ? { ...x, fracao } : x))));
        void qc.invalidateQueries({ queryKey: ['work'] });
      } catch (e) { toast(e instanceof ApiRequestError ? `${f.name}: ${e.message}` : `Não foi possível enviar ${f.name}.`, 'error'); }
      finally { setSubindo((s) => s.filter((x) => x.key !== key)); }
    }
  }

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); void enviar([...e.dataTransfer.files]); }}
      className={cn('rounded-lg border border-dashed p-2 transition-colors', arrastando ? 'border-sinal bg-sinal/10' : 'border-transparent')}
    >
      <ul className="space-y-1.5">
        {anexos.map((a) => (
          <li key={a.id} className="group flex items-center gap-2">
            {a.storage === 'storage' ? <Miniatura a={a} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded bg-grafite-elevado text-nevoa"><Paperclip size={15} /></span>}
            {a.storage === 'storage'
              ? <button type="button" onClick={() => void baixar(a)} className="min-w-0 flex-1 text-left" title="Baixar"><span className="block truncate text-sm text-branco-cru hover:underline">{a.fileName}</span><span className="text-[11px] text-nevoa">{tamanho(a.sizeBytes)}</span></button>
              : <a href={a.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1"><span className="block truncate text-sm text-branco-cru hover:underline">{a.fileName}</span><span className="text-[11px] text-nevoa">link</span></a>}
            {a.storage === 'storage' && <button type="button" aria-label={`Baixar ${a.fileName}`} onClick={() => void baixar(a)} className="text-nevoa opacity-40 hover:text-branco-cru group-hover:opacity-100 focus:opacity-100"><Download size={13} /></button>}
            <button type="button" aria-label={`Remover anexo ${a.fileName}`} onClick={() => crud.apagarAnexo.mutate(a.id, { onError: erro })} className="text-nevoa opacity-40 transition-opacity hover:text-red-400 group-hover:opacity-100 focus:opacity-100"><X size={13} /></button>
          </li>
        ))}
        {subindo.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm text-nevoa" role="status">
            <Loader2 size={14} className="animate-spin" /><span className="min-w-0 flex-1 truncate">{s.nome}</span>
            <span className="h-1 w-20 overflow-hidden rounded bg-grafite-elevado"><span className="block h-full bg-sinal" style={{ width: `${Math.round(s.fracao * 100)}%` }} /></span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={seletor} type="file" multiple hidden onChange={(e) => { void enviar([...(e.target.files ?? [])]); e.target.value = ''; }} aria-label="Escolher arquivos para anexar" />
        <button type="button" onClick={() => seletor.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-grafite-elevado px-2.5 py-1.5 text-sm text-branco-cru hover:border-sinal/60"><Upload size={14} /> Anexar arquivo</button>
        <form className="min-w-40 flex-1" onSubmit={(e) => { e.preventDefault(); if (link.trim()) crud.anexar.mutate({ url: link.trim() }, { onSuccess: () => setLink(''), onError: erro }); }}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="ou cole um link (Drive, Figma…)" aria-label="Link do anexo" className="w-full rounded border border-grafite-elevado bg-transparent px-2 py-1.5 text-sm text-branco-cru outline-none placeholder:text-nevoa" />
        </form>
      </div>
      <p className="mt-1 text-[11px] text-nevoa/70">Arraste arquivos para esta área. Imagens, PDF, documentos, planilhas, vídeos e zip.</p>
    </div>
  );
}
