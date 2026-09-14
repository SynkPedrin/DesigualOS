'use client';

import { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Circle,
  Eye,
  EyeOff,
  FolderOpen,
  Group as GroupIconLucide,
  Image as ImageIconLucide,
  Layers,
  Lock,
  Minus,
  Palette,
  Pentagon,
  PenTool,
  Square,
  Star,
  Type,
  Unlock,
  Upload,
} from 'lucide-react';
import type { CanvaObject, CanvaShapeKind } from '@desigual-os/types';
import type { UseCanvaEditorResult } from '@/hooks/use-canva-editor';
import { useBrandKit } from '@/hooks/use-brand-kit';
import { useUploadStudioReference } from '@/hooks/use-studio-jobs';
import { CanvaDocumentGrid } from './canva-document-grid';
import { ImagesPanel } from './panel-images';
import { useCanvaRecentUploadsStore } from '@/stores/canva-recent-uploads-store';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

type PanelKey = 'elementos' | 'texto' | 'imagens' | 'uploads' | 'marca' | 'camadas' | 'projetos';

const OBJECT_TYPE_ICONS: Record<CanvaObject['type'], typeof Square> = {
  image: ImageIconLucide,
  text: Type,
  shape: Square,
  group: GroupIconLucide,
  path: PenTool,
};

function layerLabel(object: CanvaObject): string {
  if (object.type === 'text') return object.text.trim() || 'Texto vazio';
  if (object.type === 'shape') return `Forma - ${object.shape}`;
  if (object.type === 'group') return 'Grupo';
  if (object.type === 'path') return 'Traço de pincel';
  const filename = object.src.split('/').pop()?.split('?')[0];
  return filename || 'Imagem';
}

const SHAPE_ICONS: Record<CanvaShapeKind, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  triangle: Pentagon,
  line: Minus,
  star: Star,
};

const RAIL_ITEMS: { key: PanelKey; label: string; icon: typeof Square }[] = [
  { key: 'elementos', label: 'Elementos', icon: Square },
  { key: 'texto', label: 'Texto', icon: Type },
  { key: 'imagens', label: 'Imagens', icon: ImageIconLucide },
  { key: 'uploads', label: 'Uploads', icon: Upload },
  { key: 'camadas', label: 'Camadas', icon: Layers },
  { key: 'marca', label: 'Marca', icon: Palette },
  { key: 'projetos', label: 'Projetos', icon: FolderOpen },
];

function ElementsPanel({ editor }: { editor: UseCanvaEditorResult }) {
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      {(Object.keys(SHAPE_ICONS) as CanvaShapeKind[]).map((shape) => {
        const Icon = SHAPE_ICONS[shape];
        return (
          <button
            key={shape}
            type="button"
            onClick={() => editor.addShape(shape)}
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-grafite-elevado bg-carbono text-nevoa transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru"
          >
            <Icon size={22} />
          </button>
        );
      })}
    </div>
  );
}

