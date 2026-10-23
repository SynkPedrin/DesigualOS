'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Info, X } from 'lucide-react';
import { ApiRequestError } from '@/lib/api/client';
import { AVISO_HISTORICO_PARCIAL, centavosDeTexto, centavosParaCampo, formatarCentavos, SITUACAO, ValorInvalido } from '@/lib/gestao-empresarial/formato';
import { cn } from '@/lib/utils';

/** A mensagem que a API mandou, em português; ou uma frase honesta quando nem chegou a responder. */
export function mensagemDeErro(e: unknown, padrao = 'Não foi possível concluir.'): string {
  return e instanceof ApiRequestError ? e.message : padrao;
}

export const CAMPO = 'w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/60 focus:border-sinal focus:outline-none disabled:opacity-50';
export const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
export const BOTAO_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa transition-colors hover:border-nevoa hover:text-branco-cru disabled:cursor-not-allowed disabled:opacity-50';
export const BOTAO_PERIGO = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50';

/** Aviso fixo na tela. `erro` fala de algo que falhou; `aviso` de algo que o usuário precisa ler antes de confiar no número. */
export function Aviso({ tom = 'info', titulo, children }: { tom?: 'info' | 'aviso' | 'erro'; titulo?: string; children?: React.ReactNode }) {
  // Texto SEMPRE na cor principal do tema (legível no claro e no escuro); só a borda, o fundo e o ícone carregam o tom.
  const estilo = { info: 'border-roxo-eletrico/40 bg-roxo-eletrico/10', aviso: 'border-aviso/50 bg-aviso/15', erro: 'border-red-500/50 bg-red-500/10' }[tom];
  const iconeCor = { info: 'text-roxo-eletrico', aviso: 'text-aviso', erro: 'text-red-500' }[tom];
  const Icone = tom === 'info' ? Info : AlertTriangle;
  return (
    <div role={tom === 'erro' ? 'alert' : 'note'} className={cn('flex gap-2 rounded-lg border px-3 py-2.5 text-sm text-branco-cru', estilo)}>
      <Icone size={16} className={cn('mt-0.5 shrink-0', iconeCor)} aria-hidden />
      <div className="min-w-0">
        {titulo && <p className="font-medium">{titulo}</p>}
        {children && <div className={cn(titulo && 'mt-0.5 text-[13px]', '[&_a]:font-medium [&_a]:underline')}>{children}</div>}
      </div>
    </div>
  );
}

/** O aviso obrigatório quando o histórico financeiro é parcial. O texto é o da especificação, sem paráfrase. */
export function AvisoHistoricoParcial() {
  return <Aviso tom="aviso">{AVISO_HISTORICO_PARCIAL}</Aviso>;
}

export interface Aba {
  href: string;
  rotulo: string;
}

