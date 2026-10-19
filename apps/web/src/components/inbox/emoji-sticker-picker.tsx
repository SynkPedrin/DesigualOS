'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { useInboxStickers, type InboxSticker } from '@/hooks/use-inbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useProtectedObjectUrl } from './use-protected-object-url';

const EMOJIS: Array<{ label: string; items: string }> = [
  { label: 'Carinhas', items: '😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈💀💩🤡' },
  { label: 'Gestos', items: '👍👎👌🤌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏👏🙌👐🤲💪🦾✍️💅🤳' },
  { label: 'Corações', items: '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟' },
  { label: 'Trabalho', items: '✅☑️✔️❌❎⚠️🚀🔥⭐🌟✨💡📌📍📎📅📆🗓️⏰⌛📊📈📉💰💵💳🧾📝📄📁📂🗂️📢📣🎯🏆🎉🎊🎁📷🎥🎬🎤🎧💻📱☎️📞✉️📩📨🔗🔒🔑' },
  { label: 'Outros', items: '☀️🌤️⛅🌧️⛈️🌈❄️☕🍕🍔🍟🌮🍣🍰🎂🍺🍻🥂🍷⚽🏀🎮🎲🚗✈️🏠🏢🐶🐱🦁🐻🐼🌹🌻🌱🍀' },
];

function splitEmojis(items: string): string[] {
  // Segmenta por grafema: emoji com variação/ZWJ (❤️, 😮‍💨) não pode virar dois botões.
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }) : null;
  return segmenter ? Array.from(segmenter.segment(items), (s) => s.segment) : Array.from(items);
}

const RECENT_KEY = 'inbox:emojis-recentes';

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 24) : [];
  } catch {
    return [];
  }
}

function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 24);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Sem armazenamento (aba anônima): só não lembra os recentes.
  }
}

function StickerThumb({ sticker, onPick }: { sticker: InboxSticker; onPick: (sticker: InboxSticker) => void }) {
  const media = useProtectedObjectUrl(sticker.url);
  return (
    <button type="button" onClick={() => onPick(sticker)} className="flex aspect-square items-center justify-center rounded-md p-1 hover:bg-grafite-elevado" title="Enviar figurinha">
      {media.url ? <img src={media.url} alt="Figurinha" className="max-h-full max-w-full object-contain" /> : <Skeleton className="size-full" />}
    </button>
  );
}

export function EmojiStickerPicker({ onEmoji, onSticker, onStickerFile }: {
  onEmoji: (emoji: string) => void;
  onSticker: (sticker: InboxSticker) => void;
  onStickerFile: (file: File) => void;
}) {
  const [tab, setTab] = useState<'emoji' | 'sticker'>('emoji');
  const [recent, setRecent] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readRecent()));
  const stickers = useInboxStickers(tab === 'sticker');
  const fileInput = useRef<HTMLInputElement>(null);

  function pickEmoji(emoji: string) {
    rememberEmoji(emoji);
    setRecent(readRecent());
    onEmoji(emoji);
  }

  return (
    <div className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-grafite-elevado bg-grafite shadow-2xl" role="dialog" aria-label="Emojis e figurinhas">
      <div className="flex border-b border-grafite-elevado p-1">
        {(['emoji', 'sticker'] as const).map((value) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={cn('flex-1 rounded-md px-3 py-1.5 text-xs font-medium', tab === value ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
            {value === 'emoji' ? 'Emojis' : 'Figurinhas'}
          </button>
        ))}
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {tab === 'emoji' ? (
          [...(recent.length ? [{ label: 'Recentes', items: recent.join('') }] : []), ...EMOJIS].map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-1 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-nevoa">{group.label}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {splitEmojis(group.items).map((emoji, index) => (
                  <button key={`${group.label}-${index}`} type="button" onClick={() => pickEmoji(emoji)} className="flex aspect-square items-center justify-center rounded-md text-xl hover:bg-grafite-elevado">{emoji}</button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onStickerFile(file); event.target.value = ''; }} />
            <button type="button" onClick={() => fileInput.current?.click()} className="mb-2 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-grafite-elevado px-3 py-2 text-xs text-nevoa hover:text-branco-cru">
              <ImagePlus size={14} />Criar figurinha de uma imagem
            </button>
            {stickers.isPending ? (
              <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-nevoa" /></div>
            ) : stickers.data?.length ? (
              <div className="grid grid-cols-4 gap-1">
                {stickers.data.map((sticker) => <StickerThumb key={sticker.messageId} sticker={sticker} onPick={onSticker} />)}
              </div>
            ) : (
              <p className="px-2 py-6 text-center text-xs text-nevoa">As figurinhas que você enviar ou receber no seu WhatsApp aparecem aqui.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
