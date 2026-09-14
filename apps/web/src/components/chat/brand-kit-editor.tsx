'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSaveBrandKit } from '@/hooks/use-brand-kit';
import type { BrandKit } from '@/lib/api/contracts';

/** "azul, #0EA5E9 ,Sora" -> ['azul', '#0EA5E9', 'Sora'] — lista separada por
 * vírgula com espaços tolerados; itens vazios descartados. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const inputClass =
  'w-full rounded-md border border-grafite-elevado bg-grafite px-2 py-1.5 text-xs text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico focus:outline-none';

/**
 * Formulário do Brand Kit (write path do PUT /clients/:id/brand-kit): até
 * 11/09/2026 a tabela só era populada por SQL manual. Abre a partir do bloco
 * Padrões do ProjectOverviewPanel, tanto no estado vazio ("Cadastrar") quanto
 * no preenchido ("Editar"). Salvar com campo em branco LIMPA o campo (o
 * formulário sempre manda o estado completo, não merge parcial).
 */
export function BrandKitEditor({
  clientId,
  brandKit,
  onClose,
}: {
  clientId: string;
  brandKit?: BrandKit | undefined;
  onClose: () => void;
}) {
  const saveBrandKit = useSaveBrandKit(clientId);
  const [logoUrl, setLogoUrl] = useState(brandKit?.logoUrl ?? '');
  const [colors, setColors] = useState((brandKit?.colors ?? []).join(', '));
  const [fonts, setFonts] = useState((brandKit?.fonts ?? []).join(', '));
  const [toneOfVoice, setToneOfVoice] = useState(brandKit?.toneOfVoice ?? '');
  const [referenceImages, setReferenceImages] = useState((brandKit?.referenceImages ?? []).join(', '));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    saveBrandKit.mutate(
      {
        logoUrl: logoUrl.trim().length > 0 ? logoUrl.trim() : null,
        colors: splitList(colors),
        fonts: splitList(fonts),
        toneOfVoice: toneOfVoice.trim().length > 0 ? toneOfVoice.trim() : null,
        referenceImages: splitList(referenceImages),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div>
        <label htmlFor="brand-kit-logo" className="mb-1 block text-[10px] uppercase tracking-wider text-nevoa">
          URL do logo
        </label>
        <input
          id="brand-kit-logo"
          type="url"
          value={logoUrl}
          onChange={(event) => setLogoUrl(event.target.value)}
          placeholder="https://…"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="brand-kit-colors" className="mb-1 block text-[10px] uppercase tracking-wider text-nevoa">
          Cores (separadas por vírgula)
        </label>
        <input
          id="brand-kit-colors"
          type="text"
          value={colors}
          onChange={(event) => setColors(event.target.value)}
          placeholder="#0EA5E9, #F0F9FF"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="brand-kit-fonts" className="mb-1 block text-[10px] uppercase tracking-wider text-nevoa">
          Fontes (separadas por vírgula)
        </label>
        <input
          id="brand-kit-fonts"
          type="text"
          value={fonts}
          onChange={(event) => setFonts(event.target.value)}
          placeholder="Sora, Inter"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="brand-kit-tone" className="mb-1 block text-[10px] uppercase tracking-wider text-nevoa">
          Tom de voz
        </label>
        <textarea
          id="brand-kit-tone"
          value={toneOfVoice}
          onChange={(event) => setToneOfVoice(event.target.value)}
          placeholder="Direto, confiante e provocativo."
          rows={2}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="brand-kit-references" className="mb-1 block text-[10px] uppercase tracking-wider text-nevoa">
          Imagens de referência (URLs, separadas por vírgula)
        </label>
        <textarea
          id="brand-kit-references"
          value={referenceImages}
          onChange={(event) => setReferenceImages(event.target.value)}
          placeholder="https://…, https://…"
          rows={2}
          className={inputClass}
        />
      </div>

      {saveBrandKit.isError && (
        <p className="text-xs text-red-400">
          {saveBrandKit.error instanceof Error ? saveBrandKit.error.message : 'Falha ao salvar o Brand Kit.'}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1.5 text-xs text-nevoa transition-colors hover:text-branco-cru"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saveBrandKit.isPending}
          className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-2.5 py-1.5 text-xs font-medium text-branco-cru transition-colors hover:opacity-80 disabled:opacity-50"
        >
          {saveBrandKit.isPending && <Loader2 size={12} className="animate-spin" />}
          Salvar Brand Kit
        </button>
      </div>
    </form>
  );
}
