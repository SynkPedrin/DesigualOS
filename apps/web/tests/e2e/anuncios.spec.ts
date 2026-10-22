import { execFileSync } from 'node:child_process';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * LANÇAMENTO DA COMUNICAÇÃO — anúncio + tutorial guiado, com pessoas de verdade
 * em navegadores separados, contra a pilha LOCAL (docs/comunicacao-interna.md).
 * O rollout é mexido direto no Postgres local de E2E (o mesmo que o painel de
 * admin faria). Nunca contra produção.
 *
 *   E2E_COMUNICACAO=1 E2E_BASE_URL=http://localhost:3190 pnpm exec playwright test tests/e2e/anuncios.spec.ts
 */
test.skip(!process.env.E2E_COMUNICACAO, 'só com a pilha local da Comunicação (E2E_COMUNICACAO=1)');
test.describe.configure({ mode: 'serial' });

const SENHA = process.env.E2E_COMUNICACAO_SENHA ?? 'e2e-senha';
const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BRUNO = 'aaaaaaaa-0000-4000-8000-000000000002';
const DANI = 'aaaaaaaa-0000-4000-8000-000000000004';
const CHAVE = 'communication_hub_launch_v1';

function sql(q: string): string {
  return execFileSync('docker', ['exec', 'chat-qa-pg', 'psql', '-U', 'postgres', '-d', process.env.E2E_DB ?? 'e2e_chat', '-tAc', q], { encoding: 'utf8' }).trim();
}
const estadoDe = (user: string) => sql(`select s.state from feature_announcement_states s join feature_announcements a on a.id = s.announcement_id where a.key = '${CHAVE}' and s.user_id = '${user}'`);

async function entrar(browser: Browser, email: string, opcoes: { boasVindasVisto?: boolean; viewport?: { width: number; height: number } } = {}): Promise<Page> {
  const contexto = await browser.newContext({ viewport: opcoes.viewport ?? { width: 1440, height: 900 } });
  if (opcoes.boasVindasVisto !== false) {
    await contexto.addInitScript((ids) => { for (const id of ids) localStorage.setItem(`desigual-os:tutorial-visto:${id}`, '1'); }, [ANA, BRUNO, DANI]);
  }
  const page = await contexto.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
  return page;
}

const modal = (p: Page) => p.getByRole('dialog', { name: 'A comunicação da sua equipe evoluiu.' });
const cartao = (p: Page) => p.getByTestId('tour').getByRole('dialog');
/** A etapa achou o elemento real e o destacou (não caiu no "no meio da tela"). */
async function destacou(p: Page) {
  await expect(p.getByTestId('tour-destaque')).toBeVisible({ timeout: 8_000 });
  await expect(cartao(p)).not.toContainText('Abrindo…');
  await p.waitForTimeout(300);
}

test.beforeAll(() => {
  sql(`delete from feature_announcement_states where announcement_id = (select id from feature_announcements where key = '${CHAVE}')`);
  sql(`delete from notifications where dedupe_key = 'announcement:${CHAVE}'`);
  sql(`update feature_announcements set rollout = 'off', active = true, qa_user_ids = '{}' where key = '${CHAVE}'`);
});

test('desligado: ninguém vê o anúncio', async ({ browser }) => {
  const ana = await entrar(browser, 'ana@e2e.test');
  await ana.waitForTimeout(2500);
  await expect(modal(ana)).toHaveCount(0);
  await ana.context().close();
});

