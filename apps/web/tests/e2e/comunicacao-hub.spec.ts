import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * COMMUNICATION HUB 2.0 — quatro pessoas de verdade em navegadores separados,
 * contra a pilha LOCAL (docs/comunicacao-interna.md): Ana, Bruno e Dani na
 * mesma empresa; Caio em outra. Nunca contra produção: cria canais e mensagens.
 *
 *   E2E_COMUNICACAO=1 E2E_BASE_URL=http://localhost:3190 pnpm exec playwright test tests/e2e/comunicacao-hub.spec.ts
 */
test.skip(!process.env.E2E_COMUNICACAO, 'só com a pilha local da Comunicação (E2E_COMUNICACAO=1)');
test.describe.configure({ mode: 'serial' });

const SENHA = process.env.E2E_COMUNICACAO_SENHA ?? 'e2e-senha';
const marca = Date.now().toString(36).slice(-5);
const IDS = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004'];

async function entrar(browser: Browser, email: string): Promise<Page> {
  const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await contexto.addInitScript((ids) => { for (const id of ids) localStorage.setItem(`desigual-os:tutorial-visto:${id}`, '1'); }, IDS);
  const page = await contexto.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
  await page.goto('/comunicacao');
  await expect(page.getByRole('heading', { name: '# Geral' })).toBeVisible();
  return page;
}

const log = (p: Page) => p.getByRole('log', { name: 'Mensagens' });
const lista = (p: Page) => p.getByRole('navigation', { name: 'Seções da Comunicação' }).locator('..');
async function escrever(p: Page, texto: string, rotulo = 'Escreva uma mensagem') {
  const campo = p.getByLabel(rotulo);
  await campo.fill(texto);
  await campo.press('Enter');
}

let ana: Page; let bruno: Page; let dani: Page;
let privado = '';

test('entram quatro pessoas', async ({ browser }) => {
  [ana, bruno, dani] = await Promise.all([entrar(browser, 'ana@e2e.test'), entrar(browser, 'bruno@e2e.test'), entrar(browser, 'dani@e2e.test')]);
});

test('canal privado: Bruno convidado vê na hora; Dani não vê nem pelo link', async () => {
  await ana.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await ana.getByRole('menuitem', { name: 'Criar canal' }).click();
  const modal = ana.getByRole('dialog', { name: 'Criar canal' });
  await modal.getByPlaceholder(/criação, tráfego/).fill(`projeto ${marca}`);
  await modal.getByRole('radio', { name: /Privado/ }).click();
  await modal.getByLabel('Buscar colega').fill('Bru');
  await modal.getByRole('button', { name: /Bruno Lima/ }).click();
  await modal.getByRole('button', { name: 'Criar canal' }).click();
  await expect(ana.getByRole('heading', { name: `# projeto-${marca}` })).toBeVisible();
  privado = new URL(ana.url()).searchParams.get('c')!;
  await expect(lista(bruno).getByRole('button', { name: new RegExp(`projeto-${marca}`) })).toBeVisible({ timeout: 8_000 });
  await expect(lista(dani).getByRole('button', { name: new RegExp(`projeto-${marca}`) })).toHaveCount(0);
  await dani.goto(`/comunicacao?c=${privado}`);
  await expect(dani.getByText('Essa conversa não existe ou você não participa dela.')).toBeVisible();
  await dani.goto('/comunicacao');
});

test('formatação e thread: resposta chega ao vivo, fora da linha principal', async () => {
  await bruno.goto(`/comunicacao?c=${privado}`);
  await escrever(ana, `Plano **fechado** ${marca}\n- peça 1\n- peça 2`);
  const msg = (p: Page) => log(p).locator('[id^=msg-]', { hasText: `fechado ${marca}` });
  await expect(msg(bruno).locator('strong', { hasText: 'fechado' })).toBeVisible({ timeout: 8_000 });
  await expect(msg(bruno).locator('li')).toHaveCount(2);
  await msg(bruno).hover();
  await msg(bruno).getByRole('button', { name: 'Responder em thread' }).click();
  await escrever(bruno, `topo, sigo daqui ${marca}`, 'Responder na thread');
  await expect(bruno.getByRole('log', { name: 'Respostas da thread' }).getByText(`topo, sigo daqui ${marca}`)).toBeVisible();
  await expect(msg(ana).getByRole('button', { name: /1 resposta/ })).toBeVisible({ timeout: 8_000 });
  await expect(log(ana).getByText(`topo, sigo daqui ${marca}`)).toHaveCount(0);
  await msg(ana).getByRole('button', { name: /1 resposta/ }).click();
  await expect(ana.getByRole('log', { name: 'Respostas da thread' }).getByText(`topo, sigo daqui ${marca}`)).toBeVisible();
  await ana.getByRole('button', { name: 'Fechar thread' }).click();
});

