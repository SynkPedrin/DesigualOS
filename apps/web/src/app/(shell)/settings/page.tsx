'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Check, Monitor, Moon, Sun } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { useUpdateMe, useUploadAvatar } from '@/hooks/use-update-me';
import { useTheme } from '@/hooks/use-theme';
import { useHoverSound } from '@/hooks/use-hover-sound';
import { ClickUpIntegrationSection } from '@/components/settings/clickup-integration-card';
import { ApiRequestError } from '@/lib/api/client';
import { LANGUAGES, THEMES, type Language, type Theme } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

const LANGUAGE_LABELS: Record<Language, string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)',
  'es-ES': 'Español',
};

const THEME_LABELS: Record<Theme, string> = {
  light: 'Claro',
  dark: 'Escuro',
  system: 'Padrão do sistema',
};

const THEME_CARD_ICON: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/** Each card always previews its OWN target theme - the real light/dark wallpaper, not the
 * CSS tokens that follow whatever theme is active right now - so light and dark sit side by
 * side either way. System splits the two, since it resolves to whichever matches the OS. */
const THEME_CARD_WALLPAPER: Record<Theme, string> = {
  dark: '/brand/fundo.png',
  light: '/brand/fundo-light.png',
  system: '/brand/fundo.png',
};

const THEME_CARD_STYLE: Record<Theme, { overlay: string; text: string }> = {
  dark: { overlay: 'from-black/85 via-black/60 to-black/25', text: 'text-white' },
  light: { overlay: 'from-white/90 via-white/70 to-white/30', text: 'text-[#17171a]' },
  system: { overlay: 'from-roxo-eletrico/70 via-black/50 to-black/20', text: 'text-white' },
};

function ThemeCard({ value, active, onSelect }: { value: Theme; active: boolean; onSelect: () => void }) {
  const Icon = THEME_CARD_ICON[value];
  const style = THEME_CARD_STYLE[value];
  const playHoverSound = useHoverSound();

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={playHoverSound}
      className={cn(
        'relative h-24 flex-1 overflow-hidden rounded-lg border-2 text-left transition-all hover:scale-[1.02] hover:shadow-glow active:scale-[0.98]',
        active ? 'border-roxo-eletrico shadow-glow' : 'border-transparent hover:border-grafite-elevado',
      )}
    >
      <Image src={THEME_CARD_WALLPAPER[value]} alt="" fill sizes="200px" className="object-cover" />
      <div className={cn('absolute inset-0 bg-gradient-to-b', style.overlay)} />
      {active && (
        <span className="absolute right-2 top-2 z-10 flex size-5 items-center justify-center rounded-full bg-roxo-eletrico">
          <Check size={12} className="text-white" />
        </span>
      )}
      <div className={cn('relative z-10 flex h-full flex-col justify-end gap-1 p-3', style.text)}>
        <Icon size={16} />
        <span className="text-sm font-semibold">{THEME_LABELS[value]}</span>
      </div>
    </button>
  );
}

