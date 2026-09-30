import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// ESM: não há __dirname. O config é carregado como módulo pelo Playwright.
const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * AS CREDENCIAIS DE QA SÃO CARREGADAS AQUI, e o motivo é uma falha de
 * instrumento, não uma conveniência.
 *
 * Medido em 30/09/2026: `playwright test control-plane.spec.ts` rodou e
 * imprimiu "23 skipped", saindo com código ZERO. A suíte inteira se
 * auto-desligou porque `QA_USER_EMAIL`/`QA_USER_PASSWORD` só existem em
 * `.env.local` e nada aqui os lia — e um comando que valida NADA e devolve
 * sucesso é a pior espécie de teste, porque é indistinguível de um que passou.
 *
 * O `test.skip` continua existindo pro CI, onde segredo não é commitado. O que
 * muda é que na máquina de quem desenvolve as credenciais ESTÃO ali, então o
 * skip não pode mais acontecer por descuido de ambiente.
 */
function carregarEnvLocal(): void {
  /**
   * A ORDEM É A PRECEDÊNCIA: shell vence `.env.local`, que vence `.env`.
   *
   * `.env` entrou na lista porque a conferência de 30/09/2026 mostrou que
   * `CLICKUP_API_KEY` mora só lá — e sem ela, os specs que provam escrita real
   * no ClickUp desligavam sozinhos exatamente como os outros faziam por falta
   * de QA_USER_*. Consertar uma fonte e deixar a outra fora seria fechar metade
   * da porta.
   */
  for (const caminho of [
    resolve(AQUI, '.env.local'),
    resolve(AQUI, '../../.env.local'),
    resolve(AQUI, '../../.env'),
  ]) {
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linha);
      if (!m) continue;
      const [, chave, valorCru] = m;
      // Variável já definida no shell VENCE o arquivo: é assim que se aponta a
      // suíte pra outro ambiente sem editar arquivo nenhum.
      if (process.env[chave!] !== undefined) continue;
      process.env[chave!] = valorCru!.trim().replace(/^["']|["']$/g, '');
    }
  }
}

carregarEnvLocal();

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
        //
        // E2E_CHROME_ARGS passa argumentos extras ao Chromium. O uso real é
        // rodar contra PRODUÇÃO de dentro da tailnet: ali o hostname da API
        // resolve pro IP privado (100.x) e o Chrome bloqueia por Private
        // Network Access antes de qualquer asserção. Mapear o hostname pro IP
        // público do Funnel reproduz o browser de quem está fora da tailnet:
        //   E2E_CHROME_ARGS='--host-resolver-rules=MAP <api-host> <ip-publico>'
        ...(!process.env.CI && (process.env.E2E_INSECURE_BROWSER || process.env.E2E_CHROME_ARGS)
          ? {
              launchOptions: {
                args: [
                  ...(process.env.E2E_INSECURE_BROWSER ? ['--disable-web-security'] : []),
                  ...(process.env.E2E_CHROME_ARGS ? process.env.E2E_CHROME_ARGS.split('|') : []),
                ],
              },
            }
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
