'use client';

import { createContext, useContext } from 'react';
import type { Theme } from '@/lib/api/contracts';

export interface ThemeContextValue {
  /** The stored preference: 'light' | 'dark' | 'system'. */
  theme: Theme;
  /** What's actually applied right now ('system' resolved via prefers-color-scheme). */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
