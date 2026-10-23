import { expect, type Page } from '@playwright/test';

/** Entradas do login FALSO local (scripts/gestao-empresarial/auth-local.mjs). Não são contas reais. */
export const ADMIN = { email: 'e2e@local.test', senha: 'gestao-local-e2e' };
export const COLABORADOR = { email: 'colaborador@local.test', senha: 'gestao-local-colab' };

/** Sufixo da execução: cada rodada cria dados com nomes próprios e não esbarra na anterior. */
export const RODADA = Date.now().toString(36).slice(-6);

export async function entrar(page: Page, quem = ADMIN) {
  await page.goto('/login');
  // Espera a hidratação: preencher antes dela faz o React limpar o campo e o login sair vazio.
  await page.waitForLoadState('networkidle');
  await page.locator('input[type=email]').fill(quem.email);
  await page.locator('input[type=password]').fill(quem.senha);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

/** O tutorial de primeiro acesso cobre a tela; fecha se aparecer. */
export async function fecharTutorial(page: Page) {
  const fechar = page.getByRole('button', { name: 'Fechar' }).first();
  if (await fechar.isVisible({ timeout: 2_000 }).catch(() => false)) await fechar.click();
}

export async function abrir(page: Page, caminho: string) {
  await page.goto(caminho);
  await page.waitForLoadState('networkidle');
  await fecharTutorial(page);
}

/** Erros de execução da página quebram o teste: um teste verde com a tela gritando no console não prova nada. */
export function vigiarErros(page: Page): string[] {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  return erros;
}

export async function semRolagemHorizontal(page: Page) {
  const larguras = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
  expect(larguras.doc, 'a página rola na horizontal').toBeLessThanOrEqual(larguras.janela + 1);
}

/** Token da API local para preparar dados que não são o foco do teste. */
export async function tokenDaApi(): Promise<string> {
  const r = await fetch('http://localhost:4211/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN.email, password: ADMIN.senha }) });
  return ((await r.json()) as { access_token: string }).access_token;
}

export async function api<T>(token: string, metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(`http://localhost:4210/gestao-empresarial${caminho}`, { method: metodo, headers: { authorization: `Bearer ${token}`, ...(corpo !== undefined && { 'content-type': 'application/json' }) }, ...(corpo !== undefined && { body: JSON.stringify(corpo) }) });
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${await r.text()}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}
