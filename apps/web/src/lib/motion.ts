/**
 * Shared motion presets for the four motion systems (StudioProcessButton, AgentDock,
 * OutputCarousel/PlayerBar, AuthScene). Import springs and durations from here instead of
 * inlining transition objects, so a tuning change applies everywhere at once.
 */

export const spring = {
  /** Indicators, dots — anything that needs to feel snappy and precise. */
  snap: { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 },
  /** Shared layout transitions, coverflow transform tweens. */
  layout: { type: 'spring', stiffness: 300, damping: 30, mass: 1 },
  /** Block entrances — softer settle, less overshoot. */
  soft: { type: 'spring', stiffness: 220, damping: 26, mass: 1 },
} as const;

export const easeOutQuart = [0.16, 1, 0.3, 1] as const;

export const duration = {
  color: 0.3,
  morph: 0.32,
  exit: 0.12,
} as const;

/** 80ms — the DNA's standard stagger step. */
export const stagger = 0.08;
