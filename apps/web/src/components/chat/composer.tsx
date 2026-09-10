'use client';

import { useRef, useState } from 'react';
import { ArrowUp, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { agentSelectionLabel } from '@/lib/agent-meta';
import type { AgentSelection, ChatAttachmentWire } from '@/lib/api/contracts';
import { useUploadChatFile } from '@/hooks/use-upload-chat-file';
import { cn } from '@/lib/utils';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const ATTACHMENT_ACCEPT = 'image/*,application/pdf,.md,.txt';

/** Um anexo em voo: some da lista se der erro, vira `ChatAttachmentWire` quando o upload termina. */
interface PendingAttachment {
  localId: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  result?: ChatAttachmentWire;
  error?: string;
}

let localAttachmentSeq = 0;
function nextLocalAttachmentId() {
  localAttachmentSeq += 1;
  return `pending-attachment-${localAttachmentSeq}`;
}

/**
 * Composer do chat. Suporta até 10 anexos por mensagem (2026-09): cada
 * arquivo sobe ASSIM QUE entra (seleção, drag-and-drop ou Ctrl/Cmd+V) via
 * POST /uploads, e o POST /chat recebe só as referências já hospedadas
 * (`attachments`) — a mensagem nunca nasce com anexo pela metade. O botão de
 * enviar fica desligado enquanto qualquer upload está em andamento.
 */
export function Composer({
  onSend,
  disabled,
  agentSelection,
  variant = 'docked',
  showDisclaimer = true,
  textareaRef,
}: {
  onSend: (message: string, attachments?: ChatAttachmentWire[]) => void;
  disabled: boolean;
  agentSelection: AgentSelection;
  /** hero = protagonista da tela vazia (superfície elevada, glow no foco);
   * docked = rodapé da thread (visual original). Só casca - a lógica é a mesma. */
  variant?: 'hero' | 'docked';
  /** A home do chat renderiza o disclaimer dela ("Desigual OS pode...") fora do
   * composer pra ele sair de cena junto com a saudação; aí este fica desligado. */
  showDisclaimer?: boolean;
  /** Ref da textarea: o "Novo chat" da sidebar foca o composer depois do reset. */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const [value, setValue] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFile = useUploadChatFile();
  const hero = variant === 'hero';

  const isUploading = pendingAttachments.some((item) => item.status === 'uploading');
  const readyAttachments = pendingAttachments
    .filter((item): item is PendingAttachment & { status: 'done'; result: ChatAttachmentWire } => item.status === 'done')
    .map((item) => item.result);

  function addFiles(files: File[]) {
    if (!files.length) return;
    const slotsLeft = MAX_ATTACHMENTS - pendingAttachments.length;
    if (slotsLeft <= 0) return;
    const accepted = files.slice(0, slotsLeft);

    for (const file of accepted) {
      const localId = nextLocalAttachmentId();
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setPendingAttachments((current) => [
          ...current,
          { localId, file, status: 'error', error: 'Arquivo maior que 25MB.' },
        ]);
        continue;
      }
      setPendingAttachments((current) => [...current, { localId, file, status: 'uploading' }]);
      uploadFile.mutate(file, {
        onSuccess: (uploaded) => {
          setPendingAttachments((current) =>
            current.map((item) =>
              item.localId === localId
                ? {
                    ...item,
                    status: 'done',
                    result: { url: uploaded.url, filename: uploaded.filename, contentType: uploaded.contentType },
                  }
                : item,
            ),
          );
        },
        onError: (error) => {
          setPendingAttachments((current) =>
            current.map((item) =>
              item.localId === localId
                ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Falha no upload.' }
                : item,
            ),
          );
        },
      });
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Reseta o input pra escolher o(s) MESMO(S) arquivo(s) de novo disparar onChange.
    event.target.value = '';
    addFiles(files);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    // Só intercepta quando vem arquivo de verdade (imagem colada, PDF); texto
    // colado continua caindo direto na textarea, comportamento nativo.
    event.preventDefault();
    addFiles(files);
  }

  function removeAttachment(localId: string) {
    setPendingAttachments((current) => current.filter((item) => item.localId !== localId));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    // Mensagem só de anexo é válida (ex: colar uma imagem e mandar sem texto);
    // o que não pode é mandar vazio-vazio, ou enquanto algo ainda está subindo.
    if ((!trimmed && !readyAttachments.length) || disabled || isUploading) return;
    onSend(trimmed || '(sem texto)', readyAttachments.length ? readyAttachments : undefined);
    setValue('');
    setPendingAttachments([]);
  }

  return (
    <form onSubmit={handleSubmit} className="shrink-0">
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {pendingAttachments.map((item) => (
            <span
              key={item.localId}
              className={cn(
                'flex max-w-64 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs',
                item.status === 'error'
                  ? 'border-erro/40 bg-erro/10 text-erro'
                  : 'border-roxo-eletrico/40 bg-roxo-eletrico/10 text-branco-cru',
              )}
            >
              {item.status === 'uploading' ? (
                <Loader2 size={13} className="shrink-0 animate-spin text-nevoa" />
              ) : item.status === 'error' ? (
                <FileText size={13} className="shrink-0" />
              ) : (
                <Paperclip size={13} className="shrink-0 text-roxo-eletrico" />
              )}
              <span className="truncate">{item.status === 'error' ? (item.error ?? item.file.name) : item.file.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(item.localId)}
                aria-label="Remover anexo"
                className="shrink-0 rounded p-0.5 text-nevoa transition-colors hover:text-branco-cru"
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        className={cn(
          'flex items-end gap-2 border transition-[border-color,box-shadow] duration-300',
          hero
            ? 'rounded-xl border-white/10 bg-white/[0.04] p-3 shadow-elevated backdrop-blur-md focus-within:border-roxo-eletrico/60 focus-within:shadow-glow'
            : 'rounded-lg border-grafite-elevado bg-grafite p-2 focus-within:border-roxo-eletrico/60',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || pendingAttachments.length >= MAX_ATTACHMENTS}
          aria-label="Anexar arquivos"
          title="Anexar até 10 arquivos (imagem, PDF, .md ou .txt, até 25MB cada) ou colar com Ctrl/Cmd+V"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-40',
            hero ? 'size-10' : 'size-9',
          )}
        >
          <Paperclip size={17} />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event);
            }
          }}
          rows={hero ? 2 : 1}
          placeholder={`Pergunte para ${agentSelectionLabel(agentSelection)}...`}
          className={cn(
            'max-h-40 flex-1 resize-none bg-transparent text-branco-cru placeholder:text-nevoa focus:outline-none',
            hero ? 'min-h-12 py-2 text-base' : 'min-h-9 py-1.5 text-sm',
          )}
        />
        <button
          type="submit"
          disabled={disabled || isUploading || (!value.trim() && !readyAttachments.length)}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40 disabled:hover:shadow-none',
            hero ? 'size-10' : 'size-9',
          )}
          aria-label="Enviar mensagem"
        >
          <ArrowUp size={17} />
        </button>
      </div>
      {showDisclaimer && (
        <p className="mt-2 text-center text-xs text-nevoa">
          {agentSelectionLabel(agentSelection)} pode cometer erros. Sempre valide informações críticas.
        </p>
      )}
    </form>
  );
}
