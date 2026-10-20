import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * COMUNICAÇÃO INTERNA — duas pessoas de verdade, ao mesmo tempo.
 *
 * Roda contra a pilha LOCAL descrita em docs/comunicacao-interna.md (Postgres
 * descartável, Redis, API e web em modo live, Supabase Auth falso com
 * ana/bruno/caio @e2e.test). Nunca contra produção: cria mensagens e arquivos.
 *
 *   E2E_COMUNICACAO=1 E2E_BASE_URL=http://localhost:3190 pnpm exec playwright test comunicacao
 */
test.skip(!process.env.E2E_COMUNICACAO, 'só com a pilha local da Comunicação (E2E_COMUNICACAO=1)');
test.describe.configure({ mode: 'serial' });

const SENHA = process.env.E2E_COMUNICACAO_SENHA ?? 'e2e-senha';
const marca = `e2e-${Date.now().toString(36)}`;
// PNG 1x1 real (o servidor confere a assinatura e lê a dimensão).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

async function entrar(browser: Browser, email: string): Promise<Page> {
  const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Tutorial de primeiro acesso já visto (é outra tela, testada em outro lugar).
  await contexto.addInitScript(() => {
    for (const id of ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003']) {
      localStorage.setItem(`desigual-os:tutorial-visto:${id}`, '1');
    }
  });
  const page = await contexto.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
  return page;
}

async function abrirComunicacao(page: Page) {
  await page.getByRole('link', { name: /Comunicação/ }).first().click();
  await expect(page).toHaveURL(/\/comunicacao\?c=/);
  await expect(page.getByRole('heading', { name: '# Geral' })).toBeVisible();
}

async function escrever(page: Page, texto: string) {
  const campo = page.getByLabel('Escreva uma mensagem');
  await campo.fill(texto);
  await campo.press('Enter');
}

const mensagens = (page: Page) => page.getByRole('log', { name: 'Mensagens' });

let ana: Page;
let bruno: Page;
let privada = '';

test('as duas pessoas entram e veem o #Geral', async ({ browser }) => {
  ana = await entrar(browser, 'ana@e2e.test');
  bruno = await entrar(browser, 'bruno@e2e.test');
  await abrirComunicacao(ana);
  await abrirComunicacao(bruno);
});

test('mensagem no #Geral chega na outra tela sem recarregar', async () => {
  await escrever(ana, `Bom dia, equipe ${marca}`);
  await expect(mensagens(ana).getByText(`Bom dia, equipe ${marca}`)).toBeVisible();
  await expect(mensagens(bruno).getByText(`Bom dia, equipe ${marca}`)).toBeVisible({ timeout: 5_000 });
});

test('quem está em outra tela vê o contador na barra lateral, e ele some ao ler', async () => {
  await bruno.getByRole('link', { name: /Hoje/ }).first().click();
  await expect(bruno).toHaveURL(/\/today/);
  // O banco local é reaproveitado entre execuções: compara com o que já havia.
  const contador = bruno.getByLabel(/não lidas$/);
  const antes = (await contador.count()) ? Number((await contador.getAttribute('aria-label'))!.split(' ')[0]) : 0;
  await escrever(ana, `Segunda mensagem ${marca}`);
  await expect(bruno.getByLabel(`${antes + 1} não lidas`)).toBeVisible({ timeout: 5_000 });
  await abrirComunicacao(bruno);
  await expect(mensagens(bruno).getByText(`Segunda mensagem ${marca}`)).toBeVisible();
  await expect(bruno.getByLabel(antes ? `${antes} não lidas` : /não lidas$/)).toHaveCount(antes ? 1 : 0, { timeout: 5_000 });
});

test('conversa privada com menção: aparece para o outro com não lida', async () => {
  await ana.getByRole('button', { name: 'Nova conversa' }).click();
  await ana.getByLabel('Buscar colega').fill('Bru');
  await ana.getByRole('dialog', { name: 'Nova conversa' }).getByRole('button', { name: /Bruno Lima/ }).click();
  await expect(ana.getByRole('heading', { name: 'Bruno Lima' })).toBeVisible();
  privada = new URL(ana.url()).searchParams.get('c')!;

  const campo = ana.getByLabel('Escreva uma mensagem');
  await campo.fill('Oi @Bru');
  await ana.getByRole('option', { name: /Bruno Lima/ }).click();
  await campo.pressSequentially(`pode revisar? ${marca}`);
  await campo.press('Enter');
  const comMencao = mensagens(ana).locator('[id^=msg-]', { hasText: `pode revisar? ${marca}` });
  await expect(comMencao.getByText('@Bruno Lima')).toBeVisible();
  await expect(comMencao).toContainText(`Oi @Bruno Lima pode revisar? ${marca}`);

  const linha = bruno.getByRole('button', { name: new RegExp(`Ana Ribeiro.*${marca}`) });
  await expect(linha).toBeVisible({ timeout: 5_000 });
  await linha.click();
  await expect(mensagens(bruno).getByText(`pode revisar? ${marca}`)).toBeVisible();
});

