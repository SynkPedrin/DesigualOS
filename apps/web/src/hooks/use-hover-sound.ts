'use client';

import { useCallback, useRef } from 'react';

/**
 * A tiny, very quiet "tick" synthesized with the Web Audio API on hover — no audio asset
 * needed. One shared AudioContext for the whole app (creating one per hover would be wasteful
 * and some browsers cap how many can exist). Browsers block audio before any user gesture, so
 * the first hover before a click may stay silent; that's expected, not a bug.
 */
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  sharedContext ??= new AudioContextClass();
  return sharedContext;
}

export function useHoverSound(frequency = 720) {
  const lastPlayedAt = useRef(0);

  return useCallback(() => {
    const now = performance.now();
    if (now - lastPlayedAt.current < 120) return; // debounce rapid re-hovers
    lastPlayedAt.current = now;

    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.1);
  }, [frequency]);
}
