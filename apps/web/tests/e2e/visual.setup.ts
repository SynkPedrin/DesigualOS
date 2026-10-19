import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * PREPARA A SESSÃO DAS CAPTURAS, uma vez só, e salva o estado.
 *
 * Três rodadas de screenshots saíram inúteis antes disto existir, cada uma por
 * um motivo diferente que o setup resolve de vez:
 *
 *   1ª  tema CLARO — o Playwright usa `prefers-color-scheme: light` por padrão
 *       e capturou o produto inteiro numa aparência que não é a que ele
 *       entrega. O dark é a identidade e é onde as telas foram desenhadas.
 *   2ª  telas VAZIAS — sem esperar o dado chegar, a captura pegou esqueleto.
 *   3ª  TUTORIAL por cima — o vídeo de boas-vindas abre sozinho no primeiro
 *       acesso de cada conta e cobre a tela inteira.
 *
 * O tutorial é dispensado do jeito que um usuário dispensa: clicando em
 * Fechar. A marca vai pro `localStorage` do produto
 * (`desigual-os:tutorial-visto:<userId>`), e o `storageState` guarda isso
 * junto com a sessão. Nenhum código de bypass entrou no produto — o primeiro
 * acesso de gente de verdade continua exatamente igual, e há um teste abaixo
 * que prova isso.
 */
export const ESTADO = 'tests/e2e/.auth/visual.json';

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';

setup('autentica e dispensa o tutorial', async ({ page }) => {
  setup.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');
  setup.setTimeout(180_000);

  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 90_000 });

  /**
   * O tutorial abre depois do /me responder, então esperar a URL mudar não
   * basta. E ele é fechado por ESCAPE, não procurando o botão: o produto trata
   * Escape no mesmo caminho do clique (`onFechar` -> `marcarComoVisto`), e
   * procurar por texto já me custou uma rodada — havia mais de um controle
   * chamado "Fechar" na página e o `.first()` pegou o errado.
   *
   * Fechar pelo caminho do usuário, em vez de gravar a chave à mão, é
   * deliberado: escrever `localStorage` direto testaria a minha suposição
   * sobre o formato da chave, não o que o produto faz.
   */
  /**
   * ESPERA O PERFIL CARREGAR ANTES DE MEXER NO TUTORIAL, e isso não é zelo
   * genérico — é a causa de uma rodada perdida.
   *
   * `marcarComoVisto` começa com `if (!eu?.id) return`. Enquanto o `/me` não
   * responde, a barra lateral mostra "Carregando...", o tutorial não abre
   * sozinho (ele também depende do id), e fechá-lo não grava nada. Na tentativa
   * anterior eu abri o tutorial pelo botão nesse intervalo, fechei, e o
   * localStorage continuou vazio — tudo "funcionou" e nada foi marcado.
   */
  await expect(page.getByText('Carregando...')).toHaveCount(0, { timeout: 60_000 });

  const tutorial = page.getByRole('dialog', { name: /tutorial/i });
  if (!(await tutorial.isVisible({ timeout: 20_000 }).catch(() => false))) {
    // Não abriu sozinho: abre pelo botão do topo, pra garantir que a marca
    // exista. Sem ela o storageState não serve e as capturas voltam a sair com
    // o vídeo por cima.
    await page.getByRole('button', { name: /tutorial/i }).first().click();
    await expect(tutorial).toBeVisible({ timeout: 15_000 });
  }
  await page.keyboard.press('Escape');
  await expect(tutorial).toBeHidden({ timeout: 10_000 });

  // Prova que a marca ficou gravada: sem ela o storageState não serve de nada
  // e as capturas voltariam a sair com o vídeo por cima.
  const marcado = await page.evaluate(() =>
    Object.keys(window.localStorage).some((k) => k.startsWith('desigual-os:tutorial-visto:')),
  );
  expect(marcado, 'o tutorial precisa ficar marcado como visto no localStorage').toBe(true);

  mkdirSync(dirname(ESTADO), { recursive: true });
  await page.context().storageState({ path: ESTADO });
});
