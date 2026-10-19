import { test, expect, type Page } from '@playwright/test';

/**
 * VARREDURA AUTENTICADA DE TODAS AS TELAS DO MENU, NO AMBIENTE PUBLICADO.
 *
 * O teste de fumaça que existe em `src/app/(shell)/telas-do-sidebar.test.tsx`
 * monta as telas em jsdom com uma API mínima — ele pega o componente que
 * estoura no render, e foi assim que as 16 telas quebradas apareceram em
 * 08/10/2026. O que ele NÃO pode pegar: rota que não existe no deploy, sessão
 * que não atravessa, CORS, e erro que só acontece com o dado real de produção.
 *
 * Esta varredura cobre exatamente essa faixa. Ela não falha na primeira tela
 * ruim de propósito: um relatório de 36 linhas vale mais que um "falhou na
 * terceira", porque o que se quer saber antes de entregar o sistema é QUANTAS
 * telas estão de pé, não qual é a primeira que não está.
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const ROTAS = [
  '/', '/activity', '/admin', '/agents', '/analytics', '/approvals', '/audit',
  '/calendar', '/chat', '/clients', '/costs', '/data-quality', '/decisions',
  '/demands', '/errors', '/health', '/history', '/inbox', '/integrations',
  '/knowledge', '/mcp', '/memory', '/midias', '/monitoring', '/organizations',
  '/people', '/permissions', '/pipeline', '/settings', '/signals', '/studio',
  '/tasks', '/today', '/tools', '/usage', '/workflows',
];

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

interface Resultado {
  rota: string;
  url: string;
  estouros: string[];
  consoleErros: string[];
  naoEncontrada: boolean;
  textoVisivel: number;
}

test('todas as telas do menu abrem autenticadas, sem estouro de JS', async ({ page }) => {
  test.setTimeout(36 * 30_000);

  const resultados: Resultado[] = [];
  let atual: Resultado | null = null;

  // `pageerror` é exceção NÃO CAPTURADA no browser — a classe exata de defeito
  // que derrubava doze telas por um `?.` faltando. Console error é mais ruidoso
  // (extensão, request abortado), então entra no relatório mas não reprova.
  page.on('pageerror', (erro) => atual?.estouros.push(erro.message.slice(0, 160)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') atual?.consoleErros.push(msg.text().slice(0, 160));
  });

  await login(page);

  for (const rota of ROTAS) {
    atual = { rota, url: '', estouros: [], consoleErros: [], naoEncontrada: false, textoVisivel: 0 };
    try {
      await page.goto(rota, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // Dá tempo do React Query resolver: skeleton não tem texto, e medir a
      // tela antes dela assentar produz falso negativo (lição de 08/10/2026).
      await page.waitForTimeout(2500);
      atual.url = new URL(page.url()).pathname;
      const corpo = (await page.locator('body').innerText().catch(() => '')) ?? '';
      atual.textoVisivel = corpo.trim().length;
      atual.naoEncontrada = /404|could not be found|página não encontrada/i.test(corpo);
    } catch (erro) {
      atual.estouros.push(`navegação: ${erro instanceof Error ? erro.message.slice(0, 120) : String(erro)}`);
    }
    resultados.push(atual);
  }
  atual = null;

  const linha = (r: Resultado) =>
    `${r.rota.padEnd(16)} ${String(r.url).padEnd(16)} texto:${String(r.textoVisivel).padStart(6)}` +
    `${r.naoEncontrada ? '  404' : ''}${r.estouros.length ? `  ESTOURO: ${r.estouros[0]}` : ''}` +
    `${r.consoleErros.length ? `  console(${r.consoleErros.length})` : ''}`;
  console.log('\n=== VARREDURA DE TELAS ===\n' + resultados.map(linha).join('\n'));

  const deslogou = resultados.filter((r) => r.url.startsWith('/login'));
  const estourou = resultados.filter((r) => r.estouros.length > 0);
  const sumiu = resultados.filter((r) => r.naoEncontrada);
  const vazia = resultados.filter((r) => r.textoVisivel < 50 && !r.naoEncontrada);

  console.log(
    `\n${resultados.length} telas · ${estourou.length} com estouro · ${sumiu.length} inexistentes · ` +
      `${vazia.length} em branco · ${deslogou.length} perderam a sessão`,
  );

  expect(deslogou.map((r) => r.rota), 'telas que jogaram de volta pro login').toEqual([]);
  expect(estourou.map((r) => `${r.rota}: ${r.estouros[0]}`), 'telas com exceção não capturada').toEqual([]);
  expect(sumiu.map((r) => r.rota), 'telas do menu que não existem no deploy').toEqual([]);
  expect(vazia.map((r) => r.rota), 'telas que renderizaram em branco').toEqual([]);
});
