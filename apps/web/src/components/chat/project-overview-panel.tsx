'use client';

import { useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { useBrandKit } from '@/hooks/use-brand-kit';
import { useClientMemory } from '@/hooks/use-client-memory';
import { useClientOverview } from '@/hooks/use-client-overview';
import { useIsMaster } from '@/hooks/use-is-master';
import { BrandKitEditor } from '@/components/chat/brand-kit-editor';
import { formatRelativeTime } from '@/lib/format';

function PanelLoading() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-nevoa">
      <Loader2 size={12} className="animate-spin" /> Carregando…
    </p>
  );
}

/** Dossiê da memória truncado em 40 linhas com botão ver tudo/menos: o
 * conteúdo pode ter milhares de linhas e a tela de Projeto é de conversa. */
const MEMORY_PREVIEW_LINES = 40;

function MemoryContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split('\n');
  const isLong = lines.length > MEMORY_PREVIEW_LINES;
  const shown = expanded || !isLong ? content : lines.slice(0, MEMORY_PREVIEW_LINES).join('\n');

  return (
    <div>
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap [font:inherit] text-xs leading-relaxed text-branco-cru/90">
        {shown}
      </pre>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 font-mono text-[10px] uppercase tracking-wider text-roxo-eletrico transition-colors hover:text-branco-cru"
        >
          {expanded ? 'Ver menos' : `Ver tudo (${lines.length} linhas)`}
        </button>
      )}
    </div>
  );
}

/**
 * "Ver a memória, as informações, padrões" (pedido do usuário, tela de
 * Projeto do chat): três blocos lidos do cliente vinculado ao projeto -
 * Padrões (Brand Kit), Informações (visão geral) e Memória (dossiê
 * consolidado que o Context Engine já injeta em toda conversa deste
 * cliente). Some inteiro quando o projeto não tem cliente vinculado.
 */
export function ProjectOverviewPanel({ clientId }: { clientId: string }) {
  const { data: memory, isPending: memoryPending } = useClientMemory(clientId);
  const { data: brandKit, isPending: brandKitPending } = useBrandKit(clientId);
  const { data: overview, isPending: overviewPending } = useClientOverview(clientId);
  const { isMaster } = useIsMaster();
  const [editingBrandKit, setEditingBrandKit] = useState(false);

  const hasBrandKit = brandKit && (brandKit.colors.length > 0 || brandKit.logoUrl || brandKit.toneOfVoice || brandKit.fonts.length > 0 || brandKit.referenceImages.length > 0);

  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-grafite-elevado bg-grafite/40 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Padrões</p>
          {/* Edição é master-only porque o backend exige clients:write no PUT
              /clients/:id/brand-kit — mostrar o botão pra colaborador seria
              prometer uma ação que termina em 403. */}
          {isMaster && !editingBrandKit && !brandKitPending && (
            <button
              type="button"
              onClick={() => setEditingBrandKit(true)}
              className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-roxo-eletrico transition-colors hover:text-branco-cru"
            >
              <Pencil size={10} />
              {hasBrandKit ? 'Editar' : 'Cadastrar'}
            </button>
          )}
        </div>
        {brandKitPending ? (
          <PanelLoading />
        ) : editingBrandKit ? (
          <BrandKitEditor clientId={clientId} brandKit={brandKit} onClose={() => setEditingBrandKit(false)} />
        ) : !hasBrandKit ? (
          <p className="text-xs text-nevoa">Este cliente ainda não tem Brand Kit cadastrado.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {brandKit!.logoUrl && (
                <img src={brandKit!.logoUrl} alt="Logo do cliente" className="size-8 shrink-0 rounded object-contain" />
              )}
              {brandKit!.colors.length > 0 && (
                <div className="flex items-center gap-1" aria-label={`Cores do Brand Kit: ${brandKit!.colors.join(', ')}`}>
                  {brandKit!.colors.slice(0, 6).map((color) => (
                    <span key={color} title={color} className="size-4 rounded-full border border-white/15" style={{ backgroundColor: color }} />
                  ))}
                </div>
              )}
            </div>
            {brandKit!.fonts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {brandKit!.fonts.map((font) => (
                  <span
                    key={font}
                    className="rounded border border-grafite-elevado bg-grafite px-1.5 py-0.5 text-[10px] text-branco-cru"
                  >
                    {font}
                  </span>
                ))}
              </div>
            )}
            {brandKit!.toneOfVoice && <p className="text-xs text-nevoa">{brandKit!.toneOfVoice}</p>}
            {brandKit!.referenceImages.length > 0 && (
              <div className="flex items-center gap-1.5">
                {brandKit!.referenceImages.slice(0, 4).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      alt="Referência visual do Brand Kit"
                      className="size-10 rounded-md border border-white/10 object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-grafite-elevado bg-grafite/40 p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-nevoa">Informações</p>
        {overviewPending ? (
          <PanelLoading />
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="font-display text-lg font-bold text-branco-cru">{overview?.clickup?.open_tasks ?? 0}</p>
              <p className="text-[10px] text-nevoa">Tarefas abertas</p>
            </div>
            <div>
              <p className="font-display text-lg font-bold text-branco-cru">{overview?.conversations.total ?? 0}</p>
              <p className="text-[10px] text-nevoa">Conversas</p>
            </div>
            <div>
              <p className="font-display text-lg font-bold text-branco-cru">{overview?.studio.total ?? 0}</p>
              <p className="text-[10px] text-nevoa">Assets</p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-grafite-elevado bg-grafite/40 p-4 sm:col-span-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Memória</p>
          {memory?.updatedAt && (
            <p className="shrink-0 font-mono text-[10px] text-nevoa">Atualizado {formatRelativeTime(memory.updatedAt)}</p>
          )}
        </div>
        {memoryPending ? (
          <PanelLoading />
        ) : !memory?.content ? (
          <p className="text-xs text-nevoa">Nenhuma memória deste cliente ainda.</p>
        ) : (
          <MemoryContent content={memory.content} />
        )}
      </div>
    </div>
  );
}
