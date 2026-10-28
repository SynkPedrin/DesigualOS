'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bold, Building2, CheckSquare, ClipboardList, Code, Italic, List, Loader2, Paperclip, Plus, RotateCcw, Send, Smile, SquareCode, Strikethrough, X } from 'lucide-react';
import {
  newClientMessageId,
  notifyTyping,
  uploadChatAttachment,
  useAttachmentPolicy,
  type ChatAttachment,
  type ChatMember,
  type ChatMessage,
  type ObjectToShare,
  type SendInput,
} from '@/hooks/use-internal-chat';
import { IconeDoArquivo, tamanhoLegivel } from './anexos';
import { EscolherItem, Modal, type TipoEscolhivel } from './modais';
import { cn } from '@/lib/utils';
import { useDailyTasksAccess } from '@/hooks/use-daily-tasks-access';
import { CriarTarefaDaily } from '@/components/daily-tasks/criar-tarefa-da-mensagem';

const KIND_POR_EXTENSAO: Record<string, ChatAttachment['kind']> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  mp4: 'video', mov: 'video', webm: 'video', zip: 'archive',
};
const MAX_ANEXOS = 10;
const MAX_OBJETOS = 5;
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

export interface ComposerHandle { addFiles: (files: FileList | File[]) => void; focus: () => void; addObject: (o: ObjectToShare) => void }

/** Rascunho por conversa (e por thread): sobrevive a trocar de tela e recarregar. */
function chaveDoRascunho(conversationId: string, threadRootId?: string | null) {
  return `desigual-os:rascunho:${conversationId}:${threadRootId ?? 'principal'}`;
}
function lerRascunho(chave: string): string {
  try { return localStorage.getItem(chave) ?? ''; } catch { return ''; }
}
function gravarRascunho(chave: string, texto: string) {
  try { if (texto) localStorage.setItem(chave, texto); else localStorage.removeItem(chave); } catch { /* sem armazenamento: só não lembra */ }
}

const FORMATOS = [
  { rotulo: 'Negrito', icone: Bold, antes: '**', depois: '**' },
  { rotulo: 'Itálico', icone: Italic, antes: '_', depois: '_' },
  { rotulo: 'Riscado', icone: Strikethrough, antes: '~~', depois: '~~' },
  { rotulo: 'Código', icone: Code, antes: '`', depois: '`' },
  { rotulo: 'Bloco de código', icone: SquareCode, antes: '```\n', depois: '\n```' },
] as const;

/**
 * Caixa de escrever. Enter envia, Shift+Enter quebra linha; "@" sugere colegas.
 * Os arquivos sobem ANTES do envio (cada um com barra, cancelar e tentar de
 * novo) e a mensagem só sai quando todos terminaram — assim ninguém recebe
 * uma mensagem com anexo "pela metade". "+" compartilha itens da operação.
 */
