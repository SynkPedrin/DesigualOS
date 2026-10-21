'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { registrarEventoDoAnuncio, type EventoDoAnuncio } from '@/hooks/use-announcements';
import { TOURS, type EtapaDoTour, type Tour } from './tours';
import { cn } from '@/lib/utils';

/**
 * MOTOR DOS TUTORIAIS GUIADOS. Um por vez, para a área logada inteira (mora no
 * AppShell). Quem quer abrir um tutorial chama `useTour().iniciar(id)`.
 *
 * O que ele garante:
 *  - navega até a rota de cada etapa e espera o elemento real aparecer;
 *  - elemento que não aparece em 4 s não trava: a etapa vai para o meio da tela;
 *  - recarregou a página no meio? volta na mesma etapa (sessionStorage, 30 min);
 *  - progresso gravado no anúncio do tutorial (servidor) — falha de rede não
 *    para o tutorial, só não grava;
 *  - teclado: → próximo, ← anterior, Esc pula; o foco fica no cartão.
 */

const CHAVE_SESSAO = 'desigual-os:tour';
const ESPERA_DO_ALVO_MS = 4000;

interface EstadoDoTour { tour: Tour; indice: number }

interface ContextoDoTour {
  ativo: boolean;
  tourId: string | null;
  iniciar: (id: string, opcoes?: { etapa?: number }) => void;
  encerrar: () => void;
}

const Contexto = createContext<ContextoDoTour | null>(null);

/** Fora do provider (tela renderizada sozinha, teste): um tutorial que nunca abre — a tela não quebra por causa dele. */
const SEM_TOUR: ContextoDoTour = { ativo: false, tourId: null, iniciar: () => undefined, encerrar: () => undefined };

export function useTour(): ContextoDoTour {
  return useContext(Contexto) ?? SEM_TOUR;
}

function gravarSessao(e: EstadoDoTour | null) {
  try {
    if (e) window.sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ id: e.tour.id, indice: e.indice, em: Date.now() }));
    else window.sessionStorage.removeItem(CHAVE_SESSAO);
  } catch { /* armazenamento bloqueado: só perde a retomada depois de recarregar */ }
}

function lerSessao(): { id: string; indice: number } | null {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_SESSAO);
    if (!bruto) return null;
    const s = JSON.parse(bruto) as { id: string; indice: number; em: number };
    if (Date.now() - s.em > 30 * 60_000 || !TOURS[s.id]) return null;
    return { id: s.id, indice: s.indice };
  } catch { return null; }
}

function avisar(tour: Tour, evento: EventoDoAnuncio, etapa?: number) {
  if (!tour.anuncio) return;
  void registrarEventoDoAnuncio(tour.anuncio, evento, etapa).catch(() => undefined);
}

