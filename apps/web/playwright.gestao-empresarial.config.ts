import { defineConfig, devices } from '@playwright/test';

/**
 * E2E da Gestão Empresarial contra o ambiente 100% LOCAL (`scripts/gestao-empresarial/local.sh up`):
 * login falso só de loopback, banco e API locais. Não usa nenhuma credencial real nem sobe servidor
 * por conta própria: se o ambiente não estiver no ar, os testes falham dizendo isso.
 *
 *   pnpm --filter @desigual-os/web exec playwright test -c playwright.gestao-empresarial.config.ts
 */
export default defineConfig({
  testDir: './tests/e2e-gestao-empresarial',
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: process.env.GESTAO_E2E_BASE_URL ?? 'http://localhost:3210', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'] },
});
