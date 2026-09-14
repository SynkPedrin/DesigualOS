import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * jsdom (não 'node') porque fabric.js referencia document/window na
 * avaliação do módulo - mesmo motivo pelo qual o editor todo vive atrás de
 * next/dynamic(ssr:false) em studio-content.tsx.
 *
 * tests/e2e é território do Playwright (`pnpm test:e2e`): os specs dele
 * usam test.describe do @playwright/test e explodem se o vitest tentar
 * rodar (achado da integração de 11/09/2026).
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['tests/e2e/**', '**/node_modules/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
