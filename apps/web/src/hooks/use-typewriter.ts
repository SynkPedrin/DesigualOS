import { useEffect, useRef, useState } from 'react';

/** Reveals text progressively so an already-resolved reply still reads as a stream,
 * not a block dropping in at once. Skips straight to full text on later re-renders
 * of the same content (only streams once per unique text). */
export function useTypewriter(text: string, enabled: boolean) {
  const [revealed, setRevealed] = useState(enabled ? '' : text);
  const streamedTextRef = useRef<string | null>(enabled ? null : text);

  useEffect(() => {
    if (!enabled || streamedTextRef.current === text) {
      setRevealed(text);
      return;
    }
    streamedTextRef.current = text;
    let index = 0;
    const chunkSize = 3;
    const interval = setInterval(() => {
      index += chunkSize;
      setRevealed(text.slice(0, index));
      if (index >= text.length) clearInterval(interval);
    }, 16);
    return () => clearInterval(interval);
  }, [text, enabled]);

  return revealed;
}
