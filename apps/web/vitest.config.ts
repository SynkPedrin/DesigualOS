import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * jsdom (não 'node') porque fabric.js referencia document/window na
 * avaliação do módulo - mesmo motivo pelo qual o editor todo vive atrás de
 * next/dynamic(ssr:false) em studio-content.tsx.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
