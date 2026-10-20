'use client';

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Paperclip, RotateCcw, Send, Smile, X } from 'lucide-react';
import {
  newClientMessageId,
  notifyTyping,
  uploadChatAttachment,
  useAttachmentPolicy,
  type ChatAttachment,
  type ChatMember,
  type ChatMessage,
  type SendInput,
} from '@/hooks/use-internal-chat';
import { IconeDoArquivo, tamanhoLegivel } from './anexos';
import { cn } from '@/lib/utils';

const KIND_POR_EXTENSAO: Record<string, ChatAttachment['kind']> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  mp4: 'video', mov: 'video', zip: 'archive',
};
const MAX_ANEXOS = 10;
const EMOJIS_RAPIDOS = '😀😂😍🥰😎🤔😅😢😡👍👎👏🙏💪🔥✨🎉✅❌⚠️❤️👀🚀📌📎💡🕐☕'.match(/\p{Extended_Pictographic}️?/gu) ?? [];

interface Envio {
  key: string;
  file: File;
  progress: number;
  status: 'subindo' | 'pronto' | 'erro';
  erro?: string | undefined;
  anexo?: ChatAttachment;
  controller?: AbortController;
}

export interface ComposerHandle { addFiles: (files: FileList | File[]) => void; focus: () => void }

/**
 * Caixa de escrever. Enter envia, Shift+Enter quebra linha; "@" sugere colegas.
 * Os arquivos sobem ANTES do envio (cada um com barra, cancelar e tentar de
 * novo) e a mensagem só sai quando todos terminaram — assim ninguém recebe
 * uma mensagem com anexo "pela metade".
 */
