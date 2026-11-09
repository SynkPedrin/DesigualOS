'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { Extension, useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { Bold, Code, Italic, Link2, List, Strikethrough } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EDITOR DE TEXTO QUE FORMATA ENQUANTO SE DIGITA (como no ClickUp): negrito aparece negrito, link aparece
 * azul, lista vira lista — antes de enviar. Selecionou um trecho, aparece a barra (negrito, itálico,
 * riscado, código, link, lista); ⌘/Ctrl+B, I, K e Shift+X também funcionam.
 *
 * Por fora continua sendo TEXTO EM MARKDOWN, igual à caixa de antes: entra `value`, sai `onChange(texto)`.
 * Nada muda em quem lê (TextoRico, TextoFormatado), no banco nem na ida para o ClickUp.
 */

export type FormatoDoEditor = 'negrito' | 'italico' | 'riscado' | 'codigo' | 'bloco' | 'lista' | 'link';

export type EditorRicoHandle = {
  focus: (onde?: 'inicio' | 'fim') => void;
  /** Insere texto puro no cursor (emoji, menção). */
  inserir: (texto: string) => void;
  /** Texto do parágrafo atual até o cursor (para achar o "@nome" sendo digitado). */
  antesDoCursor: () => string;
  /** Troca os `quantos` caracteres antes do cursor por `texto` (completar a menção). */
  trocarAntesDoCursor: (quantos: number, texto: string) => void;
  formatar: (f: FormatoDoEditor) => void;
};

// Menção da tarefa (@[Nome](uuid)) passa pelo editor como link de protocolo próprio e volta igual.
const MENCAO = /@\[([^\]\n]+)\]\(([0-9a-f-]{36})\)/gi;
const deMarkdown = (md: string) => md.replace(MENCAO, '[@$1](mencao:$2)');

/** Markdown que o editor gera → o mesmo jeito que as pessoas e o ClickUp escrevem. */
export function paraTexto(md: string): string {
  return md
    .replace(/\[@([^\]\n]+)\]\(mencao:([0-9a-f-]{36})\)/gi, '@[$1]($2)')
    // link solto sai solto, não [url](url)
    .replace(/\[([^\]\n]+)\]\((\S+?)\)/g, (tudo, rotulo: string, url: string) => (rotulo === url ? url : tudo))
    // escape só onde ele importa: "arquivo_final" e "2*3" não precisam de barra
    .replace(/(\w)\\([_*])(?=\w)/g, '$1$2')
    // quebra de linha (Shift+Enter) sai como quebra simples
    .replace(/ {2}\n/g, '\n')
    .replace(/\s+$/, '');
}

