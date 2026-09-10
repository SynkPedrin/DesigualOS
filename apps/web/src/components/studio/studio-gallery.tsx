'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useStudioAssets } from '@/hooks/use-studio-assets';
import { useClients } from '@/hooks/use-clients';
import { useIsMaster } from '@/hooks/use-is-master';
import { useStudioFormStore } from '@/stores/studio-form-store';
import { AssetGallery } from './asset-gallery';
import type { StudioJobType } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const SEARCH_DEBOUNCE_MS = 350;

const TYPE_FILTERS: { value: StudioJobType | null; label: string }[] = [
  { value: null, label: 'Todos' },
  { value: 'image', label: 'Imagem' },
  { value: 'carousel', label: 'Carrossel' },
  { value: 'video', label: 'Vídeo' },
  { value: 'reels', label: 'Reel' },
];

function GallerySkeletons() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4" aria-label="Carregando galeria">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-grafite-elevado bg-grafite">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Galeria do Studio: toolbar (cliente, busca com debounce, tipo, grid/lista),
 * busca única sem paginação (mesmo padrão da tela de Clientes) e estados
 * vazios guiando pra criação. O scroll é do container em volta (StudioContent). */
export function StudioGallery({
  highlightAssetId,
  onOpenSettings,
}: {
  highlightAssetId: string | null;
  /** Presente no layout estreito: abre o drawer com o painel de criação. */
  onOpenSettings?: (() => void) | undefined;
}) {
  const { isMaster } = useIsMaster();
  const { data: clients } = useClients();
  const requestPanelFocus = useStudioFormStore((state) => state.requestPanelFocus);
  const resetForm = useStudioFormStore((state) => state.reset);

  const [clientId, setClientId] = useState('');
  const [type, setType] = useState<StudioJobType | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const timeout = setTimeout(() => setQ(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  // Master navega assets de todos os clientes (seleção vazia = sem filtro);
  // colaborador precisa de client_id ou o backend devolve 403 — a galeria espera a escolha.
  const enabled = isMaster || Boolean(clientId);
  const filter = useMemo(() => ({ clientId: clientId || null, type, q }), [clientId, type, q]);
  // Mesmo padrão da tela de Clientes (pedido do usuário, 2026-09-05): busca
  // única, sem paginação nem "carregar mais" - o container é que rola.
  const query = useStudioAssets(filter, enabled);
  const assets = query.data?.assets ?? [];
  const total = query.data?.total ?? 0;

  const hasActiveFilter = Boolean(clientId || type || q);

  function clearFilters() {
    setClientId('');
    setType(null);
    setSearchInput('');
    setQ('');
  }

  function handleCreateProject() {
    resetForm();
    requestPanelFocus();
    onOpenSettings?.();
  }

  return (
    <section aria-label="Galeria de projetos">
      {/* Toolbar */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
            Galeria de projetos
          </h2>

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 rounded-md border border-roxo-eletrico/50 bg-roxo-eletrico/10 px-3 py-1.5 text-xs font-medium text-branco-cru transition-all hover:bg-roxo-eletrico/20"
            >
              <SlidersHorizontal size={13} />
              Configurações
            </button>
          )}

          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            aria-label="Filtrar por cliente"
            className="rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-xs text-branco-cru transition-colors focus:border-roxo-eletrico/60 focus:outline-none"
          >
            <option value="">{isMaster ? 'Todos os clientes' : 'Selecione um cliente'}</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar projetos..."
              aria-label="Buscar projetos"
              className="w-48 rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-8 pr-7 text-xs text-branco-cru placeholder:text-nevoa/70 transition-colors focus:border-roxo-eletrico/60 focus:outline-none"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Limpar busca"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-nevoa hover:text-branco-cru"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex overflow-hidden rounded-md border border-grafite-elevado" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              aria-label="Visualização em grade"
              title="Grade"
              className={cn(
                'p-1.5 transition-colors',
                view === 'grid' ? 'bg-roxo-eletrico text-branco-cru' : 'bg-carbono text-nevoa hover:text-branco-cru',
              )}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              aria-label="Visualização em lista"
              title="Lista"
              className={cn(
                'p-1.5 transition-colors',
                view === 'list' ? 'bg-roxo-eletrico text-branco-cru' : 'bg-carbono text-nevoa hover:text-branco-cru',
              )}
            >
              <List size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_FILTERS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setType(option.value)}
              aria-pressed={type === option.value}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-all',
                type === option.value
                  ? 'border-roxo-eletrico/70 bg-roxo-eletrico/10 text-branco-cru'
                  : 'border-grafite-elevado bg-carbono text-nevoa hover:border-nevoa/40 hover:text-branco-cru',
              )}
            >
              {option.label}
            </button>
          ))}
          {hasActiveFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-roxo-eletrico transition-colors hover:bg-roxo-eletrico/10"
            >
              <X size={11} />
              Limpar filtros
            </button>
          )}
          {enabled && total > 0 && (
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-nevoa/70">
              {total} no total
            </span>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      {!enabled ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-grafite-elevado px-8 py-16 text-center">
          <Search size={28} className="text-nevoa" />
          <p className="font-heading text-lg font-semibold text-branco-cru">Selecione um cliente</p>
          <p className="max-w-sm text-sm text-nevoa">Escolha um cliente acima para ver os projetos gerados pra ele.</p>
        </div>
      ) : query.isPending ? (
        <GallerySkeletons />
      ) : query.isError ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-erro/30 px-8 py-16 text-center">
          <p className="font-heading text-lg font-semibold text-branco-cru">Não foi possível carregar a galeria.</p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="rounded-md bg-roxo-eletrico px-4 py-2 text-xs font-semibold text-branco-cru transition-all hover:opacity-90"
          >
            Tentar novamente
          </button>
        </div>
      ) : assets.length === 0 ? (
        hasActiveFilter ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-grafite-elevado px-8 py-16 text-center">
            <Search size={28} className="text-nevoa" />
            <p className="font-heading text-lg font-semibold text-branco-cru">Nenhum projeto encontrado.</p>
            <p className="max-w-sm text-sm text-nevoa">Nada bate com os filtros atuais. Ajuste a busca ou limpe os filtros.</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-1 rounded-md border border-roxo-eletrico/50 px-4 py-2 text-xs font-semibold text-roxo-eletrico transition-all hover:bg-roxo-eletrico/10"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed border-grafite-elevado px-8 py-16 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  'radial-gradient(400px 200px at 50% 0%, rgba(147,51,234,0.12), transparent 70%)',
              }}
            />
            <Sparkles size={28} className="relative text-roxo-eletrico" />
            <p className="relative font-heading text-lg font-semibold text-branco-cru">Seu Studio está pronto.</p>
            <p className="relative max-w-sm text-sm text-nevoa">Crie seu primeiro projeto usando IA.</p>
            <button
              type="button"
              onClick={handleCreateProject}
              className="relative mt-1 flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-xs font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
            >
              <Sparkles size={13} />
              Criar projeto
            </button>
          </div>
        )
      ) : (
        <AssetGallery assets={assets} view={view} insideStudio highlightAssetId={highlightAssetId} />
      )}
    </section>
  );
}