export const Composer = forwardRef<ComposerHandle, {
  conversationId: string;
  members: ChatMember[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (input: SendInput & { clientMessageId: string }) => void;
  placeholder: string;
  threadRootId?: string | null;
  /** Texto do aviso quando não dá para escrever (canal arquivado). */
  readOnly?: string | null;
  compacto?: boolean;
}>(function Composer({ conversationId, members, replyTo, onCancelReply, onSend, placeholder, threadRootId = null, readOnly = null, compacto = false }, ref) {
  const chaveRascunho = chaveDoRascunho(conversationId, threadRootId);
  const [texto, setTexto] = useState(() => (typeof window === 'undefined' ? '' : lerRascunho(chaveRascunho)));
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [objetos, setObjetos] = useState<ObjectToShare[]>([]);
  const [mencionados, setMencionados] = useState<Map<string, string>>(new Map());
  const [sugestao, setSugestao] = useState<{ termo: string; inicio: number } | null>(null);
  const [indiceSugestao, setIndiceSugestao] = useState(0);
  const [emojisAbertos, setEmojisAbertos] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);
  const [escolhendo, setEscolhendo] = useState<TipoEscolhivel | null>(null);
  const [criandoTarefa, setCriandoTarefa] = useState(false);
  const daily = useDailyTasksAccess().data?.allowed === true;
  const area = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const politica = useAttachmentPolicy();
  // Cursor depois de inserir a menção/formatação: aplicado no MESMO commit que
  // troca o texto. Num requestAnimationFrame, a letra digitada nesse meio-tempo
  // ia parar no fim da frase.
  const cursorPendente = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (cursorPendente.current === null || !area.current) return;
    area.current.setSelectionRange(cursorPendente.current[0], cursorPendente.current[1]);
    cursorPendente.current = null;
  }, [texto]);

  // Trocou de conversa/thread: carrega o rascunho dela.
  useEffect(() => { setTexto(lerRascunho(chaveRascunho)); setObjetos([]); }, [chaveRascunho]);
  useEffect(() => { gravarRascunho(chaveRascunho, texto); }, [chaveRascunho, texto]);

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
    if (readOnly) return;
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

  function addObject(o: ObjectToShare) {
    setObjetos((lista) => (lista.length >= MAX_OBJETOS || lista.some((x) => x.type === o.type && x.id === o.id) ? lista : [...lista, o]));
    area.current?.focus();
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => area.current?.focus(), addObject }));

  function remover(envio: Envio) {
    envio.controller?.abort();
    setEnvios((lista) => lista.filter((e) => e.key !== envio.key));
  }

  const subindo = envios.some((e) => e.status === 'subindo');
  const prontos = envios.filter((e) => e.status === 'pronto' && e.anexo).map((e) => e.anexo!);
  const podeEnviar = !readOnly && !subindo && (texto.trim().length > 0 || prontos.length > 0 || objetos.length > 0);

  function enviar() {
    if (!podeEnviar) return;
    const conteudo = texto.trim();
    const mentions = [...mencionados].filter(([, nome]) => conteudo.includes(`@${nome}`)).map(([id]) => id);
    onSend({
      clientMessageId: newClientMessageId(),
      content: conteudo,
      attachments: prontos,
      mentions,
      objects: objetos,
      threadRootId,
      replyTo: replyTo ? { id: replyTo.id, sender_name: replyTo.sender_name, content: replyTo.content, deleted: replyTo.deleted } : null,
    });
    setTexto('');
    setObjetos([]);
    setMencionados(new Map());
    // Os que falharam ficam para a pessoa decidir; os enviados saem.
    setEnvios((lista) => lista.filter((e) => e.status === 'erro'));
    setSugestao(null);
    requestAnimationFrame(() => { if (area.current) area.current.style.height = ''; });
  }

  function ajustarAltura() {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 240)}px`; }
  }

  function aoDigitar(valor: string, cursor: number) {
    setTexto(valor);
    if (valor.trim()) notifyTyping(conversationId, threadRootId);
    const antes = valor.slice(0, cursor);
    const achado = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(antes);
    if (achado) { setSugestao({ termo: achado[2]!, inicio: cursor - achado[2]!.length - 1 }); setIndiceSugestao(0); }
    else setSugestao(null);
    ajustarAltura();
  }

  function escolher(membro: ChatMember) {
    if (!sugestao) return;
    const el = area.current;
    const cursor = el?.selectionStart ?? texto.length;
    const novo = `${texto.slice(0, sugestao.inicio)}@${membro.name} ${texto.slice(cursor)}`;
    setTexto(novo);
    setMencionados((m) => new Map(m).set(membro.id, membro.name));
    setSugestao(null);
    const pos = sugestao.inicio + membro.name.length + 2;
    cursorPendente.current = [pos, pos];
    el?.focus();
  }

  /** Envolve a seleção (ou insere o par vazio) com a marcação do formato. */
  function formatar(antes: string, depois: string) {
    const el = area.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const selecionado = texto.slice(ini, fim);
    setTexto(`${texto.slice(0, ini)}${antes}${selecionado}${depois}${texto.slice(fim)}`);
    cursorPendente.current = [ini + antes.length, ini + antes.length + selecionado.length];
    el?.focus();
    requestAnimationFrame(ajustarAltura);
  }

  function lista() {
    const el = area.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const inicioDaLinha = texto.lastIndexOf('\n', ini - 1) + 1;
    const trecho = texto.slice(inicioDaLinha, fim);
    const novo = trecho.split('\n').map((l) => (/^\s*- /.test(l) ? l : `- ${l}`)).join('\n');
    setTexto(`${texto.slice(0, inicioDaLinha)}${novo}${texto.slice(fim)}`);
    const pos = inicioDaLinha + novo.length;
    cursorPendente.current = [pos, pos];
    el?.focus();
  }

  if (readOnly) {
    return <div className="border-t border-grafite-elevado bg-grafite px-4 py-3 text-center text-sm text-nevoa">{readOnly}</div>;
  }

  const ICONE_DO_TIPO = { task: CheckSquare, client: Building2, demand: ClipboardList } as Record<string, typeof CheckSquare>;

  return (
    // pr-20: a bolha do Bento flutua no canto inferior direito da tela e
    // cobria o botão de enviar — inclusive no painel da thread, que fica colado
    // na borda direita.
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
      {objetos.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Itens para compartilhar">
          {objetos.map((o) => {
            const Icone = ICONE_DO_TIPO[o.type] ?? CheckSquare;
            return (
              <li key={`${o.type}:${o.id}`} className="flex max-w-xs items-center gap-2 rounded-md border border-roxo-eletrico/40 bg-roxo-eletrico/10 px-2 py-1 text-xs text-branco-cru">
                <Icone size={13} className="shrink-0 text-roxo-eletrico" />
                <span className="truncate">{o.label ?? o.id}</span>
                <button type="button" onClick={() => setObjetos((l) => l.filter((x) => x !== o))} aria-label={`Tirar ${o.label ?? 'item'}`} className="text-nevoa hover:text-branco-cru"><X size={12} /></button>
              </li>
            );
          })}
        </ul>
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
      <div className="mb-1 flex items-center gap-0.5" role="toolbar" aria-label="Formatação">
        {FORMATOS.map((f) => (
          <button key={f.rotulo} type="button" onClick={() => formatar(f.antes, f.depois)} aria-label={f.rotulo} title={f.rotulo} className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><f.icone size={14} /></button>
        ))}
        <button type="button" onClick={lista} aria-label="Lista" title="Lista" className="flex size-7 items-center justify-center rounded text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><List size={14} /></button>
        {!compacto && <span className="ml-auto hidden truncate font-mono text-[10px] text-nevoa/60 2xl:inline">Enter envia · Shift+Enter quebra linha</span>}
      </div>
      <div className="relative flex items-end gap-1.5">
        {sugestao && candidatos.length > 0 && (
          <ul role="listbox" aria-label="Mencionar colega" className="absolute bottom-full left-10 z-20 mb-2 w-64 overflow-hidden rounded-lg border border-grafite-elevado bg-grafite shadow-2xl">
            {candidatos.map((m, i) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={i === indiceSugestao} onMouseDown={(ev) => { ev.preventDefault(); escolher(m); }} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', i === indiceSugestao ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa')}>
                  <span className={cn('size-2 rounded-full', m.presence === 'online' || m.online ? 'bg-sinal' : m.presence === 'away' ? 'bg-aviso' : 'bg-nevoa/30')} />
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative">
          <button type="button" onClick={() => setMaisAberto((v) => !v)} aria-label="Mais opções" aria-expanded={maisAberto} title="Anexar ou compartilhar" data-tour-id="comunicacao-anexos" className="flex size-9 shrink-0 items-center justify-center rounded-md text-nevoa hover:bg-grafite-elevado hover:text-branco-cru">
            <Plus size={18} />
          </button>
          {maisAberto && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-lg border border-grafite-elevado bg-grafite py-1 shadow-2xl" role="menu" data-tour-id="comunicacao-compartilhar">
              {([
                ['Anexar arquivo', Paperclip, () => seletor.current?.click()],
                ...(daily && !readOnly ? ([['Criar tarefa no Daily Tasks', Plus, () => setCriandoTarefa(true)]] as const) : []),
                ['Compartilhar tarefa', CheckSquare, () => setEscolhendo('task')],
                ['Compartilhar cliente', Building2, () => setEscolhendo('client')],
                ['Compartilhar quinzena', ClipboardList, () => setEscolhendo('demand')],
              ] as const).map(([rotulo, Icone, acao]) => (
                <button key={rotulo} type="button" role="menuitem" onClick={() => { setMaisAberto(false); acao(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-branco-cru hover:bg-grafite-elevado">
                  <Icone size={15} className="text-nevoa" /> {rotulo}
                </button>
              ))}
            </div>
          )}
        </div>
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
          aria-label={threadRootId ? 'Responder na thread' : 'Escreva uma mensagem'}
          onChange={(ev) => aoDigitar(ev.target.value, ev.target.selectionStart)}
          onPaste={(ev) => { if (ev.clipboardData.files.length) { ev.preventDefault(); addFiles(ev.clipboardData.files); } }}
          onKeyDown={(ev) => {
            if (sugestao && candidatos.length) {
              if (ev.key === 'ArrowDown') { ev.preventDefault(); setIndiceSugestao((i) => (i + 1) % candidatos.length); return; }
              if (ev.key === 'ArrowUp') { ev.preventDefault(); setIndiceSugestao((i) => (i - 1 + candidatos.length) % candidatos.length); return; }
              if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); escolher(candidatos[indiceSugestao]!); return; }
              if (ev.key === 'Escape') { setSugestao(null); return; }
            }
            if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'b') { ev.preventDefault(); formatar('**', '**'); return; }
            if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'i') { ev.preventDefault(); formatar('_', '_'); return; }
            if (ev.key === 'Escape' && replyTo) { onCancelReply(); return; }
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); enviar(); }
          }}
          className="max-h-[240px] min-h-[36px] flex-1 resize-none rounded-md border border-grafite-elevado bg-carbono/40 px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
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
      {criandoTarefa && (
        <Modal titulo="Criar tarefa no Daily Tasks" onClose={() => setCriandoTarefa(false)} largura="max-w-lg">
          <div className="p-4"><CriarTarefaDaily conversationId={conversationId} senderName={null} texto={texto} anexos={envios.filter((e) => e.status === 'pronto' && e.anexo).map((e) => ({ id: e.anexo!.id, filename: e.anexo!.filename }))} onClose={() => setCriandoTarefa(false)} /></div>
        </Modal>
      )}
      {escolhendo && <EscolherItem tipo={escolhendo} onClose={() => setEscolhendo(null)} onPick={(o) => { addObject(o); setEscolhendo(null); }} />}
    </div>
  );
});
