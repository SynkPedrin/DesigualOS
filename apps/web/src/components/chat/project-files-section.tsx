'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, File, FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteProjectFile, useProjectFiles, useUploadProjectFile } from '@/hooks/use-project-files';
import type { ProjectFile, ProjectFileKind } from '@/lib/api/contracts';

const KIND_LABELS: Record<ProjectFileKind, string> = {
  identidade_visual: 'Identidade visual',
  briefing: 'Briefing',
  referencia: 'Referência',
};

const KIND_ORDER: ProjectFileKind[] = ['identidade_visual', 'briefing', 'referencia'];

function FileTypeIcon({ file }: { file: ProjectFile }) {
  if (file.contentType.startsWith('image/')) {
    return (
      <img
        src={file.storageUrl}
        alt={file.filename}
        className="size-10 shrink-0 rounded-md border border-white/10 object-cover"
      />
    );
  }
  const Icon = file.hasText || file.contentType.startsWith('text/') ? FileText : File;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-grafite-elevado bg-grafite text-nevoa">
      <Icon size={16} />
    </span>
  );
}

/**
 * Seção "Arquivos" da tela de Projeto do chat: identidade visual, briefing e
 * referências anexados ao projeto (entram no contexto das conversas dele).
 * O kind é escolhido no menu do botão Anexar ANTES de abrir o seletor de
 * arquivo, porque o backend exige o campo `kind` antes do `file` no multipart.
 */
export function ProjectFilesSection({ projectId }: { projectId: string }) {
  const { data: files, isPending } = useProjectFiles(projectId);
  const uploadFile = useUploadProjectFile(projectId);
  const deleteFile = useDeleteProjectFile(projectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<ProjectFileKind | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  function handlePickKind(kind: ProjectFileKind) {
    setSelectedKind(kind);
    setMenuOpen(false);
    // O input é remontado com o accept padrão; o click precisa vir depois do
    // estado do kind assentar pro onChange ler o valor certo.
    requestAnimationFrame(() => fileInputRef.current?.click());
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedKind) return;
    uploadFile.mutate({ kind: selectedKind, file });
  }

  function handleDelete(file: ProjectFile) {
    if (!window.confirm(`Excluir "${file.filename}"?`)) return;
    deleteFile.mutate(file.id);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Arquivos</p>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            disabled={uploadFile.isPending}
            className="flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-grafite px-2.5 py-1.5 text-xs text-branco-cru transition-colors hover:border-roxo-eletrico/50 disabled:opacity-50"
          >
            {uploadFile.isPending ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
            {uploadFile.isPending ? 'Enviando…' : 'Anexar'}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-md border border-grafite-elevado bg-grafite-elevado p-1 shadow-elevated">
              <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">Tipo do arquivo</p>
              {KIND_ORDER.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handlePickKind(kind)}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm text-branco-cru transition-colors hover:bg-carbono"
                >
                  {KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" aria-hidden="true" tabIndex={-1} />

      {isPending ? (
        <div className="space-y-1">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : !files || files.length === 0 ? (
        <p className="rounded-md border border-dashed border-grafite-elevado px-4 py-6 text-center text-sm text-nevoa">
          Nenhum arquivo ainda. Anexe a identidade visual e o briefing do cliente pra dar contexto às conversas deste projeto.
        </p>
      ) : (
        <div className="space-y-1">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 rounded-md border border-grafite-elevado bg-grafite/40 px-3 py-2"
            >
              <FileTypeIcon file={file} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-branco-cru" title={file.filename}>
                  {file.filename}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{KIND_LABELS[file.kind]}</p>
              </div>
              <a
                href={file.storageUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Baixar ${file.filename}`}
                className="shrink-0 rounded p-1.5 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
              >
                <Download size={14} />
              </a>
              <button
                type="button"
                onClick={() => handleDelete(file)}
                disabled={deleteFile.isPending}
                aria-label={`Excluir ${file.filename}`}
                className="shrink-0 rounded p-1.5 text-nevoa transition-colors hover:bg-grafite-elevado hover:text-erro disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
