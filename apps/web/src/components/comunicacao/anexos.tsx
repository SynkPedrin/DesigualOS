'use client';

import { useEffect, useState } from 'react';
import { Archive, Download, FileSpreadsheet, FileText, Film, Image as ImageIcon, Loader2, Presentation } from 'lucide-react';
import { apiBlob } from '@/lib/api/client';
import { PreviaDeAnexo } from '@/components/ui/previa-de-anexo';
import { useProtectedObjectUrl } from '@/components/inbox/use-protected-object-url';
import { toast } from '@/stores/toast-store';
import type { ChatAttachment } from '@/hooks/use-internal-chat';
import { cn } from '@/lib/utils';

/**
 * Anexo da Comunicação. O arquivo é PRIVADO: nada de URL pública — tudo passa
 * pela API com o token (apiBlob) e vira object URL só nesta aba. Por isso a
 * miniatura só baixa quando aparece na tela, e o resto baixa sob clique.
 */

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.0', '')} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function extensao(nome: string) {
  return nome.split('.').pop()?.toLowerCase() ?? '';
}

export function IconeDoArquivo({ anexo, size = 18 }: { anexo: Pick<ChatAttachment, 'kind' | 'filename'>; size?: number }) {
  const ext = extensao(anexo.filename);
  if (anexo.kind === 'image') return <ImageIcon size={size} />;
  if (anexo.kind === 'video') return <Film size={size} />;
  if (anexo.kind === 'archive') return <Archive size={size} />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet size={size} />;
  if (['ppt', 'pptx'].includes(ext)) return <Presentation size={size} />;
  return <FileText size={size} />;
}

export async function baixarAnexo(anexo: ChatAttachment) {
  try {
    const blob = await apiBlob(`${anexo.url}?download=1`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = anexo.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (erro) {
    toast(erro instanceof Error ? erro.message : 'Não foi possível baixar o arquivo.', 'error');
  }
}

/** Visualizador em tela cheia: imagem e PDF usam a prévia do sistema; vídeo tem player próprio. */
export function VisualizadorDeAnexo({ anexo, onClose }: { anexo: ChatAttachment; onClose: () => void }) {
  const media = useProtectedObjectUrl(anexo.url);
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  if (!media.url) {
    return (
      <div role="dialog" aria-modal="true" aria-label={`Abrindo ${anexo.filename}`} onClick={onClose} className="fixed inset-0 z-[110] flex items-center justify-center bg-carbono/90">
        {media.error ? (
          <p className="rounded-md bg-grafite px-4 py-3 text-sm text-erro">Não foi possível abrir o arquivo.</p>
        ) : (
          <Loader2 className="animate-spin text-nevoa" />
        )}
      </div>
    );
  }
  if (anexo.kind === 'video') {
    return (
      <div role="dialog" aria-modal="true" aria-label={`Vídeo ${anexo.filename}`} onClick={onClose} className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-3 bg-carbono/90 p-4">
        <div className="flex w-full max-w-4xl items-center justify-between">
          <p className="truncate font-mono text-[11px] text-nevoa">{anexo.filename}</p>
          <button type="button" onClick={(e) => { e.stopPropagation(); void baixarAnexo(anexo); }} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-nevoa hover:bg-grafite hover:text-branco-cru"><Download size={14} /> Baixar</button>
        </div>
        <VideoOuAviso anexo={anexo} src={media.url} className="max-h-[80vh] w-full max-w-4xl rounded-lg bg-black" onClick={(e) => e.stopPropagation()} />
      </div>
    );
  }
  return <PreviaDeAnexo anexo={{ url: media.url, filename: anexo.filename, contentType: anexo.mimetype }} onClose={onClose} />;
}

/**
 * .MOV nem sempre toca no navegador (Chrome no Windows, por exemplo). Pergunta
 * ao navegador antes; se ele não souber, diz isso e oferece o download.
 */
function VideoOuAviso({ anexo, src, className, onClick }: { anexo: ChatAttachment; src: string; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  const [falhou, setFalhou] = useState(false);
  const suporta = typeof document === 'undefined' || document.createElement('video').canPlayType(anexo.mimetype) !== '';
  if (!suporta || falhou) {
    return (
      <div onClick={onClick} className="flex flex-col items-center gap-2 rounded-lg bg-grafite p-8 text-center">
        <Film className="text-nevoa" />
        <p className="text-sm text-branco-cru">Este navegador não reproduz {extensao(anexo.filename).toUpperCase()}</p>
        <button type="button" onClick={() => void baixarAnexo(anexo)} className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru">Baixar vídeo</button>
      </div>
    );
  }
  return <video src={src} controls autoPlay playsInline onError={() => setFalhou(true)} className={className} onClick={onClick} />;
}

function Miniatura({ anexo, onOpen }: { anexo: ChatAttachment; onOpen: () => void }) {
  const media = useProtectedObjectUrl(anexo.url);
  // Reserva o espaço com a proporção real: a conversa não "pula" quando a imagem chega.
  const proporcao = anexo.width && anexo.height ? `${anexo.width} / ${anexo.height}` : '4 / 3';
  return (
    <button type="button" onClick={onOpen} title={anexo.filename} className="block w-64 max-w-full overflow-hidden rounded-lg border border-grafite-elevado bg-grafite-elevado/40" style={{ aspectRatio: proporcao, maxHeight: 320 }}>
      {media.url ? (
        <img src={media.url} alt={anexo.filename} className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-nevoa">{media.error ? <ImageIcon size={20} /> : <Loader2 size={18} className="animate-spin" />}</span>
      )}
    </button>
  );
}

function CartaoDeArquivo({ anexo, onOpen }: { anexo: ChatAttachment; onOpen?: () => void }) {
  return (
    <div className="flex w-72 max-w-full items-center gap-3 rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-grafite-elevado text-nevoa"><IconeDoArquivo anexo={anexo} /></span>
      <button type="button" onClick={onOpen ?? (() => void baixarAnexo(anexo))} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[13px] font-medium text-branco-cru" title={anexo.filename}>{anexo.filename}</p>
        <p className="font-mono text-[11px] text-nevoa">{extensao(anexo.filename).toUpperCase()} · {tamanhoLegivel(anexo.size_bytes)}</p>
      </button>
      <button type="button" onClick={() => void baixarAnexo(anexo)} aria-label={`Baixar ${anexo.filename}`} className="flex size-8 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><Download size={15} /></button>
    </div>
  );
}

/** Anexos dentro da bolha da mensagem. */
export function AnexosDaMensagem({ anexos }: { anexos: ChatAttachment[] }) {
  const [aberto, setAberto] = useState<ChatAttachment | null>(null);
  if (anexos.length === 0) return null;
  return (
    <div className={cn('mt-1.5 flex flex-wrap gap-2')}>
      {anexos.map((a) =>
        a.kind === 'image' ? (
          <Miniatura key={a.id} anexo={a} onOpen={() => setAberto(a)} />
        ) : a.kind === 'video' || a.mimetype === 'application/pdf' ? (
          <CartaoDeArquivo key={a.id} anexo={a} onOpen={() => setAberto(a)} />
        ) : (
          <CartaoDeArquivo key={a.id} anexo={a} />
        ),
      )}
      {aberto && <VisualizadorDeAnexo anexo={aberto} onClose={() => setAberto(null)} />}
    </div>
  );
}
