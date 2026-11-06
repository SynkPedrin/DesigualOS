'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Code, Italic, Link2, List, Strikethrough } from 'lucide-react';

/**
 * BARRA DE FORMATAÇÃO SOBRE A SELEÇÃO (como no ClickUp): selecionou um trecho do campo — duplo clique
 * numa palavra, arrastando ou com Shift+setas — e aparece, logo acima, negrito, itálico, riscado, código,
 * link e lista. O campo continua sendo texto com a marcação que as telas já sabem mostrar (**negrito**,
 * _itálico_, ~~riscado~~, `código`, [nome](link), "- " lista), então nada muda em quem lê nem na
 * sincronização com o ClickUp.
 *
 * Funciona em qualquer <textarea> controlado sem mexer no estado de quem o usa: a troca do texto passa
 * por `insertText`, que dispara o mesmo evento de digitação (o onChange de React roda) e entra no Ctrl+Z.
 */

type Posicao = { x: number; y: number; abaixo: boolean };

/** Coordenadas (na tela) de uma posição do texto do textarea, medidas num clone invisível com o mesmo estilo. */
function coordenadas(el: HTMLTextAreaElement, pos: number): { x: number; y: number; altura: number } {
  const estilo = window.getComputedStyle(el);
  const clone = document.createElement('div');
  for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize'] as const) {
    clone.style[p] = estilo[p];
  }
  Object.assign(clone.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: estilo.wordBreak });
  clone.textContent = el.value.slice(0, pos);
  const marca = document.createElement('span');
  marca.textContent = el.value.slice(pos) || '.';
  clone.appendChild(marca);
  document.body.appendChild(clone);
  const caixa = el.getBoundingClientRect();
  const altura = parseFloat(estilo.lineHeight) || parseFloat(estilo.fontSize) * 1.4;
  const r = { x: caixa.left + marca.offsetLeft - el.scrollLeft, y: caixa.top + marca.offsetTop - el.scrollTop, altura };
  document.body.removeChild(clone);
  return r;
}

/** Troca o trecho [ini, fim) por `texto`, como se a pessoa tivesse digitado (onChange + desfazer). */
function substituir(el: HTMLTextAreaElement, ini: number, fim: number, texto: string) {
  el.focus();
  el.setSelectionRange(ini, fim);
  let ok = false;
  try { ok = document.execCommand('insertText', false, texto); } catch { ok = false; }
  if (!ok) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, el.value.slice(0, ini) + texto + el.value.slice(fim));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Seleção sem os espaços das pontas (o duplo clique no Windows leva o espaço depois da palavra). */
function selecaoAparada(el: HTMLTextAreaElement): [number, number] {
  let ini = el.selectionStart;
  let fim = el.selectionEnd;
  while (ini < fim && /\s/.test(el.value[ini]!)) ini++;
  while (fim > ini && /\s/.test(el.value[fim - 1]!)) fim--;
  return [ini, fim];
}

/** Envolve a seleção com a marcação; se ela já está envolvida, tira (clicar de novo desfaz). */
export function alternarMarcacao(el: HTMLTextAreaElement, antes: string, depois = antes) {
  const [ini, fim] = selecaoAparada(el);
  const v = el.value;
  const sel = v.slice(ini, fim);
  if (v.slice(ini - antes.length, ini) === antes && v.slice(fim, fim + depois.length) === depois) {
    substituir(el, ini - antes.length, fim + depois.length, sel);
    el.setSelectionRange(ini - antes.length, fim - antes.length);
    return;
  }
  if (sel.startsWith(antes) && sel.endsWith(depois) && sel.length >= antes.length + depois.length) {
    const miolo = sel.slice(antes.length, sel.length - depois.length);
    substituir(el, ini, fim, miolo);
    el.setSelectionRange(ini, ini + miolo.length);
    return;
  }
  substituir(el, ini, fim, `${antes}${sel}${depois}`);
  el.setSelectionRange(ini + antes.length, ini + antes.length + sel.length);
}

function linkar(el: HTMLTextAreaElement) {
  const [ini, fim] = selecaoAparada(el);
  const sel = el.value.slice(ini, fim);
  const ehEndereco = /^(https?:\/\/|www\.)\S+$/i.test(sel);
  const url = window.prompt('Endereço do link', ehEndereco ? sel : 'https://')?.trim();
  if (!url || url === 'https://') { el.focus(); return; }
  const href = /^(https?:\/\/|mailto:|\/)/i.test(url) ? url : `https://${url}`;
  const texto = `[${(sel || href).replace(/[[\]]/g, '')}](${href})`;
  substituir(el, ini, fim, texto);
  el.setSelectionRange(ini + texto.length, ini + texto.length);
}

function listar(el: HTMLTextAreaElement) {
  const v = el.value;
  const ini = v.lastIndexOf('\n', el.selectionStart - 1) + 1;
  const fim = el.selectionEnd;
  const linhas = v.slice(ini, fim).split('\n');
  const todasMarcadas = linhas.every((l) => /^\s*- /.test(l));
  const novo = linhas.map((l) => (todasMarcadas ? l.replace(/^(\s*)- /, '$1') : /^\s*- /.test(l) ? l : `- ${l}`)).join('\n');
  substituir(el, ini, fim, novo);
  el.setSelectionRange(ini, ini + novo.length);
}