test('"digitando…" aparece para o outro lado', async () => {
  await bruno.getByLabel('Escreva uma mensagem').pressSequentially(`Já vou ${marca}`, { delay: 40 });
  await expect(ana.getByText('Bruno Lima está digitando…')).toBeVisible({ timeout: 5_000 });
  await bruno.getByLabel('Escreva uma mensagem').press('Enter');
  await expect(mensagens(ana).getByText(`Já vou ${marca}`)).toBeVisible({ timeout: 5_000 });
});

test('imagem e PDF: sobem, chegam, abrem e aparecem nos arquivos da conversa', async () => {
  await ana.locator('input[type=file]').setInputFiles([
    { name: `foto-${marca}.png`, mimeType: 'image/png', buffer: PNG },
    { name: `briefing-${marca}.pdf`, mimeType: 'application/pdf', buffer: PDF },
  ]);
  await expect(ana.getByRole('list', { name: 'Arquivos para enviar' }).getByText(`briefing-${marca}.pdf`)).toBeVisible();
  await expect(ana.getByRole('button', { name: 'Enviar' })).toBeEnabled({ timeout: 15_000 });
  await escrever(ana, `Segue o material ${marca}`);

  await expect(mensagens(bruno).getByRole('img', { name: `foto-${marca}.png` })).toBeVisible({ timeout: 10_000 });
  await expect(mensagens(bruno).getByText(`briefing-${marca}.pdf`)).toBeVisible();

  await bruno.getByRole('button', { name: 'Arquivos da conversa' }).click();
  const painel = bruno.getByRole('complementary', { name: 'Arquivos compartilhados' });
  await expect(painel.getByText(`foto-${marca}.png`)).toBeVisible();
  await expect(painel.getByText(`briefing-${marca}.pdf`)).toBeVisible();
  const download = bruno.waitForEvent('download');
  await painel.getByRole('button', { name: `Baixar briefing-${marca}.pdf` }).click();
  expect((await download).suggestedFilename()).toBe(`briefing-${marca}.pdf`);
  await painel.getByRole('button', { name: 'Fechar arquivos' }).click();
});

test('reação, edição e remoção chegam ao vivo', async () => {
  const msgDaAna = (p: Page) => mensagens(p).locator('[id^=msg-]', { hasText: `Segue o material ${marca}` });
  await msgDaAna(bruno).hover();
  await msgDaAna(bruno).getByRole('button', { name: 'Reagir' }).click();
  await msgDaAna(bruno).getByRole('button', { name: '👍' }).click();
  await expect(msgDaAna(ana).getByRole('button', { name: /👍\s*1/ })).toBeVisible({ timeout: 5_000 });

  await msgDaAna(ana).hover();
  await msgDaAna(ana).getByRole('button', { name: 'Editar' }).click();
  const edicao = ana.getByLabel('Editar mensagem');
  await edicao.fill(`Segue o material (corrigido) ${marca}`);
  await edicao.press('Enter');
  const corrigida = (p: Page) => mensagens(p).locator('[id^=msg-]', { hasText: `(corrigido) ${marca}` });
  await expect(corrigida(bruno).getByText('(editada)')).toBeVisible({ timeout: 5_000 });

  await corrigida(ana).hover();
  await corrigida(ana).getByRole('button', { name: 'Apagar' }).click();
  await ana.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
  await expect(mensagens(bruno).getByText(`(corrigido) ${marca}`)).toHaveCount(0, { timeout: 5_000 });
  await expect(mensagens(bruno).getByText('Mensagem apagada').first()).toBeVisible();
});

test('recarregar mantém tudo; busca acha a mensagem e leva até ela', async () => {
  await bruno.reload();
  await expect(mensagens(bruno).getByText(`pode revisar? ${marca}`)).toBeVisible();
  await bruno.getByLabel('Buscar nas mensagens').fill(`Bom dia, equipe ${marca}`);
  await bruno.getByRole('button', { name: new RegExp(`Bom dia, equipe ${marca}`) }).click();
  await expect(bruno.getByRole('heading', { name: '# Geral' })).toBeVisible();
  await expect(mensagens(bruno).getByText(`Bom dia, equipe ${marca}`)).toBeInViewport();
});

test('pessoa de outra empresa não vê nada disso, nem pelo link direto', async ({ browser }) => {
  const caio = await entrar(browser, 'caio@e2e.test');
  await abrirComunicacao(caio);
  await expect(mensagens(caio).getByText(marca)).toHaveCount(0);
  await caio.goto(`/comunicacao?c=${privada}`);
  await expect(caio.getByText('Essa conversa não existe ou você não participa dela.')).toBeVisible();
  const resposta = await caio.request.get(`${process.env.E2E_API_URL ?? 'http://localhost:4100'}/internal-chat/conversations/${privada}/messages`);
  expect([401, 404]).toContain(resposta.status());
});