/** As etapas que valem nesta tela (as `disponivel: false` saem). */
function etapasValidas(tour: Tour) {
  return tour.etapas.filter((e) => !e.disponivel || e.disponivel());
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDoTour | null>(null);

  // Recarregou no meio: retoma.
  useEffect(() => {
    const s = lerSessao();
    if (s) setEstado({ tour: TOURS[s.id]!, indice: s.indice });
  }, []);

  useEffect(() => { gravarSessao(estado); }, [estado]);

  const iniciar = useCallback((id: string, opcoes?: { etapa?: number }) => {
    const tour = TOURS[id];
    if (!tour) return;
    const indice = Math.max(0, Math.min(opcoes?.etapa ?? 0, etapasValidas(tour).length - 1));
    setEstado({ tour, indice });
    avisar(tour, 'started', indice);
  }, []);

  const encerrar = useCallback(() => setEstado(null), []);

  const valor = useMemo(() => ({ ativo: Boolean(estado), tourId: estado?.tour.id ?? null, iniciar, encerrar }), [estado, iniciar, encerrar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <AnimatePresence>
        {estado && (
          <SobreposicaoDoTour
            key={estado.tour.id}
            tour={estado.tour}
            indice={estado.indice}
            onIr={(i) => { setEstado({ tour: estado.tour, indice: i }); avisar(estado.tour, 'step', i); }}
            onPular={() => { avisar(estado.tour, 'dismissed'); setEstado(null); }}
            onConcluir={() => { avisar(estado.tour, 'completed'); setEstado(null); }}
          />
        )}
      </AnimatePresence>
    </Contexto.Provider>
  );
}

/** O elemento VISÍVEL com aquele data-tour-id (a sidebar existe duas vezes: fixa e na gaveta do celular). */
function elementoVisivel(id: string): HTMLElement | null {
  const todos = [...document.querySelectorAll<HTMLElement>('[data-tour-id]')].filter((el) => el.getAttribute('data-tour-id') === id);
  for (const el of todos) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** A rota pede algo que a URL atual não tem? (mesma tela + mesmos parâmetros presentes = já está lá) */
function precisaNavegar(rota: string): boolean {
  const destino = new URL(rota, window.location.origin);
  if (destino.pathname !== window.location.pathname) return true;
  const atual = new URLSearchParams(window.location.search);
  for (const chave of destino.searchParams.keys()) if (!atual.has(chave)) return true;
  return false;
}

type Retangulo = { top: number; left: number; width: number; height: number };

function SobreposicaoDoTour({ tour, indice, onIr, onPular, onConcluir }: { tour: Tour; indice: number; onIr: (i: number) => void; onPular: () => void; onConcluir: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const etapas = useMemo(() => etapasValidas(tour), [tour]);
  const etapa: EtapaDoTour = etapas[Math.min(indice, etapas.length - 1)]!;
  const ultima = indice >= etapas.length - 1;
  const [alvo, setAlvo] = useState<Retangulo | null>(null);
  const [procurando, setProcurando] = useState(Boolean(etapa.alvo));
  const cartao = useRef<HTMLDivElement>(null);
  const principal = useRef<HTMLButtonElement>(null);

  // Navega até a etapa e procura o alvo.
  useEffect(() => {
    let cancelado = false;
    let abriuMenu: HTMLElement | null = null;
    let elemento: HTMLElement | null = null;
    setAlvo(null);
    setProcurando(Boolean(etapa.alvo));
    if (etapa.rota && precisaNavegar(etapa.rota)) router.push(etapa.rota, { scroll: false });
    if (!etapa.alvo) return;

    const inicio = Date.now();
    const medir = () => {
      if (!elemento || !elemento.isConnected) elemento = elementoVisivel(etapa.alvo!);
      if (!elemento) return false;
      const r = elemento.getBoundingClientRect();
      setAlvo({ top: r.top, left: r.left, width: r.width, height: r.height });
      return true;
    };
    const procurar = window.setInterval(() => {
      if (cancelado) return;
      if (etapa.abrir && !abriuMenu) {
        const botao = elementoVisivel(etapa.abrir);
        if (botao) {
          if (botao.getAttribute('aria-expanded') !== 'true') botao.click();
          abriuMenu = botao;
        }
      }
      if (medir()) {
        elemento!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setProcurando(false);
        window.clearInterval(procurar);
        return;
      }
      if (Date.now() - inicio > ESPERA_DO_ALVO_MS) {
        window.clearInterval(procurar);
        setProcurando(false);
        // Não achou: pula (se a etapa pediu) ou fica centralizada — nunca trava.
        if (etapa.aoFaltar === 'pular' && !ultima) onIr(indice + 1);
      }
    }, 120);

    // O alvo pode mexer (animação de rota, rolagem, janela redimensionada): acompanha.
    const acompanhar = window.setInterval(() => { if (elemento) medir(); }, 250);
    const aoMudar = () => { if (elemento) medir(); };
    window.addEventListener('resize', aoMudar);
    window.addEventListener('scroll', aoMudar, true);
    return () => {
      cancelado = true;
      window.clearInterval(procurar);
      window.clearInterval(acompanhar);
      window.removeEventListener('resize', aoMudar);
      window.removeEventListener('scroll', aoMudar, true);
      // Menu aberto para a etapa: fecha ao sair dela.
      if (abriuMenu?.isConnected && abriuMenu.getAttribute('aria-expanded') === 'true') abriuMenu.click();
    };
    // `pathname` entra para procurar de novo quando a rota chega.
  }, [etapa, pathname]);

  const proximo = useCallback(() => { if (ultima) onConcluir(); else onIr(indice + 1); }, [ultima, onConcluir, onIr, indice]);
  const anterior = useCallback(() => { if (indice > 0) onIr(indice - 1); }, [indice, onIr]);

  // Foco no botão principal a cada etapa; teclado.
  useEffect(() => { principal.current?.focus({ preventScroll: true }); }, [indice, procurando]);
  useEffect(() => {
    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); onPular(); return; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); proximo(); return; }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); anterior(); return; }
      if (ev.key === 'Tab' && cartao.current) {
        // O foco não sai do cartão enquanto o tutorial está aberto.
        const focaveis = [...cartao.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (focaveis.length === 0) return;
        const primeiro = focaveis[0]!;
        const ultimo = focaveis.at(-1)!;
        if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
        else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
        else if (!cartao.current.contains(document.activeElement)) { ev.preventDefault(); primeiro.focus(); }
      }
    };
    document.addEventListener('keydown', aoTeclar, true);
    return () => document.removeEventListener('keydown', aoTeclar, true);
  }, [onPular, proximo, anterior]);

  const concluirComAcao = () => {
    if (etapa.acaoFinal) router.push(etapa.acaoFinal.href);
    onConcluir();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[300]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="tour"
    >
      {/* Fundo: escurece tudo e não deixa clicar atrás. Com alvo, o "furo" é a sombra do destaque. */}
      {alvo ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-roxo-eletrico transition-all duration-200 ease-out"
          style={{ top: alvo.top - 6, left: alvo.left - 6, width: alvo.width + 12, height: alvo.height + 12, boxShadow: '0 0 0 9999px rgba(10, 10, 14, 0.62)' }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-carbono/70" />
      )}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />
      <CartaoDaEtapa
        refCartao={cartao}
        refPrincipal={principal}
        etapa={etapa}
        indice={indice}
        total={etapas.length}
        alvo={procurando ? null : alvo}
        procurando={procurando}
        ultima={ultima}
        onProximo={ultima && etapa.acaoFinal ? concluirComAcao : proximo}
        onAnterior={anterior}
        onPular={onPular}
      />
    </motion.div>
  );
}

