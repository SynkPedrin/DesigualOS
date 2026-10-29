'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronLeft, Download, FileText, MessageCircle, Mic, MoreHorizontal, Paperclip, Pause, Phone, Play, RotateCcw, Search, Smile, Square, Video, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useInboxMentionables, useInboxMessages, useInboxThread, useMarkInboxRead, useSendInboxMedia, useSendInboxMessage, useSendInboxSticker } from '@/hooks/use-inbox';
import { comNomes, consultaDeMarcacao, filtrarMarcaveis, inserirMarcacao, paraEnvio, type PessoaMarcavel } from './marcacoes';
import { ApiRequestError } from '@/lib/api/client';
import type { InboxMessage } from '@/lib/api/contracts';
import { textoComLinks } from '@/lib/links-no-texto';
import { cn } from '@/lib/utils';
import { InboxAvatar } from './inbox-avatar';
import { EmojiStickerPicker } from './emoji-sticker-picker';
import { useProtectedObjectUrl } from './use-protected-object-url';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(value: number | null): string {
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}


function AttachmentView({ message, onImageOpen }: { message: InboxMessage; onImageOpen: (url: string) => void }) {
  const media = useProtectedObjectUrl(message.attachmentUrl);
  if (media.loading) return <Skeleton className="h-24 w-52" />;
  if (media.error) return <p className="text-xs text-erro">Não foi possível carregar a mídia.</p>;
  if (!media.url) return null;
  const type = message.attachmentType ?? '';
  if (type.startsWith('image/')) {
    return <button type="button" onClick={() => onImageOpen(media.url!)} className="block overflow-hidden rounded-md"><img src={media.url} alt={message.attachmentFilename ?? 'Imagem da conversa'} className="max-h-72 max-w-full object-cover transition-transform hover:scale-[1.01]" /></button>;
  }
  if (type.startsWith('video/')) return <video controls preload="metadata" src={media.url} className="max-h-72 max-w-full rounded-md" />;
  if (type.startsWith('audio/')) return <audio controls preload="metadata" src={media.url} className="h-10 w-56 max-w-full" />;
  return (
    <a href={media.url} download={message.attachmentFilename ?? 'arquivo'} className="flex max-w-64 items-center gap-2 rounded-md bg-carbono/20 p-2.5">
      <FileText size={22} className="shrink-0 text-nevoa" />
      <span className="min-w-0"><span className="block truncate text-xs underline">{message.attachmentFilename ?? 'Documento'}</span><span className="text-[10px] opacity-70">{formatBytes(message.attachmentSizeBytes)}</span></span>
      <Download size={15} className="ml-auto shrink-0" />
    </a>
  );
}

function deliveryLabel(message: InboxMessage): string {
  if (message.direction !== 'outbound') return '';
  const labels: Record<string, string> = { pending: 'aguardando envio', sent: 'aceita pelo WhatsApp', delivered: 'entregue', read: 'lida', failed: 'falhou ao enviar' };
  return labels[message.deliveryStatus] ? ` · ${labels[message.deliveryStatus]}` : '';
}