export default function SettingsPage() {
  const { data: me, isPending } = useMe();
  const updateMe = useUpdateMe();
  const uploadAvatar = useUploadAvatar();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [clickupEmail, setClickupEmail] = useState('');
  const [nameDirty, setNameDirty] = useState(false);
  const [clickupDirty, setClickupDirty] = useState(false);

  const displayName = nameDirty ? name : me?.name ?? '';
  const displayClickupEmail = clickupDirty ? clickupEmail : me?.clickupEmail ?? '';

  function handleAvatarPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) uploadAvatar.mutate(file);
    event.target.value = '';
  }

  function handleSaveProfile() {
    updateMe.mutate(
      { name: nameDirty ? name : undefined, clickupEmail: clickupDirty ? clickupEmail || null : undefined },
      { onSuccess: () => { setNameDirty(false); setClickupDirty(false); } },
    );
  }

  if (isPending || !me) {
    return (
      <div>
        <PageHeader eyebrow="Conta" title="Configurações" description="Idioma, tema, foto de perfil e integrações." />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Conta" title="Configurações" description="Idioma, tema, foto de perfil e integrações." />

      <Surface level="grafite" className="p-0">
        <div className="grid grid-cols-1 divide-y divide-grafite-elevado xl:grid-cols-4 xl:divide-x xl:divide-y-0">
          <section className="p-5">
            <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Perfil</h2>

            <div className="mb-5 flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadAvatar.isPending}
                aria-label="Trocar foto de perfil"
                className="group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-roxo-eletrico font-mono text-lg font-semibold text-branco-cru disabled:opacity-60"
              >
                {me.avatarUrl ? (
                  <Image src={me.avatarUrl} alt={me.name} fill sizes="64px" unoptimized className="object-cover" />
                ) : (
                  me.name.charAt(0).toUpperCase()
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-carbono/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera size={18} />
                </span>
              </button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleAvatarPick} />
              <div>
                <p className="text-sm font-medium text-branco-cru">{me.name}</p>
                <p className="font-mono text-xs text-nevoa">{me.email}</p>
                <p className="mt-1 font-mono text-[10px] text-nevoa">
                  {uploadAvatar.isPending ? 'Enviando foto…' : 'PNG, JPEG ou WEBP, até 25MB. Visível para todos os usuários.'}
                </p>
                {uploadAvatar.isError && (
                  <p className="mt-1 text-[11px] text-erro">{errorMessage(uploadAvatar.error, 'Não foi possível enviar a foto.')}</p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Nome</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => { setName(event.target.value); setNameDirty(true); }}
                  className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  E-mail do ClickUp (pode ser diferente do login)
                </label>
                <input
                  type="email"
                  placeholder="seu-email@clickup"
                  value={displayClickupEmail}
                  onChange={(event) => { setClickupEmail(event.target.value); setClickupDirty(true); }}
                  className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
                />
              </div>
              {(nameDirty || clickupDirty) && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={updateMe.isPending}
                    className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
                  >
                    {updateMe.isPending ? 'Salvando…' : 'Salvar'}
                  </button>
                  {updateMe.isError && (
                    <p className="text-[11px] text-erro">{errorMessage(updateMe.error, 'Não foi possível salvar.')}</p>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="p-5">
            <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Idioma</h2>
            <div className="flex flex-col items-start gap-2">
              {LANGUAGES.map((language) => (
                <button
                  key={language}
                  type="button"
                  onClick={() => updateMe.mutate({ language })}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    me.language === language
                      ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                      : 'border-grafite-elevado text-nevoa hover:text-branco-cru'
                  }`}
                >
                  {LANGUAGE_LABELS[language]}
                </button>
              ))}
            </div>
            {updateMe.isError && !nameDirty && !clickupDirty && (
              <p className="mt-2 text-[11px] text-erro">{errorMessage(updateMe.error, 'Não foi possível salvar.')}</p>
            )}
          </section>

          <section className="p-5">
            <ClickUpIntegrationSection />
          </section>

          <section className="p-5">
            <h2 className="mb-4 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Tema</h2>
            <div className="flex flex-col gap-3">
              {THEMES.map((themeOption) => (
                <ThemeCard
                  key={themeOption}
                  value={themeOption}
                  active={theme === themeOption}
                  onSelect={() => setTheme(themeOption)}
                />
              ))}
            </div>
          </section>

          {/* Requisito de licença do TradingView Lightweight Charts (gráficos de
           * tendência do Studio/Monitoramento/Dashboard): ou o logo de atribuição
           * aparece em cada gráfico, ou este link cumpre a exigência uma vez só -
           * escolhemos a 2ª opção pra não poluir gráficos pequenos com o logo. */}
          <section className="p-5">
            <h2 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Sobre</h2>
            <p className="text-xs text-nevoa">
              Gráficos de tendência construídos com{' '}
              <a
                href="https://www.tradingview.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-roxo-eletrico hover:underline"
              >
                TradingView Lightweight Charts
              </a>
              .
            </p>
          </section>
        </div>
      </Surface>
    </div>
  );
}