test('rollout QA: Ana (QA) recebe; Bruno não', async ({ browser }) => {
  sql(`update feature_announcements set rollout = 'qa', qa_user_ids = array['${ANA}']::uuid[] where key = '${CHAVE}'`);
  const [ana, bruno] = await Promise.all([entrar(browser, 'ana@e2e.test'), entrar(browser, 'bruno@e2e.test')]);
  await expect(modal(ana)).toBeVisible({ timeout: 15_000 });
  await expect(modal(ana).getByText('Novidade', { exact: true })).toBeVisible();
  await expect(modal(ana).getByText('Conheça o novo espaço de colaboração do Desigual OS.')).toBeVisible();
  await expect(modal(ana).getByRole('img', { name: /Prévia da tela de Comunicação/ })).toBeVisible();
  await expect(modal(ana).getByRole('button', { name: 'Conhecer a novidade' })).toBeFocused();
  await ana.waitForTimeout(500);
  await ana.screenshot({ path: 'test-results/anuncio-desktop.png' });
  await bruno.waitForTimeout(2500);
  await expect(modal(bruno)).toHaveCount(0);
  await bruno.context().close();

  // O tutorial inteiro, com os elementos reais.
  await modal(ana).getByRole('button', { name: 'Conhecer a novidade' }).click();
  await expect(modal(ana)).toHaveCount(0);
  await expect(cartao(ana)).toContainText('Etapa 1 de 6');
  await expect(cartao(ana)).toContainText('Tudo começa aqui');
  await destacou(ana);
  await ana.screenshot({ path: 'test-results/tour-1-menu.png' });
  await cartao(ana).getByRole('button', { name: 'Próximo' }).click();
  await expect(cartao(ana)).toContainText('Converse com toda a equipe');
  await destacou(ana);
  await expect(ana).toHaveURL(/\/comunicacao/);
  await cartao(ana).getByRole('button', { name: 'Próximo' }).click();
  await expect(cartao(ana)).toContainText('Fale diretamente com seus colegas');
  await destacou(ana);
  await cartao(ana).getByRole('button', { name: 'Próximo' }).click();
  await expect(cartao(ana)).toContainText('Compartilhe arquivos com facilidade');
  await destacou(ana);
  await ana.screenshot({ path: 'test-results/tour-4-anexos.png' });
  await cartao(ana).getByRole('button', { name: 'Próximo' }).click();
  await expect(cartao(ana)).toContainText('Conecte conversas ao trabalho');
  await destacou(ana);
  // a etapa abre o menu do "+" para mostrar o compartilhamento
  await expect(ana.getByRole('button', { name: 'Mais opções' })).toHaveAttribute('aria-expanded', 'true');
  await ana.screenshot({ path: 'test-results/tour-5-compartilhar.png' });
  await cartao(ana).getByRole('button', { name: 'Anterior' }).click();
  await expect(cartao(ana)).toContainText('Compartilhe arquivos com facilidade');
  await expect(ana.getByRole('button', { name: 'Mais opções' })).toHaveAttribute('aria-expanded', 'false');
  await ana.keyboard.press('ArrowRight');
  await expect(cartao(ana)).toContainText('Conecte conversas ao trabalho');
  await cartao(ana).getByRole('button', { name: 'Próximo' }).click();
  await expect(cartao(ana)).toContainText('Tudo pronto para começar!');
  await cartao(ana).getByRole('button', { name: 'Abrir Comunicação' }).click();
  await expect(ana.getByTestId('tour')).toHaveCount(0);
  await expect(ana).toHaveURL(/\/comunicacao/);
  await expect.poll(() => estadoDe(ANA)).toBe('completed');

  // Recarregou: não volta. Outro aparelho: também não.
  await ana.reload();
  await ana.waitForTimeout(2500);
  await expect(modal(ana)).toHaveCount(0);
  const outroAparelho = await entrar(browser, 'ana@e2e.test');
  await outroAparelho.waitForTimeout(2500);
  await expect(modal(outroAparelho)).toHaveCount(0);
  await outroAparelho.context().close();

  // O aviso no sino continua lá e abre o tutorial.
  await ana.getByRole('button', { name: 'Notificações' }).click();
  const aviso = ana.getByRole('button', { name: /Nova funcionalidade: Comunicação/ });
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('Conhecer');
  await aviso.click();
  await expect(cartao(ana)).toContainText('Etapa 1 de 6');
  await ana.keyboard.press('Escape');
  await expect(ana.getByTestId('tour')).toHaveCount(0);
  // fechar pela notificação depois de concluir não "desconclui"
  await expect.poll(() => estadoDe(ANA)).toBe('completed');
  expect(sql(`select count(*) from notifications where user_id = '${ANA}' and dedupe_key = 'announcement:${CHAVE}'`)).toBe('1');

  // Ajuda → Conhecer Comunicação reabre quando a pessoa quiser.
  await ana.goto('/comunicacao');
  await ana.getByRole('button', { name: 'Ajuda da Comunicação' }).click();
  await ana.getByRole('menuitem', { name: 'Conhecer Comunicação' }).click();
  await expect(cartao(ana)).toContainText('Tudo começa aqui');
  await cartao(ana).getByRole('button', { name: 'Pular' }).click();
  await expect(ana.getByTestId('tour')).toHaveCount(0);
  await ana.context().close();
});

