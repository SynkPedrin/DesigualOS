import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // localhost, não 127.0.0.1: o Next 16 bloqueia dev resources cross-origin
    // (allowedDevOrigins) e a página não hidratava via 127.0.0.1 — o form de
    // login submetia nativo (GET /login?) e todo teste de aceite falhava.
    //
    // E2E_BASE_URL aponta a suíte pro ambiente publicado (14/09/2026): desde
    // que a API passou a rodar com FRONTEND_URL da Vercel, o CORS barra o
    // frontend local, então validar de verdade só acontece contra o deploy.
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Opt-in explícito (E2E_INSECURE_BROWSER=1) pra rodar a suíte com o
        // frontend LOCAL contra a API publicada: ela responde com o
        // Access-Control-Allow-Origin da Vercel, então o browser barra
        // localhost antes de qualquer teste rodar. Desliga só a checagem do
        // browser — a de verdade continua sendo verificada no preflight da
        // API. NUNCA ligar em CI: mascararia bug real de CORS.
        ...(process.env.E2E_INSECURE_BROWSER && !process.env.CI
          ? { launchOptions: { args: ['--disable-web-security'] } }
          : {}),
      },
    },
  ],
  // Contra ambiente publicado não há servidor pra subir: o app já está no ar.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'http://localhost:3000/login',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
