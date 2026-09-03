'use client';

import Image from 'next/image';
import Link from 'next/link';
import { HelpCircle, Monitor, Moon, Search, Sun } from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { useMe } from '@/hooks/use-me';
import { useTheme } from '@/hooks/use-theme';
import { NotificationsMenu } from './notifications-menu';
import type { Theme } from '@/lib/api/contracts';

const THEME_CYCLE: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const THEME_NEXT_LABEL: Record<Theme, string> = {
  system: 'Mudar para tema claro',
  light: 'Mudar para tema escuro',
  dark: 'Mudar para tema do sistema',
};

export function Topbar() {
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const { data: me } = useMe();
  const { theme, setTheme } = useTheme();
  const ThemeIcon = THEME_ICON[theme];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-grafite-elevado bg-carbono px-6">
      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="flex w-full max-w-sm items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-left text-sm text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
      >
        <Search size={16} className="shrink-0" />
        <span className="flex-1 truncate">Buscar ou executar um comando</span>
        <kbd className="shrink-0 rounded border border-grafite-elevado bg-carbono px-1.5 py-0.5 font-mono text-[10px] text-nevoa">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setTheme(THEME_CYCLE[theme])}
          aria-label={THEME_NEXT_LABEL[theme]}
          title={THEME_NEXT_LABEL[theme]}
          className="flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
        >
          <ThemeIcon size={18} />
        </button>
        <NotificationsMenu />
        <button
          type="button"
          aria-label="Ajuda"
          className="flex size-9 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
        >
          <HelpCircle size={18} />
        </button>
        <Link
          href="/settings"
          aria-label="Configurações da conta"
          className="relative ml-2 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-roxo-eletrico font-mono text-sm font-semibold text-branco-cru"
        >
          {me?.avatarUrl ? (
            <Image src={me.avatarUrl} alt={me.name} fill sizes="36px" unoptimized className="object-cover" />
          ) : (
            (me?.name ?? '?').charAt(0).toUpperCase()
          )}
        </Link>
      </div>
    </header>
  );
}