test('para todos: Bruno recebe na próxima entrada; "Explorar depois" não volta', async ({ browser }) => {
  sql(`update feature_announcements set rollout = 'all' where key = '${CHAVE}'`);
  const bruno = await entrar(browser, 'bruno@e2e.test');
  await expect(modal(bruno)).toBeVisible({ timeout: 15_000 });
  await modal(bruno).getByRole('button', { name: 'Explorar depois' }).click();
  await expect(modal(bruno)).toHaveCount(0);
  await expect.poll(() => estadoDe(BRUNO)).toBe('dismissed');
  await bruno.reload();
  await bruno.waitForTimeout(2500);
  await expect(modal(bruno)).toHaveCount(0);
  // sem rede para gravar o progresso: o tutorial segue
  await bruno.route('**/announcements/*/events', (r) => r.abort());
  await bruno.goto('/comunicacao');
  await bruno.getByRole('button', { name: 'Ajuda da Comunicação' }).click();
  await bruno.getByRole('menuitem', { name: 'Conhecer Comunicação' }).click();
  await cartao(bruno).getByRole('button', { name: 'Próximo' }).click();
  await expect(cartao(bruno)).toContainText('Etapa 2 de 6');
  await bruno.context().close();
});

test('com o tutorial de boas-vindas aberto, o anúncio espera; fechou, aparece (celular)', async ({ browser }) => {
  const dani = await entrar(browser, 'dani@e2e.test', { boasVindasVisto: false, viewport: { width: 390, height: 844 } });
  const boasVindas = dani.getByRole('dialog', { name: 'Tutorial do Desigual OS' });
  await expect(boasVindas).toBeVisible({ timeout: 15_000 });
  await dani.waitForTimeout(2500);
  await expect(modal(dani)).toHaveCount(0);
  await boasVindas.getByRole('button', { name: /Fechar/ }).click();
  await expect(modal(dani)).toBeVisible({ timeout: 15_000 });
  await dani.screenshot({ path: 'test-results/anuncio-celular.png' });
  await modal(dani).getByRole('button', { name: 'Conhecer a novidade' }).click();
  // no celular o menu lateral é gaveta fechada: a etapa aparece no meio, sem travar
  await expect(cartao(dani)).toContainText('Acesse Comunicação pelo menu lateral', { timeout: 10_000 });
  await dani.screenshot({ path: 'test-results/tour-celular-1.png' });
  for (let i = 0; i < 3; i++) await cartao(dani).getByRole('button', { name: 'Próximo' }).click();
  await expect(cartao(dani)).toContainText('Compartilhe arquivos com facilidade');
  await expect(dani.getByTestId('tour-destaque')).toBeVisible({ timeout: 10_000 });
  await expect(cartao(dani)).not.toContainText('Abrindo…');
  // o cartão não pode cobrir o botão que ele aponta (no celular o composer fica embaixo)
  const botaoMais = await dani.getByRole('button', { name: 'Mais opções' }).boundingBox();
  const caixaDoCartao = await cartao(dani).boundingBox();
  expect(botaoMais && caixaDoCartao && (caixaDoCartao.y + caixaDoCartao.height <= botaoMais.y || caixaDoCartao.y >= botaoMais.y + botaoMais.height)).toBe(true);
  await dani.waitForTimeout(300);
  await dani.screenshot({ path: 'test-results/tour-celular-4.png' });
  await dani.context().close();
});