export const Composer = forwardRef<ComposerHandle, {
  conversationId: string;
  members: ChatMember[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (input: SendInput & { clientMessageId: string }) => void;
  placeholder: string;
}>(function Composer({ conversationId, members, replyTo, onCancelReply, onSend, placeholder }, ref) {
  const [texto, setTexto] = useState('');
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [mencionados, setMencionados] = useState<Map<string, string>>(new Map());
  const [sugestao, setSugestao] = useState<{ termo: string; inicio: number } | null>(null);
  const [indiceSugestao, setIndiceSugestao] = useState(0);
  const [emojisAbertos, setEmojisAbertos] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const politica = useAttachmentPolicy();
  // Cursor depois de inserir a menção: aplicado no MESMO commit que troca o
  // texto. Num requestAnimationFrame, a letra digitada nesse meio-tempo ia
  // parar no fim da frase.
  const cursorPendente = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (cursorPendente.current === null || !area.current) return;
    area.current.setSelectionRange(cursorPendente.current, cursorPendente.current);
    cursorPendente.current = null;
  }, [texto]);

  const candidatos = useMemo(() => {
    if (!sugestao) return [];
    const termo = sugestao.termo.toLocaleLowerCase('pt-BR');
    return members.filter((m) => !m.is_me && m.name.toLocaleLowerCase('pt-BR').includes(termo)).slice(0, 6);
  }, [sugestao, members]);

  function atualizarEnvio(key: string, mudanca: Partial<Envio>) {
    setEnvios((lista) => lista.map((e) => (e.key === key ? { ...e, ...mudanca } : e)));
  }

  function subir(envio: Envio) {
    const controller = new AbortController();
    atualizarEnvio(envio.key, { status: 'subindo', progress: 0, erro: undefined, controller });
    uploadChatAttachment(conversationId, envio.file, (p) => atualizarEnvio(envio.key, { progress: p }), controller.signal)
      .then((anexo) => atualizarEnvio(envio.key, { status: 'pronto', anexo, progress: 1 }))
      .catch((erro: Error) => {
        if (controller.signal.aborted) return;
        atualizarEnvio(envio.key, { status: 'erro', erro: erro.message });
      });
  }

  function validar(file: File): string | null {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const p = politica.data;
    if (p && !p.extensions.includes(ext)) return `.${ext || '?'} não é aceito aqui.`;
    const kind = KIND_POR_EXTENSAO[ext] ?? 'document';
    const limite = p?.max_bytes[kind];
    if (limite && file.size > limite) return `Acima do limite de ${tamanhoLegivel(limite)}.`;
    if (file.size === 0) return 'Arquivo vazio.';
    return null;
  }

  function addFiles(files: FileList | File[]) {
    const lista = Array.from(files);
    const vagas = MAX_ANEXOS - envios.length;
    const novos: Envio[] = lista.slice(0, Math.max(0, vagas)).map((file) => {
      const erro = validar(file);
      return { key: newClientMessageId(), file, progress: 0, status: erro ? 'erro' : 'subindo', erro: erro ?? undefined };
    });
    if (lista.length > vagas) {
      novos.push(...lista.slice(Math.max(0, vagas)).map((file) => ({ key: newClientMessageId(), file, progress: 0, status: 'erro' as const, erro: `Máximo de ${MAX_ANEXOS} arquivos por mensagem.` })));
    }
    setEnvios((atual) => [...atual, ...novos]);
    // Sobe depois de entrar no estado (atualizarEnvio procura pela key).
    queueMicrotask(() => novos.filter((n) => n.status === 'subindo').forEach(subir));
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => area.current?.focus() }));

  function remover(envio: Envio) {
    envio.controller?.abort();
    setEnvios((lista) => lista.filter((e) => e.key !== envio.key));
  }

  const subindo = envios.some((e) => e.status === 'subindo');
  const prontos = envios.filter((e) => e.status === 'pronto' && e.anexo).map((e) => e.anexo!);
  const podeEnviar = !subindo && (texto.trim().length > 0 || prontos.length > 0);

  function enviar() {
    if (!podeEnviar) return;
    const conteudo = texto.trim();
    const mentions = [...mencionados].filter(([, nome]) => conteudo.includes(`@${nome}`)).map(([id]) => id);
    onSend({
      clientMessageId: newClientMessageId(),
      content: conteudo,
      attachments: prontos,
      mentions,
      replyTo: replyTo ? { id: replyTo.id, sender_name: replyTo.sender_name, content: replyTo.content, deleted: replyTo.deleted } : null,
    });
    setTexto('');
    setMencionados(new Map());
    // Os que falharam ficam para a pessoa decidir; os enviados saem.
    setEnvios((lista) => lista.filter((e) => e.status === 'erro'));
    setSugestao(null);
    requestAnimationFrame(() => { if (area.current) area.current.style.height = ''; });
  }

  function aoDigitar(valor: string, cursor: number) {
    setTexto(valor);
    if (valor.trim()) notifyTyping(conversationId);
    const antes = valor.slice(0, cursor);
    const achado = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(antes);
    if (achado) { setSugestao({ termo: achado[2]!, inicio: cursor - achado[2]!.length - 1 }); setIndiceSugestao(0); }
    else setSugestao(null);
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; }
  }

  function escolher(membro: ChatMember) {
    if (!sugestao) return;
    const el = area.current;
    const cursor = el?.selectionStart ?? texto.length;
    const novo = `${texto.slice(0, sugestao.inicio)}@${membro.name} ${texto.slice(cursor)}`;
    setTexto(novo);
    setMencionados((m) => new Map(m).set(membro.id, membro.name));
    setSugestao(null);
    cursorPendente.current = sugestao.inicio + membro.name.length + 2;
    el?.focus();
  }

  return (
    // pr-20: a bolha do Bento flutua no canto inferior direito da tela e
    // cobria o botão de enviar.
    <div className="border-t border-grafite-elevado bg-grafite py-2.5 pl-3 pr-20">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-roxo-eletrico bg-grafite-elevado/60 px-3 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-roxo-eletrico">Respondendo a {replyTo.sender_name ?? 'colaborador'}</p>
            <p className="truncate text-xs text-nevoa">{replyTo.deleted ? 'Mensagem apagada' : replyTo.content || (replyTo.attachments.length ? 'Arquivo' : '')}</p>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancelar resposta" className="text-nevoa hover:text-branco-cru"><X size={14} /></button>
        </div>
      )}
      {envios.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Arquivos para enviar">
          {envios.map((e) => (
            <li key={e.key} className={cn('relative flex w-56 items-center gap-2 overflow-hidden rounded-md border bg-grafite-elevado/50 px-2 py-1.5', e.status === 'erro' ? 'border-erro/50' : 'border-grafite-elevado')}>
              <span className="text-nevoa"><IconeDoArquivo anexo={{ kind: KIND_POR_EXTENSAO[e.file.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'document', filename: e.file.name }} size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-branco-cru" title={e.file.name}>{e.file.name}</p>
                <p className={cn('truncate font-mono text-[10px]', e.status === 'erro' ? 'text-erro' : 'text-nevoa')} title={e.erro}>
                  {e.status === 'erro' ? e.erro : e.status === 'subindo' ? `${Math.round(e.progress * 100)}% · ${tamanhoLegivel(e.file.size)}` : tamanhoLegivel(e.file.size)}
                </p>
              </div>
              {e.status === 'erro' && !validar(e.file) && (
                <button type="button" onClick={() => subir(e)} aria-label={`Tentar enviar ${e.file.name} de novo`} className="text-nevoa hover:text-branco-cru"><RotateCcw size={13} /></button>
              )}
              <button type="button" onClick={() => remover(e)} aria-label={e.status === 'subindo' ? `Cancelar envio de ${e.file.name}` : `Remover ${e.file.name}`} className="text-nevoa hover:text-branco-cru"><X size={14} /></button>
              {e.status === 'subindo' && <span className="absolute bottom-0 left-0 h-0.5 bg-roxo-eletrico transition-[width]" style={{ width: `${Math.max(4, e.progress * 100)}%` }} />}
            </li>
          ))}
        </ul>
      )}
      <div className="relative flex items-end gap-1.5">
        {sugestao && candidatos.length > 0 && (
          <ul role="listbox" aria-label="Mencionar colega" className="absolute bottom-full left-10 z-20 mb-2 w-64 overflow-hidden rounded-lg border border-grafite-elevado bg-grafite shadow-2xl">
            {candidatos.map((m, i) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={i === indiceSugestao} onMouseDown={(ev) => { ev.preventDefault(); escolher(m); }} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', i === indiceSugestao ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa')}>
                  <span className={cn('size-2 rounded-full', m.online ? 'bg-sinal' : 'bg-nevoa/30')} />
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => seletor.current?.click()} aria-label="Anexar arquivo" title="Anexar arquivo" className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">
          <Paperclip size={18} />
        </button>
        <input
          ref={seletor}
          type="file"
          multiple
          hidden
          accept={politica.data?.extensions.map((e) => `.${e}`).join(',')}
          onChange={(ev) => { if (ev.target.files) addFiles(ev.target.files); ev.target.value = ''; }}
        />
        <div className="relative">
          <button type="button" onClick={() => setEmojisAbertos((v) => !v)} aria-label="Emojis" className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">
            <Smile size={18} />
          </button>
          {emojisAbertos && (
            <div className="absolute bottom-full left-0 z-20 mb-2 grid w-64 grid-cols-7 gap-0.5 rounded-lg border border-grafite-elevado bg-grafite p-2 shadow-2xl" role="dialog" aria-label="Emojis">
              {EMOJIS_RAPIDOS.map((e) => (
                <button key={e} type="button" onClick={() => { setTexto((t) => t + e); setEmojisAbertos(false); area.current?.focus(); }} className="rounded p-1 text-lg hover:bg-grafite-elevado">{e}</button>
              ))}
            </div>
          )}
        </div>
        <textarea
          ref={area}
          value={texto}
          rows={1}
          placeholder={placeholder}
          aria-label="Escreva uma mensagem"
          onChange={(ev) => aoDigitar(ev.target.value, ev.target.selectionStart)}
          onPaste={(ev) => { if (ev.clipboardData.files.length) { ev.preventDefault(); addFiles(ev.clipboardData.files); } }}
          onKeyDown={(ev) => {
            if (sugestao && candidatos.length) {
              if (ev.key === 'ArrowDown') { ev.preventDefault(); setIndiceSugestao((i) => (i + 1) % candidatos.length); return; }
              if (ev.key === 'ArrowUp') { ev.preventDefault(); setIndiceSugestao((i) => (i - 1 + candidatos.length) % candidatos.length); return; }
              if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); escolher(candidatos[indiceSugestao]!); return; }
              if (ev.key === 'Escape') { setSugestao(null); return; }
            }
            if (ev.key === 'Escape' && replyTo) { onCancelReply(); return; }
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); enviar(); }
          }}
          className="max-h-[200px] min-h-[36px] flex-1 resize-none rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={enviar}
          disabled={!podeEnviar}
          aria-label={subindo ? 'Aguardando arquivos' : 'Enviar'}
          title={subindo ? 'Aguardando os arquivos terminarem de subir' : 'Enviar (Enter)'}
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-roxo-eletrico text-branco-cru transition-opacity disabled:opacity-40"
        >
          {subindo ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
});
