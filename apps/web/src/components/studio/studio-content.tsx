'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Plus, X } from 'lucide-react';
import { JobForm } from '@/components/studio/job-form';
import { JobProgressCard } from '@/components/studio/job-progress-card';
import { StudioGallery } from '@/components/studio/studio-gallery';
import { GpuPanel } from '@/components/studio/gpu-panel';
import { Toaster } from '@/components/ui/toaster';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyActiveStudioJobs } from '@/hooks/use-studio-jobs';
import { useInfrastructureHealth } from '@/hooks/use-infrastructure-health';
import { useIsMaster } from '@/hooks/use-is-master';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useStudioFormStore } from '@/stores/studio-form-store';
import { useUiStore } from '@/stores/ui-store';
import type { NodeSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/** Abaixo disso o painel de criação vira drawer. Medido no CONTAINER (não na
 * viewport) pra funcionar igual na rota /studio e dentro do StudioModal. */
const WIDE_LAYOUT_MIN_WIDTH = 1100;

/** fabric.js acessa document/window no import e quebra em SSR (o próprio
 * package.json dele declara "node": null) - precisa ficar atrás de
 * next/dynamic(ssr:false), nunca de um import estático normal. */
const CanvaTab = dynamic(() => import('@/components/studio/canva/canva-tab'), {
  ssr: false,
  loading: () => <Skeleton className="h-[70vh] w-full rounded-xl" />,
});

function CreationPanel({ onCreated, gpuNode }: { onCreated: (jobId: string) => void; gpuNode: NodeSummary | undefined }) {
  const [gpuOpen, setGpuOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-grafite-elevado bg-grafite/80 p-5 shadow-card backdrop-blur-sm">
        <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          Novo projeto
        </h2>
        <JobForm onCreated={onCreated} />
      </div>

      {gpuNode && (
        <div className="rounded-xl border border-grafite-elevado bg-grafite/80 shadow-card">
          <button
            type="button"
            onClick={() => setGpuOpen((value) => !value)}
            aria-expanded={gpuOpen}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="font-heading text-xs font-semibold uppercase tracking-wider text-nevoa">
              Infra de renderização
            </span>
            <ChevronDown size={14} className={cn('text-nevoa transition-transform', gpuOpen && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {gpuOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="px-2 pb-2">
                  <GpuPanel node={gpuNode} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function HeroBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(600px 260px at 85% 0%, rgba(147,51,234,0.22), transparent 65%), radial-gradient(500px 240px at 10% 100%, rgba(107,33,168,0.16), transparent 70%)',
        }}
      />
      <svg className="absolute inset-0 size-full opacity-[0.10]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="studio-grid" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#9333ea" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#studio-grid)" />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-r from-carbono/70 via-carbono/40 to-transparent" />
    </div>
  );
}

/** The actual Studio screen, shared by the /studio route (deep links, direct nav) and the
 * StudioModal popup (the everyday entry point from the sidebar/command palette). */
export function StudioContent({ boundedHeight = false }: { boundedHeight?: boolean }) {
  const [activeTab, setActiveTab] = useState<'galeria' | 'canva'>('galeria');
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  // Vem da notificação de job concluído ("/studio?asset=<id>"): a galeria
  // abre essa peça direto. Lido de window.location em vez de useSearchParams
  // porque o Studio também roda dentro do modal, fora de uma rota própria.
  const [highlightAssetId, setHighlightAssetId] = useState<string | null>(null);
  useEffect(() => {
    setHighlightAssetId(new URLSearchParams(window.location.search).get('asset'));
  }, []);

  // Mesmo destino quando a notificação abre o StudioModal (popup): o asset
  // chega pela ui-store em vez da URL, e funciona até com o Studio já montado
  // (rota /studio aberta por baixo). Consumido uma vez: reabrir o Studio pela
  // sidebar não reabre a peça.
  const storeHighlightAsset = useUiStore((state) => state.studioHighlightAsset);
  const clearStudioHighlight = useUiStore((state) => state.clearStudioHighlight);
  useEffect(() => {
    if (!storeHighlightAsset) return;
    setHighlightAssetId(storeHighlightAsset);
    clearStudioHighlight();
  }, [storeHighlightAsset, clearStudioHighlight]);

  // Job generation runs on the worker independently of the Studio being open (BullMQ, not
  // tied to this component's lifetime). This just restores "your jobs in progress" into
  // local state on mount/reopen, since activeJobIds itself is plain component memory.
  const { data: myActiveJobIds } = useMyActiveStudioJobs();
  useEffect(() => {
    if (!myActiveJobIds || myActiveJobIds.length === 0) return;
    setActiveJobIds((current) => {
      const missing = myActiveJobIds.filter((id) => !current.includes(id));
      return missing.length > 0 ? [...missing, ...current] : current;
    });
  }, [myActiveJobIds]);

  const { isMaster } = useIsMaster();
  const { data: health } = useInfrastructureHealth(isMaster);
  const queryClient = useQueryClient();

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const panelFocusToken = useStudioFormStore((state) => state.panelFocusToken);
  const resetForm = useStudioFormStore((state) => state.reset);
  const requestPanelFocus = useStudioFormStore((state) => state.requestPanelFocus);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? null);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const isWide = containerWidth === null ? true : containerWidth >= WIDE_LAYOUT_MIN_WIDTH;

  // Pedido de foco no painel (Novo projeto, Duplicar, Usar como referência...):
  // layout largo scrolla até ele; estreito abre o drawer.
  const lastTokenRef = useRef(panelFocusToken);
  useEffect(() => {
    if (panelFocusToken === lastTokenRef.current) return;
    lastTokenRef.current = panelFocusToken;
    if (isWide) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setDrawerOpen(true);
    }
  }, [panelFocusToken, isWide]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);
  useFocusTrap(drawerRef, drawerOpen);

  const handleCreated = useCallback((jobId: string) => {
    setActiveJobIds((current) => [jobId, ...current]);
    setDrawerOpen(false);
  }, []);

  const dismissJob = useCallback((jobId: string) => {
    setActiveJobIds((current) => current.filter((id) => id !== jobId));
  }, []);

  const handleSettled = useCallback(
    (jobId: string, status: 'completed' | 'failed') => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'assets'] });
      // Só o job que deu certo se retira sozinho (o resultado está na
      // galeria logo abaixo). O que falhou FICA na tela com o motivo até a
      // pessoa fechar - sumir calado foi exatamente o defeito relatado.
      if (status === 'completed') {
        setTimeout(() => dismissJob(jobId), 2000);
      }
    },
    [queryClient, dismissJob],
  );

  const studioNode = health?.nodes.find((n) => n.agent === 'studio');

  return (
    <div ref={rootRef} className={cn(boundedHeight && 'flex h-full min-h-0 flex-col')}>
      {/* Hero */}
      <header className="relative mb-8 shrink-0 overflow-hidden rounded-xl border border-grafite-elevado bg-grafite">
        <HeroBackground />
        <div className="relative flex flex-wrap items-end justify-between gap-4 p-6 md:p-8">
          <div>
            <p className="mb-1 font-mono text-xs uppercase tracking-wider text-sinal">Criação multimídia</p>
            <h1 className="font-display text-5xl font-black uppercase tracking-tight text-branco-cru">Studio</h1>
            <p className="mt-2 max-w-2xl text-sm text-nevoa">
              Gere carrosséis, reels e imagens com o Brand Kit do cliente aplicado automaticamente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm();
              requestPanelFocus();
            }}
            className="flex items-center gap-2 rounded-lg bg-roxo-eletrico px-4 py-2.5 text-sm font-semibold text-branco-cru shadow-glow transition-all hover:opacity-90"
          >
            <Plus size={16} />
            Novo projeto
          </button>
        </div>
      </header>

      {/* Galeria x Canva: mesmo padrão do toggle grade/lista da própria
       * Galeria (role="group" + aria-pressed), não um componente de tabs
       * genérico - não existe um no design system ainda. */}
      <div role="group" aria-label="Modo do Studio" className="mb-5 flex shrink-0 gap-1 rounded-lg border border-grafite-elevado bg-grafite p-1">
        {(['galeria', 'canva'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors',
              activeTab === tab ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            {tab === 'galeria' ? 'Galeria' : 'Canva'}
          </button>
        ))}
      </div>

      {activeTab === 'canva' && (
        <div className={cn(boundedHeight && 'min-h-0 flex-1 overflow-hidden')}>
          <CanvaTab />
        </div>
      )}

      {/* Dentro do modal (boundedHeight): nada aqui rola exceto a coluna do
       * formulário abaixo - pedido do usuário, 2026-09-05. A galeria também
       * rola por conta própria (2026-09-05, revertendo a paginação: mesmo
       * sistema de scroll da tela de Clientes, busca única sem "página X de
       * Y"). Na rota /studio (boundedHeight false) o comportamento continua
       * o de sempre: a PÁGINA rola normal, como qualquer tela do shell. */}
      {activeTab === 'galeria' && (
      <div
        className={cn(
          'gap-6',
          isWide && 'grid grid-cols-[minmax(340px,380px)_1fr]',
          boundedHeight && 'min-h-0 flex-1 overflow-hidden',
        )}
      >
        {isWide && (
          <div
            ref={panelRef}
            className={cn('scroll-mt-6', boundedHeight && 'h-full min-h-0 overflow-y-auto pr-1')}
          >
            <CreationPanel onCreated={handleCreated} gpuNode={studioNode} />
          </div>
        )}

        <div className={cn('space-y-6', !isWide && 'mt-6', boundedHeight && 'h-full min-h-0 overflow-y-auto pr-1')}>
          {activeJobIds.length > 0 && (
            <div>
              <h2 className="mb-3 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
                Fila de jobs
              </h2>
              <div className="space-y-3">
                <AnimatePresence>
                  {activeJobIds.map((jobId) => (
                    <motion.div
                      key={jobId}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                    >
                      <JobProgressCard jobId={jobId} onSettled={handleSettled} onDismiss={dismissJob} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          <StudioGallery
            highlightAssetId={highlightAssetId}
            onOpenSettings={isWide ? undefined : () => setDrawerOpen(true)}
          />
        </div>
      </div>
      )}

      {/* Drawer de criação (layout estreito) */}
      <AnimatePresence>
        {!isWide && drawerOpen && (
          <motion.div
            className="fixed inset-0 z-[80] bg-carbono/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
          >
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Painel de criação"
              className="absolute inset-y-0 left-0 w-full max-w-md overflow-y-auto border-r border-grafite-elevado bg-carbono p-5 shadow-elevated"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
                  Configurações do projeto
                </p>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Fechar painel de criação"
                  className="flex size-8 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
                >
                  <X size={16} />
                </button>
              </div>
              <CreationPanel onCreated={handleCreated} gpuNode={studioNode} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toaster />
    </div>
  );
}