const ACOES = [
  { rotulo: 'Negrito', atalho: 'B', icone: Bold, fazer: (el: HTMLTextAreaElement) => alternarMarcacao(el, '**') },
  { rotulo: 'Itálico', atalho: 'I', icone: Italic, fazer: (el: HTMLTextAreaElement) => alternarMarcacao(el, '_') },
  { rotulo: 'Riscado', atalho: 'Shift+X', icone: Strikethrough, fazer: (el: HTMLTextAreaElement) => alternarMarcacao(el, '~~') },
  { rotulo: 'Código', atalho: 'E', icone: Code, fazer: (el: HTMLTextAreaElement) => alternarMarcacao(el, '`') },
  { rotulo: 'Link', atalho: 'K', icone: Link2, fazer: linkar },
  { rotulo: 'Lista', atalho: 'Shift+8', icone: List, fazer: listar },
] as const;

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function BarraDeFormatacao({ alvo, atalhos = true }: { alvo: RefObject<HTMLTextAreaElement | null>; atalhos?: boolean }) {
  const [pos, setPos] = useState<Posicao | null>(null);

  const medir = useCallback(() => {
    const el = alvo.current;
    if (!el || document.activeElement !== el) { setPos(null); return; }
    const [ini, fim] = selecaoAparada(el);
    if (ini >= fim) { setPos(null); return; }
    const a = coordenadas(el, ini);
    const b = coordenadas(el, fim);
    const caixa = el.getBoundingClientRect();
    // Mesma linha: centro do trecho. Várias linhas: começo da seleção.
    const x = Math.abs(a.y - b.y) < 2 ? (a.x + b.x) / 2 : a.x;
    const y = Math.max(a.y, caixa.top);
    const abaixo = y < 56;
    setPos({ x: Math.min(Math.max(x, caixa.left + 8), caixa.right - 8), y: abaixo ? Math.min(b.y + b.altura, caixa.bottom) + 6 : y - 6, abaixo });
  }, [alvo]);

  useEffect(() => {
    const el = alvo.current;
    if (!el) return;
    const depois = () => requestAnimationFrame(medir);
    const sumir = () => setPos(null);
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPos(null); return; }
      if (!atalhos || !(MAC ? e.metaKey : e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      const acao = k === 'b' ? ACOES[0] : k === 'i' ? ACOES[1] : k === 'x' && e.shiftKey ? ACOES[2] : k === 'e' ? ACOES[3] : k === 'k' ? ACOES[4] : e.shiftKey && e.code === 'Digit8' ? ACOES[5] : null;
      if (!acao) return;
      e.preventDefault();
      acao.fazer(el);
      depois();
    };
    const mudouSelecao = () => { if (document.activeElement === el) depois(); };
    el.addEventListener('mouseup', depois);
    el.addEventListener('dblclick', depois);
    el.addEventListener('keyup', depois);
    el.addEventListener('select', depois);
    el.addEventListener('input', depois);
    el.addEventListener('scroll', sumir);
    el.addEventListener('blur', sumir);
    el.addEventListener('keydown', tecla);
    document.addEventListener('selectionchange', mudouSelecao);
    window.addEventListener('resize', sumir);
    window.addEventListener('scroll', sumir, true);
    return () => {
      el.removeEventListener('mouseup', depois);
      el.removeEventListener('dblclick', depois);
      el.removeEventListener('keyup', depois);
      el.removeEventListener('select', depois);
      el.removeEventListener('input', depois);
      el.removeEventListener('scroll', sumir);
      el.removeEventListener('blur', sumir);
      el.removeEventListener('keydown', tecla);
      document.removeEventListener('selectionchange', mudouSelecao);
      window.removeEventListener('resize', sumir);
      window.removeEventListener('scroll', sumir, true);
    };
  }, [alvo, atalhos, medir]);

  if (!pos) return null;
  const mod = MAC ? '⌘' : 'Ctrl+';
  return createPortal(
    <div
      role="toolbar"
      aria-label="Formatar o texto selecionado"
      // mousedown sem efeito: o campo não perde o foco nem a seleção ao clicar nos botões.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-[80] flex items-center gap-0.5 rounded-lg border border-grafite-elevado bg-grafite p-1 shadow-elevated"
      style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.abaixo ? '0' : '-100%'})` }}
    >
      {ACOES.map((a) => (
        <button
          key={a.rotulo}
          type="button"
          aria-label={a.rotulo}
          title={`${a.rotulo} (${mod}${a.atalho})`}
          onClick={() => { const el = alvo.current; if (el) { a.fazer(el); requestAnimationFrame(medir); } }}
          className="flex size-7 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite-elevado hover:text-branco-cru"
        >
          <a.icone size={15} />
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * <textarea> com a barra de formatação embutida: troca `<textarea` por `<TextareaFormatavel` e pronto.
 * `ref` continua funcionando para quem já guardava o campo (foco, cursor das menções…).
 */
export function TextareaFormatavel({ ref, atalhos = true, ...props }: React.ComponentProps<'textarea'> & { atalhos?: boolean }) {
  const proprio = useRef<HTMLTextAreaElement | null>(null);
  const juntar = useCallback((el: HTMLTextAreaElement | null) => {
    proprio.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  }, [ref]);
  return (
    <>
      <textarea ref={juntar} {...props} />
      <BarraDeFormatacao alvo={proprio} atalhos={atalhos} />
    </>
  );
}
