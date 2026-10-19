import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiStickerPicker } from './emoji-sticker-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stickers: Array<{ messageId: string; url: string }> = [];
vi.mock('@/hooks/use-inbox', () => ({
  useInboxStickers: () => ({ data: stickers, isPending: false }),
}));
vi.mock('./use-protected-object-url', () => ({
  useProtectedObjectUrl: (source: string | null) => ({ url: source ? `blob:${source}` : null, loading: false, error: null }),
}));

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  stickers = [];
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(props: Partial<Parameters<typeof EmojiStickerPicker>[0]> = {}) {
  const handlers = { onEmoji: vi.fn(), onSticker: vi.fn(), onStickerFile: vi.fn(), ...props };
  act(() => root!.render(<EmojiStickerPicker {...handlers} />));
  return handlers;
}

describe('EmojiStickerPicker', () => {
  it('entrega o emoji inteiro, inclusive os compostos (❤️ não vira dois botões)', () => {
    const { onEmoji } = render();
    const coracao = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === '❤️');
    expect(coracao).toBeDefined();
    act(() => coracao!.click());
    expect(onEmoji).toHaveBeenCalledWith('❤️');
  });

  it('mostra as figurinhas do WhatsApp da pessoa e envia a escolhida', () => {
    stickers = [{ messageId: 'm1', url: '/inbox/messages/m1/media' }];
    const { onSticker } = render();
    act(() => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Figurinhas')!.click());
    const thumb = container!.querySelector('button[title="Enviar figurinha"]') as HTMLButtonElement;
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe('blob:/inbox/messages/m1/media');
    act(() => thumb.click());
    expect(onSticker).toHaveBeenCalledWith(stickers[0]);
  });

  it('sem figurinhas ainda, explica de onde elas vêm', () => {
    render();
    act(() => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Figurinhas')!.click());
    expect(container!.textContent).toContain('As figurinhas que você enviar ou receber no seu WhatsApp aparecem aqui.');
  });
});