function aplicar(editor: Editor, f: FormatoDoEditor) {
  const c = editor.chain().focus();
  if (f === 'negrito') c.toggleBold().run();
  else if (f === 'italico') c.toggleItalic().run();
  else if (f === 'riscado') c.toggleStrike().run();
  else if (f === 'codigo') c.toggleCode().run();
  else if (f === 'bloco') c.toggleCodeBlock().run();
  else if (f === 'lista') c.toggleBulletList().run();
  else {
    const atual = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Endereço do link (vazio tira o link)', atual ?? 'https://');
    if (url === null) { editor.commands.focus(); return; }
    const limpo = url.trim();
    if (!limpo || limpo === 'https://') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    const href = /^(https?:\/\/|mailto:|\/)/i.test(limpo) ? limpo : `https://${limpo}`;
    if (editor.state.selection.empty && !atual) editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
}

const BOTOES: Array<{ f: FormatoDoEditor; rotulo: string; icone: typeof Bold; ativo: string }> = [
  { f: 'negrito', rotulo: 'Negrito', icone: Bold, ativo: 'bold' },
  { f: 'italico', rotulo: 'Itálico', icone: Italic, ativo: 'italic' },
  { f: 'riscado', rotulo: 'Riscado', icone: Strikethrough, ativo: 'strike' },
  { f: 'codigo', rotulo: 'Código', icone: Code, ativo: 'code' },
  { f: 'link', rotulo: 'Link', icone: Link2, ativo: 'link' },
  { f: 'lista', rotulo: 'Lista', icone: List, ativo: 'bulletList' },
];

export function EditorRico({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  autoFocus = false,
  onEnviar,
  onTecla,
  onColarArquivos,
  ref,
}: {
  value: string;
  onChange: (texto: string) => void;
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
  autoFocus?: boolean | undefined;
  /** Com isto, Enter envia e Shift+Enter quebra a linha (chat). Sem, Enter é parágrafo novo (descrição). */
  onEnviar?: (() => void) | undefined;
  /** Vê a tecla antes do editor; devolver true para o editor não fazer nada (navegar sugestões de menção). */
  onTecla?: ((e: KeyboardEvent) => boolean | void) | undefined;
  onColarArquivos?: ((arquivos: File[]) => void) | undefined;
  ref?: Ref<EditorRicoHandle> | undefined;
}) {
  // As funções mudam a cada render; o editor é criado uma vez e lê sempre a versão atual.
  const props = useRef({ onChange, onEnviar, onTecla, onColarArquivos });
  props.current = { onChange, onEnviar, onTecla, onColarArquivos };
  const ultimo = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        underline: false,
        blockquote: false,
        link: {
          autolink: true,
          linkOnPaste: true,
          openOnClick: false,
          defaultProtocol: 'https',
          protocols: ['mencao'],
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer', class: null },
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown,
      Extension.create({
        name: 'enviarComEnter',
        priority: 1000,
        addKeyboardShortcuts() {
          const enviar = () => {
            const fn = props.current.onEnviar;
            if (!fn) return false;
            fn();
            return true;
          };
          return {
            Enter: ({ editor: ed }) => (ed.isActive('bulletList') || ed.isActive('orderedList') || ed.isActive('codeBlock') ? false : enviar()),
            'Mod-Enter': enviar,
          };
        },
      }),
    ],
    content: deMarkdown(value),
    contentType: 'markdown',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'editor-rico-conteudo',
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handleKeyDown: (_view, e) => props.current.onTecla?.(e) === true,
      handlePaste: (_view, e) => {
        const arquivos = Array.from(e.clipboardData?.files ?? []);
        if (!arquivos.length || !props.current.onColarArquivos) return false;
        props.current.onColarArquivos(arquivos);
        return true;
      },
      // Link dentro do editor abre com ⌘/Ctrl+clique (clique simples é para editar o texto).
      handleClick: (_view, _pos, e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a && (e.metaKey || e.ctrlKey) && /^https?:/i.test(a.href)) { window.open(a.href, '_blank', 'noopener,noreferrer'); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const texto = paraTexto(ed.getMarkdown());
      ultimo.current = texto;
      props.current.onChange(texto);
    },
  });

  // Mudou por fora (enviou e limpou, trocou de conversa, inseriu menção pelo seletor): recarrega.
  useEffect(() => {
    if (!editor || value === ultimo.current) return;
    ultimo.current = value;
    editor.commands.setContent(deMarkdown(value), { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  useImperativeHandle(ref, () => ({
    focus: (onde = 'fim') => { editor?.commands.focus(onde === 'inicio' ? 'start' : 'end'); },
    inserir: (texto) => { editor?.chain().focus().insertContent(texto).run(); },
    antesDoCursor: () => {
      if (!editor) return '';
      const { $from } = editor.state.selection;
      return $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    },
    trocarAntesDoCursor: (quantos, texto) => {
      if (!editor) return;
      const de = editor.state.selection.from;
      editor.chain().focus().insertContentAt({ from: Math.max(0, de - quantos), to: de }, texto).run();
    },
    formatar: (f) => { if (editor) aplicar(editor, f); },
  }), [editor]);

  return (
    <div className={cn('editor-rico cursor-text', className)} onClick={(e) => { if (e.target === e.currentTarget) editor?.commands.focus('end'); }}>
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu
          editor={editor}
          // Na página, não dentro do campo: gaveta e caixa com rolagem cortariam a barra.
          appendTo={() => document.body}
          options={{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }}
          shouldShow={({ editor: ed, from, to }) => from !== to && ed.isFocused}
          className="z-[80] flex items-center gap-0.5 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated"
        >
          {BOTOES.map((b) => (
            <button
              key={b.f}
              type="button"
              aria-label={b.rotulo}
              title={b.rotulo}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => aplicar(editor, b.f)}
              className={cn('flex size-7 items-center justify-center rounded-md transition-colors hover:bg-grafite-elevado hover:text-branco-cru', editor.isActive(b.ativo) ? 'bg-roxo-eletrico/20 text-branco-cru' : 'text-nevoa')}
            >
              <b.icone size={15} />
            </button>
          ))}
        </BubbleMenu>
      )}
    </div>
  );
}