function TextPanel({ editor }: { editor: UseCanvaEditorResult }) {
  return (
    <div className="space-y-2 p-3">
      {[
        { label: 'Adicionar título', variant: 'title' as const, size: 'text-lg font-black' },
        { label: 'Adicionar subtítulo', variant: 'subtitle' as const, size: 'text-sm font-semibold' },
        { label: 'Adicionar texto', variant: 'body' as const, size: 'text-xs' },
      ].map((item) => (
        <button
          key={item.variant}
          type="button"
          onClick={() => editor.addText(item.variant)}
          className={cn(
            'w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-3 text-left text-branco-cru transition-colors hover:border-roxo-eletrico/60',
            item.size,
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function UploadsPanel({ editor }: { editor: UseCanvaEditorResult }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadStudioReference();
  const recent = useCanvaRecentUploadsStore((state) => state.recent);
  const addRecent = useCanvaRecentUploadsStore((state) => state.addRecent);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const result = await upload.mutateAsync(file);
        addRecent({ url: result.url, filename: result.filename });
        await editor.addImageFromSrc(result.url);
      } catch {
        toast(`Não foi possível enviar "${file.name}".`, 'error');
      }
    }
  }

  return (
    <div className="space-y-3 p-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          // Zera o input: sem isto, escolher O MESMO arquivo de novo não
          // dispara `change` nenhum e o clique parece não fazer nada.
          const restart = () => {
            event.target.value = '';
          };
          void handleFiles(files).finally(restart);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-grafite-elevado bg-carbono px-3 py-6 text-center transition-colors hover:border-roxo-eletrico/60 disabled:opacity-60"
      >
        <Upload size={20} className="text-nevoa" />
        <span className="text-xs text-nevoa">{upload.isPending ? 'Enviando...' : 'Enviar do computador'}</span>
      </button>

      {recent.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {recent.map((item) => (
            <button
              key={item.url}
              type="button"
              onClick={() => void editor.addImageFromSrc(item.url)}
              className="aspect-square overflow-hidden rounded-md border border-grafite-elevado bg-carbono"
              title={item.filename}
            >
              <img src={item.url} alt={item.filename} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandPanel({ clientId, editor }: { clientId: string; editor: UseCanvaEditorResult }) {
  const { data: brandKit, isPending } = useBrandKit(clientId);

  if (isPending) return <div className="p-3 text-xs text-nevoa">Carregando...</div>;
  if (!brandKit || (brandKit.colors.length === 0 && !brandKit.logoUrl && brandKit.referenceImages.length === 0)) {
    return <div className="p-3 text-xs text-nevoa">Este cliente ainda não tem Brand Kit cadastrado.</div>;
  }

  return (
    <div className="space-y-4 p-3">
      {brandKit.logoUrl && (
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">Logo</p>
          <button
            type="button"
            onClick={() => void editor.addImageFromSrc(brandKit.logoUrl!)}
            className="flex aspect-video w-full items-center justify-center rounded-md border border-grafite-elevado bg-carbono p-3"
          >
            <img src={brandKit.logoUrl} alt="Logo do cliente" className="max-h-full max-w-full object-contain" />
          </button>
        </div>
      )}

      {brandKit.colors.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">Cores</p>
          <div className="flex flex-wrap gap-2">
            {brandKit.colors.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => {
                  if (editor.selection.type === 'text') editor.updateSelectedText({ fill: color });
                  else if (editor.selection.type === 'shape') editor.updateSelectedShape({ fill: color });
                  else editor.setPageBackground({ type: 'color', value: color });
                }}
                className="size-8 rounded-full border border-grafite-elevado"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-nevoa">
            Com texto/forma selecionado, aplica a cor neles. Sem seleção, vira o fundo da página.
          </p>
        </div>
      )}

      {brandKit.referenceImages.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">Referências</p>
          <div className="grid grid-cols-2 gap-2">
            {brandKit.referenceImages.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => void editor.addImageFromSrc(url)}
                className="aspect-square overflow-hidden rounded-md border border-grafite-elevado bg-carbono"
              >
                <img src={url} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Painel "Camadas" (pedido explícito: "gerenciamento de camadas das
 * imagens") - lista todos os objetos da página ativa em ordem visual (de
 * cima pra baixo = frente pra trás, convenção do Photoshop/Canva), com
 * seleção, olho (visibilidade) e cadeado (bloqueio) por item, e setas pra
 * reordenar sem precisar selecionar o objeto no canvas primeiro. */
function LayersPanel({ editor }: { editor: UseCanvaEditorResult }) {
  const objects = editor.activePage?.objects ?? [];
  const ordered = [...objects].sort((a, b) => b.zIndex - a.zIndex);

  if (ordered.length === 0) {
    return <div className="p-3 text-xs text-nevoa">Esta página ainda não tem nenhum elemento.</div>;
  }

  return (
    <div className="space-y-1 p-2">
      {ordered.map((object, index) => {
        const Icon = OBJECT_TYPE_ICONS[object.type];
        const selected = editor.selection.ids.includes(object.id);
        return (
          <div
            key={object.id}
            className={cn(
              'group flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 transition-colors',
              selected ? 'border-roxo-eletrico bg-roxo-eletrico/10' : 'border-transparent hover:bg-grafite-elevado',
            )}
          >
            <button
              type="button"
              onClick={() => editor.selectObjectById(object.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="Selecionar"
            >
              <Icon size={14} className="shrink-0 text-nevoa" />
              <span className="truncate text-xs text-branco-cru">{layerLabel(object)}</span>
            </button>
            <button
              type="button"
              onClick={() => editor.setObjectVisible(object.id, !object.visible)}
              title={object.visible ? 'Ocultar' : 'Mostrar'}
              className="flex size-6 shrink-0 items-center justify-center rounded text-nevoa hover:text-branco-cru"
            >
              {object.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button
              type="button"
              onClick={() => editor.setObjectLocked(object.id, !object.locked)}
              title={object.locked ? 'Desbloquear' : 'Bloquear'}
              className="flex size-6 shrink-0 items-center justify-center rounded text-nevoa hover:text-branco-cru"
            >
              {object.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  editor.selectObjectById(object.id);
                  editor.bringForward();
                }}
                title="Avançar uma camada"
                className="flex size-6 items-center justify-center rounded text-nevoa hover:text-branco-cru disabled:opacity-30"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                disabled={index === ordered.length - 1}
                onClick={() => {
                  editor.selectObjectById(object.id);
                  editor.sendBackward();
                }}
                title="Recuar uma camada"
                className="flex size-6 items-center justify-center rounded text-nevoa hover:text-branco-cru disabled:opacity-30"
              >
                <ArrowDown size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CanvaSidebar({
  clientId,
  editor,
  onOpenDocument,
}: {
  clientId: string;
  editor: UseCanvaEditorResult;
  onOpenDocument: (documentId: string) => void;
}) {
  const [activePanel, setActivePanel] = useState<PanelKey | null>('elementos');

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-grafite-elevado bg-grafite py-3">
        {RAIL_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activePanel === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActivePanel((current) => (current === item.key ? null : item.key))}
              aria-pressed={active}
              className={cn(
                'flex w-14 flex-col items-center gap-1 rounded-md py-2 text-[10px] transition-colors',
                active ? 'bg-roxo-eletrico/15 text-roxo-eletrico' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
              )}
            >
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </div>

      {activePanel && (
        <div
          className={cn(
            'flex w-72 shrink-0 flex-col border-r border-grafite-elevado bg-grafite/60',
            activePanel === 'imagens' ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {activePanel !== 'imagens' && (
            <div className="border-b border-grafite-elevado px-3 py-2.5">
              <p className="font-heading text-xs font-semibold uppercase tracking-wider text-branco-cru">
                {RAIL_ITEMS.find((i) => i.key === activePanel)?.label}
              </p>
            </div>
          )}
          {activePanel === 'elementos' && <ElementsPanel editor={editor} />}
          {activePanel === 'texto' && <TextPanel editor={editor} />}
          {activePanel === 'imagens' && <ImagesPanel editor={editor} />}
          {activePanel === 'uploads' && <UploadsPanel editor={editor} />}
          {activePanel === 'camadas' && <LayersPanel editor={editor} />}
          {activePanel === 'marca' && <BrandPanel clientId={clientId} editor={editor} />}
          {activePanel === 'projetos' && (
            <div className="p-3">
              <CanvaDocumentGrid clientId={clientId} onOpen={onOpenDocument} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
