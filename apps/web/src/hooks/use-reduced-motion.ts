'use client';

import { useReducedMotion as useFramerReducedMotion } from 'framer-motion';

/**
 * framer-motion's own hook returns `null` until the media query listener mounts (SSR-safe,
 * but awkward to branch on). Every component here just needs a boolean, defaulting to
 * "motion allowed" until we know otherwise.
 */
export function useReducedMotion(): boolean {
  return useFramerReducedMotion() ?? false;
}