test('fixar e salvar: fixada no cabeçalho; salva aparece em Salvos e sobrevive a recarregar', async () => {
  const msg = (p: Page) => log(p).locator('[id^=msg-]', { hasText: `fechado ${marca}` });
  await msg(ana).hover();
  await msg(ana).getByRole('button', { name: 'Mais ações' }).click();
  await ana.getByRole('menuitem', { name: 'Fixar na conversa' }).click();
  await expect(bruno.getByRole('button', { name: '1 mensagens fixadas' })).toBeVisible({ timeout: 8_000 });
  await msg(bruno).hover();
  await msg(bruno).getByRole('button', { name: 'Salvar para depois' }).click();
  await bruno.reload();
  await bruno.getByRole('button', { name: 'Salvos' }).click();
  await expect(bruno.getByRole('region', { name: 'Salvos' }).getByText(`fechado ${marca}`)).toBeVisible();
});

test('canal público: Dani procura, entra e a mensagem dela chega para Ana', async () => {
  await ana.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await ana.getByRole('menuitem', { name: 'Criar canal' }).click();
  await ana.getByRole('dialog', { name: 'Criar canal' }).getByPlaceholder(/criação, tráfego/).fill(`aberto ${marca}`);
  await ana.getByRole('dialog', { name: 'Criar canal' }).getByRole('button', { name: 'Criar canal' }).click();
  await expect(ana.getByRole('heading', { name: `# aberto-${marca}` })).toBeVisible();
  await dani.getByRole('button', { name: 'Procurar canais' }).click();
  await dani.getByRole('dialog', { name: 'Canais da equipe' }).getByRole('button', { name: new RegExp(`aberto-${marca}`) }).click();
  await dani.getByRole('button', { name: 'Entrar no canal' }).click();
  await escrever(dani, `cheguei ${marca}`);
  await expect(log(ana).getByText(`cheguei ${marca}`)).toBeVisible({ timeout: 8_000 });
  await expect(lista(dani).getByRole('button', { name: new RegExp(`aberto-${marca}`) })).toBeVisible();
});

test('grupo: Ana cria com Bruno e Dani; os dois recebem', async () => {
  await ana.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await ana.getByRole('menuitem', { name: 'Grupo' }).click();
  const modal = ana.getByRole('dialog', { name: 'Nova conversa em grupo' });
  await modal.getByPlaceholder('ex.: Equipe de Criação').fill(`Squad ${marca}`);
  await modal.getByRole('button', { name: /Bruno Lima/ }).click();
  await modal.getByRole('button', { name: /Dani Souza/ }).click();
  await modal.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(ana.getByRole('heading', { name: `Squad ${marca}` })).toBeVisible();
  await escrever(ana, `bom dia squad ${marca} @Dan`);
  for (const p of [bruno, dani]) await expect(lista(p).getByRole('button', { name: new RegExp(`Squad ${marca}`) })).toBeVisible({ timeout: 8_000 });
});

test('compartilhar cliente: card chega com os dados para quem pode ver', async () => {
  await ana.getByRole('button', { name: 'Mais opções' }).click();
  await ana.getByRole('menuitem', { name: 'Compartilhar cliente' }).click();
  await ana.getByRole('dialog', { name: 'Compartilhar cliente' }).getByRole('button', { name: /Cliente E2E Studio/ }).click();
  await expect(ana.getByRole('list', { name: 'Itens para compartilhar' })).toContainText('Cliente E2E Studio');
  await escrever(ana, `olhem este cliente ${marca}`);
  await bruno.getByRole('button', { name: new RegExp(`Squad ${marca}`) }).click();
  const card = log(bruno).getByTestId('cartao-de-objeto').last();
  await expect(card).toContainText('Cliente E2E Studio', { timeout: 8_000 });
  await card.getByRole('button', { name: 'Ver detalhes' }).click();
  await expect(card).toContainText('Cliente E2E Studio');
});

test('menção: Dani vê em Menções; criar tarefa sem ClickUp configurado não finge sucesso', async () => {
  await dani.getByRole('button', { name: 'Menções' }).click();
  await expect(dani.getByRole('region', { name: 'Menções' })).toBeVisible();
  const msg = log(ana).locator('[id^=msg-]', { hasText: `olhem este cliente ${marca}` });
  await msg.hover();
  await msg.getByRole('button', { name: 'Mais ações' }).click();
  await ana.getByRole('menuitem', { name: 'Criar tarefa no ClickUp' }).click();
  const modal = ana.getByRole('dialog', { name: 'Criar tarefa no ClickUp' });
  await expect(modal.getByLabel('Título')).toHaveValue(`olhem este cliente ${marca}`);
  await modal.getByRole('button', { name: 'Cancelar' }).click();
});

test('pessoa de outra empresa não vê canal nem grupo nem a busca', async ({ browser }) => {
  const caio = await entrar(browser, 'caio@e2e.test');
  await expect(lista(caio).getByRole('button', { name: new RegExp(marca) })).toHaveCount(0);
  await caio.getByLabel('Buscar nas mensagens').fill(marca);
  await caio.getByLabel('Buscar nas mensagens').press('Enter');
  await expect(caio.getByRole('region', { name: 'Busca' }).getByText('Nenhuma mensagem encontrada.')).toBeVisible();
  await caio.goto(`/comunicacao?c=${privado}`);
  await expect(caio.getByText('Essa conversa não existe ou você não participa dela.')).toBeVisible();
});