const LARGURA = 340;
const MARGEM = 16;

/** Onde o cartão fica: do lado pedido, virando se não couber, sempre dentro da tela. */
export function posicionar(alvo: Retangulo | null, posicao: EtapaDoTour['posicao'], cartao: { width: number; height: number }, tela: { width: number; height: number }): { top: number; left: number } {
  if (!alvo) return { top: Math.max(MARGEM, (tela.height - cartao.height) / 2), left: Math.max(MARGEM, (tela.width - cartao.width) / 2) };
  const espaco = { top: alvo.top, bottom: tela.height - (alvo.top + alvo.height), left: alvo.left, right: tela.width - (alvo.left + alvo.width) };
  const cabe = { top: espaco.top >= cartao.height + 20, bottom: espaco.bottom >= cartao.height + 20, left: espaco.left >= cartao.width + 20, right: espaco.right >= cartao.width + 20 };
  const ordem: Array<'top' | 'bottom' | 'left' | 'right'> = posicao && posicao !== 'auto'
    ? [posicao, ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[posicao], 'bottom', 'top', 'right', 'left']
    : ['bottom', 'top', 'right', 'left'];
  const lado = ordem.find((l) => cabe[l]) ?? 'bottom';
  let top = 0;
  let left = 0;
  if (lado === 'bottom') { top = alvo.top + alvo.height + 14; left = alvo.left + alvo.width / 2 - cartao.width / 2; }
  if (lado === 'top') { top = alvo.top - cartao.height - 14; left = alvo.left + alvo.width / 2 - cartao.width / 2; }
  if (lado === 'right') { left = alvo.left + alvo.width + 14; top = alvo.top + alvo.height / 2 - cartao.height / 2; }
  if (lado === 'left') { left = alvo.left - cartao.width - 14; top = alvo.top + alvo.height / 2 - cartao.height / 2; }
  return {
    top: Math.min(Math.max(MARGEM, top), Math.max(MARGEM, tela.height - cartao.height - MARGEM)),
    left: Math.min(Math.max(MARGEM, left), Math.max(MARGEM, tela.width - cartao.width - MARGEM)),
  };
}