/** Sub-navegação de uma seção do módulo. O item ativo é o de endereço mais específico que casa. */
export function SubNav({ abas, rotulo }: { abas: Aba[]; rotulo: string }) {
  const pathname = usePathname();
  const ativa = [...abas].sort((a, b) => b.href.length - a.href.length).find((a) => pathname === a.href || pathname.startsWith(`${a.href}/`))?.href;
  return (
    <nav aria-label={rotulo} className="flex flex-wrap gap-1">
      {abas.map((a) => (
        <Link key={a.href} href={a.href} aria-current={ativa === a.href ? 'page' : undefined} className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', ativa === a.href ? 'bg-grafite-elevado font-medium text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}

export function Selo({ children, classe }: { children: React.ReactNode; classe?: string }) {
  return <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', classe ?? 'bg-grafite-elevado text-nevoa')}>{children}</span>;
}

export function SeloDeSituacao({ situacao }: { situacao: string }) {
  const s = SITUACAO[situacao] ?? { rotulo: situacao, classe: 'bg-grafite-elevado text-nevoa' };
  return <Selo classe={s.classe}>{s.rotulo}</Selo>;
}

/** Valor em reais, alinhado para somar de cabeça. Negativo em vermelho. */
export function Dinheiro({ centavos, className }: { centavos: number | null | undefined; className?: string }) {
  if (centavos === null || centavos === undefined) return <span className={cn('text-nevoa/60', className)}>—</span>;
  return <span className={cn('tabular-nums', centavos < 0 && 'text-red-500', className)}>{formatarCentavos(centavos)}</span>;
}

export const TH = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-nevoa';
export const TH_DIREITA = `${TH} text-right`;
export const TD = 'px-3 py-2.5 align-middle';

/** Moldura de tabela: rola na horizontal em tela estreita em vez de espremer as colunas. */
export function Tabela({ children, legenda }: { children: React.ReactNode; legenda: string }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-grafite-elevado bg-grafite">
      <table className="w-full min-w-[640px] text-sm text-branco-cru">
        <caption className="sr-only">{legenda}</caption>
        {children}
      </table>
    </div>
  );
}

export function Paginacao({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const de = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const ate = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-nevoa">
      <span aria-live="polite">{total === 0 ? 'Nenhum registro' : `${de}–${ate} de ${total}`}</span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)} className={cn(BOTAO_SECUNDARIO, 'px-2 py-1')}><ChevronLeft size={14} /></button>
        <span className="px-2 tabular-nums">{page} / {totalPages}</span>
        <button type="button" aria-label="Próxima página" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={cn(BOTAO_SECUNDARIO, 'px-2 py-1')}><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

export function Campo({ rotulo, ajuda, erro, children }: { rotulo: string; ajuda?: string | undefined; erro?: string | null | undefined; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode }) {
  const id = useId();
  const nota = erro ? `${id}-erro` : ajuda ? `${id}-ajuda` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-nevoa">{rotulo}</label>
      {children({ id, ...(nota && { 'aria-describedby': nota }), ...(erro && { 'aria-invalid': true }) })}
      {erro ? <p id={`${id}-erro`} className="text-xs text-red-400">{erro}</p> : ajuda ? <p id={`${id}-ajuda`} className="text-xs text-nevoa/70">{ajuda}</p> : null}
    </div>
  );
}

/**
 * Campo de dinheiro. Guarda o TEXTO que a pessoa digita e só entrega centavos inteiros (nunca float)
 * a quem usa; texto inválido entrega `null` e mostra o motivo. O valor inicial vem em centavos.
 */
export function CampoDinheiro({ rotulo, centavos, onChange, obrigatorio = false, ajuda, desabilitado }: { rotulo: string; centavos: number | null; onChange: (c: number | null) => void; obrigatorio?: boolean; ajuda?: string; desabilitado?: boolean }) {
  const [texto, setTexto] = useState(centavos === null ? '' : centavosParaCampo(centavos));
  const [erro, setErro] = useState<string | null>(null);
  function mudou(novo: string) {
    setTexto(novo);
    if (novo.trim() === '') {
      setErro(obrigatorio ? 'Informe um valor.' : null);
      onChange(null);
      return;
    }
    try {
      onChange(centavosDeTexto(novo));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ValorInvalido ? e.message : 'Valor inválido.');
      onChange(null);
    }
  }
  return (
    <Campo rotulo={rotulo} ajuda={ajuda} erro={erro}>
      {(p) => <input {...p} inputMode="decimal" autoComplete="off" placeholder="0,00" value={texto} disabled={desabilitado} onChange={(e) => mudou(e.target.value)} className={cn(CAMPO, 'tabular-nums')} />}
    </Campo>
  );
}

/** Diálogo modal acessível: foco entra, Esc fecha, clique fora não perde o que foi digitado. */
export function Dialogo({ titulo, onFechar, children, largura = 'max-w-lg' }: { titulo: string; onFechar: () => void; children: React.ReactNode; largura?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-fechar])')?.focus();
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus();
    };
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-carbono/80 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby={tituloId}>
      <div ref={ref} className={cn('w-full rounded-lg border border-grafite-elevado bg-grafite p-5 shadow-elevated', largura)}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={tituloId} className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">{titulo}</h2>
          <button type="button" data-fechar aria-label="Fechar" onClick={onFechar} className="rounded p-1 text-nevoa hover:text-branco-cru"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Carregando({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-md bg-grafite-elevado/60" />)}
    </div>
  );
}

/** Tela vazia que diz o que fazer, e não só que está vazio. */
export function Vazio({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-grafite-elevado px-6 py-12 text-center">
      <p className="font-heading text-base font-semibold text-branco-cru">{titulo}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-nevoa">{children}</div>}
    </div>
  );
}
