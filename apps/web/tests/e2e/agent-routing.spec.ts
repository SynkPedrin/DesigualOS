import { test, expect } from '@playwright/test';

/**
 * AGENT ROUTING RELEASE — a seleção explícita da UI é source of truth.
 *
 * Achado real (22/09/2026): o componente `AgentSelector` (agent-selector.tsx)
 * nunca é renderizado em lugar nenhum do app — dead code. O seletor REAL é
 * `AgentCard` (tela vazia do chat) / `AgentChip` (depois da primeira
 * mensagem), e o nome acessível do botão é "{Label}{Papel}" GRUDADO sem
 * espaço (ex: "JarbasTráfego", "BentoInstitucional") — um teste procurando
 * `name: /^Jarbas$/` (match exato) nunca encontra o botão e trava esperando
 * pra sempre. Por isso o "roteamento quebrado" media, na real, um seletor de
 * teste quebrado — corrigido aqui usando prefixo (`/^Jarbas/`).
 *
 * O rótulo do agente ("Jarbas", "Otto"...) é renderizado pelo próprio chat
 * acima de cada bolha de resposta (`meta.label` em chat-message.tsx) — é essa
 * a fonte de verdade usada aqui pra provar `dispatchedAgent`, não o CONTEÚDO
 * da resposta (que pode falar de qualquer coisa).
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');
test.describe.configure({ mode: 'serial', timeout: 1_800_000 });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

/** Nova conversa a cada teste — cada um abre /chat do zero (tela vazia, AgentCard visível). */
async function novaConversa(page: import('@playwright/test').Page) {
  await page.goto('/chat');
  await page.waitForTimeout(1500);
}

async function selecionarAgente(page: import('@playwright/test').Page, agente: string) {
  await page.getByRole('button', { name: new RegExp(`^${agente}`) }).first().click();
}

/** Envia, espera a bolha, devolve { label, texto } — label é o rótulo de agente renderizado acima da bolha. */
async function falarEVerAgente(
  page: import('@playwright/test').Page,
  texto: string,
  timeout = 300_000,
): Promise<{ label: string; texto: string }> {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect.poll(async () => (await campo.inputValue()).trim() === '', { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => mensagens.count(), { timeout }).toBeGreaterThan(antes);
  const nova = mensagens.nth(antes);
  const bolha = nova.getByTestId('chat-assistant-bubble');
  const conteudo = async () => (await bolha.innerText()).replace(/\n?\d\d:\d\d\n?/g, '').trim();
  await expect.poll(async () => (await conteudo()).length, { timeout }).toBeGreaterThan(5);
  await expect
    .poll(async () => {
      const a = await conteudo();
      await page.waitForTimeout(1500);
      return a === (await conteudo()) ? 'estavel' : 'crescendo';
    }, { timeout })
    .toBe('estavel');
  // O rótulo do agente é o primeiro <p> dentro do container da mensagem, antes da bolha.
  const label = (await nova.locator('p').first().innerText()).trim();
  return { label, texto: await conteudo() };
}

for (const agente of ['Bento', 'Otto', 'Jarbas', 'Suzy']) {
  test(`ROUTING_SELECTED_${agente.toUpperCase()}: selecionar ${agente} explicitamente -> dispatchedAgent === ${agente}`, async ({ page }) => {
    await login(page);
    await novaConversa(page);
    await selecionarAgente(page, agente);
    // Mensagem curta, neutra, sem intenção de mutation nem vocativo de outro agente.
    const { label } = await falarEVerAgente(page, 'Oi, tudo bem? Só confirmando que estou falando com você.');
    // `uppercase` é CSS (text-transform), não o texto real — innerText() reflete o
    // rendering, então compara sem depender de caixa.
    expect(label.toUpperCase(), `selecionei ${agente} na UI, mas o rótulo renderizado foi "${label}"`).toBe(agente.toUpperCase());
  });
}

test('ROUTING_NAME_MENTION_DOES_NOT_OVERRIDE: agente selecionado vence mesmo citando outro agente na mensagem', async ({ page }) => {
  await login(page);
  await novaConversa(page);
  await selecionarAgente(page, 'Jarbas');
  const { label } = await falarEVerAgente(page, 'Bento comentou isso ontem, o que você acha?');
  expect(label.toUpperCase(), 'citar "Bento" na mensagem não pode trocar o agente selecionado explicitamente').toBe('JARBAS');
});