function CartaoDaEtapa({ refCartao, refPrincipal, etapa, indice, total, alvo, procurando, ultima, onProximo, onAnterior, onPular }: {
  refCartao: React.RefObject<HTMLDivElement | null>; refPrincipal: React.RefObject<HTMLButtonElement | null>;
  etapa: EtapaDoTour; indice: number; total: number; alvo: Retangulo | null; procurando: boolean; ultima: boolean;
  onProximo: () => void; onAnterior: () => void; onPular: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [celular, setCelular] = useState(false);

  useLayoutEffect(() => {
    const calcular = () => {
      const tela = { width: window.innerWidth, height: window.innerHeight };
      setCelular(tela.width < 640);
      const el = refCartao.current;
      const medida = { width: el?.offsetWidth ?? LARGURA, height: el?.offsetHeight ?? 200 };
      setPos(posicionar(alvo, etapa.posicao, medida, tela));
    };
    calcular();
    window.addEventListener('resize', calcular);
    return () => window.removeEventListener('resize', calcular);
  }, [alvo, etapa, refCartao]);

  const tituloId = `tour-titulo-${etapa.id}`;
  return (
    <motion.div
      ref={refCartao}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      aria-describedby={`tour-desc-${etapa.id}`}
      key={etapa.id}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'fixed z-[301] rounded-xl border border-grafite-elevado bg-grafite p-4 shadow-2xl outline-none',
        celular ? 'inset-x-4 bottom-4' : 'w-[340px]',
      )}
      style={celular || !pos ? {} : { top: pos.top, left: pos.left }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa" aria-live="polite">Etapa {indice + 1} de {total}</p>
        <button type="button" onClick={onPular} aria-label="Fechar tutorial" className="rounded p-0.5 text-nevoa transition-colors hover:text-branco-cru"><X size={15} /></button>
      </div>
      <h2 id={tituloId} className="font-heading text-base font-semibold text-branco-cru">{etapa.titulo}</h2>
      <p id={`tour-desc-${etapa.id}`} className="mt-1 text-sm leading-relaxed text-nevoa">
        {procurando ? 'Abrindo…' : etapa.descricao}
      </p>
      <div className="mt-3 flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', i <= indice ? 'bg-roxo-eletrico' : 'bg-grafite-elevado')} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {!ultima ? (
          <button type="button" onClick={onPular} className="text-xs text-nevoa transition-colors hover:text-branco-cru">Pular</button>
        ) : <span />}
        <div className="flex items-center gap-2">
          {indice > 0 && (
            <button type="button" onClick={onAnterior} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-branco-cru transition-colors hover:border-roxo-eletrico/60">Anterior</button>
          )}
          <button ref={refPrincipal} type="button" onClick={onProximo} className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm font-medium text-branco-cru transition-opacity hover:opacity-90">
            {ultima ? etapa.acaoFinal?.rotulo ?? 'Concluir' : 'Próximo'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
