'use client';

import { useEffect, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { useFontSearch, type FontCategory } from '@/hooks/use-font-search';
import { loadFontVariant } from '@/lib/canva/font-manager';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

const CATEGORIES: { key: FontCategory | null; label: string }[] = [
  { key: null, label: 'Todas' },
  { key: 'sans-serif', label: 'Sans Serif' },
  { key: 'serif', label: 'Serif' },
  { key: 'display', label: 'Display' },
  { key: 'handwriting', label: 'Handwriting' },
  { key: 'monospace', label: 'Monospace' },
];

const FAVORITES_KEY = 'canva-favorite-fonts';

function readFavorites(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function FontRow({
  fontId,
  family,
  isFavorite,
  onToggleFavorite,
  onSelect,
}: {
  fontId: string;
  family: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onSelect: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadFontVariant(fontId, family, 400, 'normal').then(
      () => {
        if (!cancelled) setLoaded(true);
      },
      () => {
        // Falha de preview não impede escolher a fonte - aplicar de novo tenta carregar outra vez.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fontId, family]);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 truncate rounded-md px-2.5 py-2 text-left text-sm text-branco-cru transition-colors hover:bg-grafite-elevado"
        style={loaded ? { fontFamily: family } : undefined}
      >
        {family}
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:text-branco-cru"
      >
        <Star size={13} className={cn(isFavorite && 'fill-sinal text-sinal')} />
      </button>
    </div>
  );
}

/** Painel de fontes (pedido explícito): busca + categorias + preview no
 * próprio nome da fonte + favoritos. Cada fonte só é baixada (FontFace API,
 * via FontManager) quando aparece na lista filtrada, nunca todas de uma vez. */
export function FontPicker({
  onSelect,
  onClose,
}: {
  onSelect: (fontId: string, family: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const { data: fonts, isPending, isError } = useFontSearch(query, category);

  useEffect(() => {
    setFavorites(readFavorites());
  }, []);

  function toggleFavorite(fontId: string) {
    setFavorites((current) => {
      const next = current.includes(fontId) ? current.filter((id) => id !== fontId) : [...current, fontId];
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        // localStorage indisponível (aba privada etc.) - favoritos só não persistem, resto funciona.
      }
      return next;
    });
  }

  async function handleSelect(fontId: string, family: string) {
    try {
      await loadFontVariant(fontId, family, 400, 'normal');
      onSelect(fontId, family);
      onClose();
    } catch {
      toast(`Não foi possível carregar a fonte "${family}". Tente outra.`, 'error');
    }
  }

  const visible = showFavoritesOnly ? (fonts ?? []).filter((f) => favorites.includes(f.id)) : fonts;

  return (
    <div
      role="dialog"
      aria-label="Pesquisar fontes"
      className="absolute bottom-full left-1/2 mb-2 flex h-96 w-72 -translate-x-1/2 flex-col rounded-lg border border-grafite-elevado bg-grafite shadow-elevated"
    >
      <div className="space-y-2 border-b border-grafite-elevado p-2.5">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nevoa" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar fontes"
            className="w-full rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-8 pr-2 text-xs text-branco-cru placeholder:text-nevoa/70 focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setCategory(option.key)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                category === option.key ? 'bg-roxo-eletrico text-branco-cru' : 'bg-carbono text-nevoa hover:text-branco-cru',
              )}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowFavoritesOnly((v) => !v)}
            className={cn(
              'ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
              showFavoritesOnly ? 'bg-sinal/20 text-sinal' : 'text-nevoa hover:text-branco-cru',
            )}
          >
            <Star size={10} className={cn(showFavoritesOnly && 'fill-sinal')} />
            Favoritas
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {isPending && <p className="p-3 text-center text-xs text-nevoa">Carregando...</p>}
        {isError && <p className="p-3 text-center text-xs text-erro">Não foi possível carregar as fontes.</p>}
        {!isPending && !isError && visible?.length === 0 && (
          <p className="p-3 text-center text-xs text-nevoa">Nenhuma fonte encontrada.</p>
        )}
        {visible?.map((font) => (
          <FontRow
            key={font.id}
            fontId={font.id}
            family={font.family}
            isFavorite={favorites.includes(font.id)}
            onToggleFavorite={() => toggleFavorite(font.id)}
            onSelect={() => void handleSelect(font.id, font.family)}
          />
        ))}
      </div>
    </div>
  );
}