export function ThreadChat({ threadId, onBack }: { threadId: string | null; onBack?: () => void }) {
  const { data: thread } = useInboxThread(threadId);
  const { data: messages, isPending } = useInboxMessages(threadId);
  const sendMessage = useSendInboxMessage(threadId ?? '');
  const sendMedia = useSendInboxMedia(threadId ?? '');
  const sendSticker = useSendInboxSticker(threadId ?? '');
  const { mutate: markRead } = useMarkInboxRead(threadId ?? '');
  const [draft, setDraft] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [voiceNote, setVoiceNote] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discardRecording = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const ehGrupo = Boolean(thread?.externalChatId?.endsWith('@g.us'));
  const marcaveis = useInboxMentionables(threadId, ehGrupo).data ?? [];
  const [marcadas, setMarcadas] = useState<PessoaMarcavel[]>([]);
  const [consulta, setConsulta] = useState<{ inicio: number; termo: string } | null>(null);
  const [destaque, setDestaque] = useState(0);
  const sugestoes = consulta && marcaveis.length ? filtrarMarcaveis(marcaveis, consulta.termo) : [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length, threadId]);

  useEffect(() => {
    if (threadId && (thread?.unreadCount ?? 0) > 0) markRead();
  }, [threadId, thread?.unreadCount, markRead]);

  useEffect(() => {
    if (!selectedFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => () => {
    if (recorder.current?.state && recorder.current.state !== 'inactive') recorder.current.stop();
  }, []);

  if (!threadId) {
    return <div className="flex h-full items-center justify-center bg-carbono"><EmptyState icon={MessageCircle} title="Selecione uma conversa" description="Escolha uma conversa na lista para ver as mensagens." /></div>;
  }

  function clearFile() {
    setSelectedFile(null);
    setVoiceNote(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  // Emoji entra onde está o cursor, não no fim do texto.
  function insertEmoji(emoji: string) {
    const el = textarea.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + emoji.length, start + emoji.length); });
  }

  // Não espera o servidor: a bolha já aparece (ver optimistic em use-inbox) e o
  // campo libera na hora para a próxima mensagem. Falha fica marcada na bolha.
  function handleSend() {
    const text = draft.trim();
    if (selectedFile) {
      sendMedia.mutate({ file: selectedFile, ...(text ? { caption: text } : {}), voiceNote });
    } else {
      if (!text) return;
      const envio = paraEnvio(text, marcadas);
      sendMessage.mutate(envio.mentions.length ? { text: envio.texto, mentions: envio.mentions } : text);
    }
    setDraft('');
    setMarcadas([]);
    setConsulta(null);
    clearFile();
  }

  function aoDigitar(valor: string, cursor: number) {
    setDraft(valor);
    const c = ehGrupo ? consultaDeMarcacao(valor, cursor) : null;
    setConsulta(c);
    if (c?.termo !== consulta?.termo) setDestaque(0);
  }

  function marcar(pessoa: PessoaMarcavel) {
    if (!consulta) return;
    const r = inserirMarcacao(draft, consulta, pessoa);
    setDraft(r.texto);
    setMarcadas((m) => (m.some((x) => x.id === pessoa.id) ? m : [...m, pessoa]));
    setConsulta(null);
    const el = textarea.current;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.cursor, r.cursor); });
  }

  async function startRecording() {
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimetype = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const mediaRecorder = mimetype ? new MediaRecorder(stream, { mimeType: mimetype }) : new MediaRecorder(stream);
      chunks.current = [];
      discardRecording.current = false;
      mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!discardRecording.current && chunks.current.length > 0) {
          const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'audio/webm' });
          setSelectedFile(new File([blob], `audio-${Date.now()}.webm`, { type: blob.type }));
          setVoiceNote(true);
        }
      };
      recorder.current = mediaRecorder;
      mediaRecorder.start(250);
      setRecording(true);
    } catch (error) {
      setRecordError(error instanceof Error ? `Não foi possível acessar o microfone: ${error.message}` : 'Não foi possível acessar o microfone.');
    }
  }

  function stopRecording(discard: boolean) {
    discardRecording.current = discard;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    setRecording(false);
    setPaused(false);
  }

  const error = sendMessage.error ?? sendMedia.error;

  return (
    <div className="flex h-full min-h-0 flex-col bg-carbono">
      <div className="flex items-center justify-between gap-3 border-b border-grafite-elevado px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && <button type="button" onClick={onBack} aria-label="Voltar para conversas" className="flex size-8 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru lg:hidden"><ChevronLeft size={19} /></button>}
          <InboxAvatar name={thread?.clientName ?? thread?.contactName ?? '?'} photoUrl={thread?.contactAvatarUrl} kind={thread?.clientId ? 'client' : 'person'} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-semibold text-branco-cru">{thread?.clientName ?? thread?.contactName ?? 'sem dado'}</p>
              {thread?.channel === 'whatsapp' && <img src="/logos/whatsapp.webp" alt="WhatsApp" className="size-3.5 shrink-0 rounded-sm" />}
              {thread?.kind === 'group' && <span className="rounded-full bg-grafite-elevado px-2 py-0.5 text-[9px] uppercase text-nevoa">Grupo</span>}
            </div>
            <p className="truncate text-xs text-nevoa">{thread?.kind === 'group' ? 'Grupo do WhatsApp' : thread?.contactPhone ?? 'Conversa externa'}{thread?.humanServiceStatus === 'active' ? ' · Atendimento humano em andamento' : ''}</p>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1 text-nevoa sm:flex">
          <button type="button" title="Buscar na conversa" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru"><Search size={16} /></button>
          <button type="button" title="Ligar" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru"><Phone size={16} /></button>
          <button type="button" title="Chamada de vídeo" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru"><Video size={16} /></button>
          <button type="button" title="Mais opções" className="flex size-8 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru"><MoreHorizontal size={16} /></button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f4f1ec] bg-cover bg-center bg-no-repeat px-3 py-4 sm:px-5" style={{ backgroundImage: 'url(/brand/inbox-whatsapp.png)' }}>
        {isPending ? Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-10 w-2/3" />) : messages && messages.length > 0 ? messages.map((message) => (
          <div key={message.id} className={cn('flex', message.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[88%] rounded-lg px-3 py-2 text-sm shadow-sm sm:max-w-[72%]', message.direction === 'outbound' ? 'bg-[#c7f5d5] text-[#173c2a]' : 'bg-grafite-elevado text-branco-cru')}>
              {thread?.kind === 'group' && message.direction === 'inbound' && <p className="mb-1 text-[11px] font-semibold text-sinal">{message.senderName ?? message.senderContactId ?? 'Participante'}</p>}
              {message.attachmentUrl && <AttachmentView message={message} onImageOpen={setLightbox} />}
              {message.content && (
                <p className={cn('whitespace-pre-wrap break-words [overflow-wrap:anywhere]', message.attachmentUrl && 'mt-1.5')}>
                  {textoComLinks(comNomes(message.content, marcaveis), cn('underline underline-offset-2 hover:opacity-80', message.direction === 'outbound' ? 'text-[#0b5c8a]' : 'text-roxo-eletrico'))}
                </p>
              )}
              <div className={cn('mt-1 flex items-center gap-2 text-[10px]', message.direction === 'outbound' ? 'text-[#173c2a]/70' : 'text-nevoa')}>
                <span>{formatTime(message.createdAt)}{deliveryLabel(message)}</span>
                {message.deliveryStatus === 'failed' && message.direction === 'outbound' && message.content && (
                  <button type="button" onClick={() => { setDraft(message.content ?? ''); }} className="inline-flex items-center gap-1 font-semibold text-erro"><RotateCcw size={11} />Reenviar</button>
                )}
              </div>
            </div>
          </div>
        )) : <div className="flex h-full items-center justify-center"><p className="rounded-lg bg-grafite/80 px-4 py-2 text-center text-sm text-nevoa">Nenhuma mensagem ainda.</p></div>}
        <div ref={bottom} />
      </div>

      <div className="border-t border-grafite-elevado bg-carbono p-3">
        {(error || recordError) && <p className="mb-2 text-xs text-erro">{recordError ?? (error instanceof ApiRequestError ? error.message : 'Falha ao enviar.')}</p>}
        {selectedFile && (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-grafite-elevado bg-grafite p-2.5">
            {previewUrl && selectedFile.type.startsWith('image/') ? <img src={previewUrl} alt="Prévia do anexo" className="size-14 rounded object-cover" /> : <FileText size={22} className="text-nevoa" />}
            <div className="min-w-0 flex-1"><p className="truncate text-xs text-branco-cru">{selectedFile.name}</p><p className="text-[10px] text-nevoa">{formatBytes(selectedFile.size)}</p>{previewUrl && selectedFile.type.startsWith('audio/') && <audio controls src={previewUrl} className="mt-1 h-8 w-full" />}</div>
            <button type="button" onClick={clearFile} aria-label="Remover anexo" className="text-nevoa hover:text-branco-cru"><X size={17} /></button>
          </div>
        )}
        {selectedFile?.type.startsWith('audio/') && <label className="mb-2 flex items-center gap-2 text-xs text-nevoa"><input type="checkbox" checked={voiceNote} onChange={(event) => setVoiceNote(event.target.checked)} />Enviar como mensagem de voz (Ogg/Opus)</label>}
        {recording && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-erro/30 bg-erro/10 p-2.5 text-xs text-branco-cru">
            <span className="size-2 animate-pulse rounded-full bg-erro" />{paused ? 'Gravação pausada' : 'Gravando áudio…'}
            <button type="button" onClick={() => { if (paused) { recorder.current?.resume(); setPaused(false); } else { recorder.current?.pause(); setPaused(true); } }} className="ml-auto rounded p-1 hover:bg-grafite-elevado" title={paused ? 'Continuar' : 'Pausar'}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
            <button type="button" onClick={() => stopRecording(false)} className="rounded p-1 text-sucesso" title="Concluir"><Square size={15} /></button>
            <button type="button" onClick={() => stopRecording(true)} className="rounded p-1 text-erro" title="Cancelar"><X size={15} /></button>
          </div>
        )}
        <div className="relative flex items-end gap-2">
          {pickerOpen && (
            <>
              <button type="button" aria-label="Fechar emojis" className="fixed inset-0 z-10 cursor-default" onClick={() => setPickerOpen(false)} />
              <div className="absolute bottom-12 right-0 z-20">
                <EmojiStickerPicker
                  onEmoji={insertEmoji}
                  onSticker={(sticker) => { sendSticker.mutate(sticker); setPickerOpen(false); }}
                  onStickerFile={(file) => { sendMedia.mutate({ file, sticker: true }); setPickerOpen(false); }}
                />
              </div>
            </>
          )}
          <input ref={fileInput} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" onChange={(event) => { const file = event.target.files?.[0] ?? null; setSelectedFile(file); setVoiceNote(false); }} />
          <button type="button" title="Anexar arquivo" onClick={() => fileInput.current?.click()} disabled={recording} className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru disabled:opacity-40"><Paperclip size={18} /></button>
          {sugestoes.length > 0 && (
            <ul role="listbox" aria-label="Marcar pessoa" className="absolute bottom-12 left-11 z-20 max-h-64 w-72 overflow-y-auto rounded-lg border border-grafite-elevado bg-grafite py-1 shadow-2xl">
              {sugestoes.map((p, i) => (
                <li key={p.id} role="option" aria-selected={i === destaque}>
                  <button type="button" onMouseDown={(event) => { event.preventDefault(); marcar(p); }} onMouseEnter={() => setDestaque(i)} className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === destaque ? 'bg-grafite-elevado text-branco-cru' : 'text-branco-cru/85')}>
                    <span className="truncate">{p.nome}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-nevoa">{/^\d+$/.test(p.token) && !p.nome.includes(p.token) ? `+${p.token}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea ref={textarea} value={draft} onChange={(event) => aoDigitar(event.target.value, event.target.selectionStart ?? event.target.value.length)} onKeyDown={(event) => {
            if (sugestoes.length) {
              if (event.key === 'ArrowDown') { event.preventDefault(); setDestaque((d) => (d + 1) % sugestoes.length); return; }
              if (event.key === 'ArrowUp') { event.preventDefault(); setDestaque((d) => (d - 1 + sugestoes.length) % sugestoes.length); return; }
              if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); marcar(sugestoes[Math.min(destaque, sugestoes.length - 1)]!); return; }
              if (event.key === 'Escape') { event.preventDefault(); setConsulta(null); return; }
            }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); }
          }} rows={1} placeholder={selectedFile ? 'Adicionar legenda…' : ehGrupo ? 'Digite uma mensagem... (@ para marcar alguém)' : 'Digite uma mensagem...'} className="flex-1 resize-none rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru outline-none placeholder:text-nevoa/60 focus:border-sinal" />
          <button type="button" title="Emojis e figurinhas" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)} className={cn('flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-grafite-elevado hover:text-branco-cru', pickerOpen ? 'text-sinal' : 'text-nevoa')}><Smile size={18} /></button>
          {!draft.trim() && !selectedFile ? (
            <button type="button" title={recording ? 'Gravando' : 'Gravar áudio'} onClick={() => void startRecording()} disabled={recording} className="flex size-9 shrink-0 items-center justify-center rounded-md bg-grafite-elevado text-nevoa disabled:opacity-40"><Mic size={18} /></button>
          ) : (
            <button type="button" onClick={() => handleSend()} disabled={recording} className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sinal text-carbono disabled:opacity-40"><ArrowUp size={18} /></button>
          )}
        </div>
      </div>

      {lightbox && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-carbono/95 p-4" role="dialog" aria-modal="true" aria-label="Visualização da imagem" onClick={() => setLightbox(null)}><button type="button" className="absolute right-5 top-5 text-branco-cru" aria-label="Fechar"><X size={26} /></button><img src={lightbox} alt="Visualização ampliada" className="max-h-[90vh] max-w-full object-contain" onClick={(event) => event.stopPropagation()} /></div>}
    </div>
  );
}
