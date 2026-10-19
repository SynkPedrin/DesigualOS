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

/**
 * Seleciona o agente e CONFERE que pegou.
 *
 * A versão anterior era `getByRole('button', { name: /^Suzy/ }).first().click()`
 * e é o mesmo defeito que já custou caro no outro harness, medido em 29/09/2026:
 * a barra lateral tem conversas chamadas "Bento respondeu Oi! Tô por aqui...",
 * o locator casa várias, e `.first()` clica no que vier primeiro no DOM — que
 * pode ser uma CONVERSA, não o chip do agente.
 *
 * Quando isso acontece, o chip nunca é clicado, o turno vai pro roteador
 * automático, e o teste reprova o PRODUTO por um erro do instrumento. Foi
 * exatamente o que apareceu em 30/09: "selecionei Suzy na UI, mas o rótulo
 * renderizado foi JARBAS" — acusação grave de roteamento que podia ser, e era
 * preciso descobrir, apenas o clique no lugar errado.
 *
 * `button[aria-pressed]` são os únicos botões da tela com esse atributo (os
 * quatro agentes e o AUTO), então o seletor é preciso sem precisar de testid no
 * componente de produção. E o `toHaveAttribute` depois do clique é o que
 * transforma "cliquei" em "está selecionado".
 */
async function selecionarAgente(page: import('@playwright/test').Page, agente: string) {
  const chip = page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${agente}`, 'i') }).first();
  await expect(chip, `o chip do agente ${agente} não apareceu`).toBeVisible({ timeout: 20_000 });
  await chip.click();
  await expect(chip, `o chip ${agente} não ficou selecionado depois do clique`).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10_000 },
  );
}

/** Envia, espera a bolha, devolve { label, texto } — label é o rótulo de agente renderizado acima da bolha. */
async function falarEVerAgente(
  page: import('@playwright/test').Page,
  texto: string,
  timeout = 300_000,
): Promise<{ label: string; texto: string }> {
  const mensagens = page.getByTestId('chat-assistant-message');

  /**
   * A LINHA DE BASE PRECISA ESTAR PARADA ANTES DE ENVIAR.
   *
   * A versão anterior contava as mensagens logo depois de `goto('/chat')` e
   * usava esse número como índice da resposta nova (`nth(antes)`). Só que a tela
   * RESTAURA a conversa anterior de forma assíncrona: a contagem saía 0, a
   * conversa antiga chegava um instante depois, e `nth(0)` passava a apontar
   * para a PRIMEIRA mensagem da conversa restaurada — a resposta do teste
   * anterior.
   *
   * O sintoma foi uma acusação grave e falsa. Medido em 30/09/2026, o teste que
   * falhava sempre mostrava o agente do teste ANTERIOR da fila: Suzy depois de
   * Jarbas acusava "JARBAS", Jarbas depois de Otto acusava "OTTO". Parecia
   * roteamento ignorando a escolha explícita do usuário — e era o teste lendo a
   * bolha errada. (Conferido por interceptação do POST: o front mandava
   * `agent_hint=SUZY` corretamente.)
   *
   * Duas correções, e as duas são necessárias: esperar a contagem PARAR de
   * mudar, e depois ler a ÚLTIMA mensagem em vez de um índice calculado antes.
   */
  const contagemEstavel = async () => {
    let anterior = -1;
    for (let i = 0; i < 20; i++) {
      const atual = await mensagens.count();
      if (atual === anterior) return atual;
      anterior = atual;
      await page.waitForTimeout(500);
    }
    return anterior;
  };
  const antes = await contagemEstavel();

  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect.poll(async () => (await campo.inputValue()).trim() === '', { timeout: 10_000 }).toBe(true);

  /**
   * ANCORA NA PRÓPRIA MENSAGEM, e é isto que resolve de verdade.
   *
   * Descoberto interceptando o POST: todo envio vai com `conversation_id=null`,
   * ou seja, CRIA uma conversa nova — e a interface só troca para ela depois.
   * Durante essa troca, a tela ainda mostra a conversa anterior, então tanto
   * `nth(antes)` quanto `last()` leem a resposta do teste passado.
   *
   * Foi exatamente isso que produziu a acusação falsa, três vezes seguidas e
   * sempre com o agente ANTERIOR da fila: Suzy acusava JARBAS, Jarbas acusava
   * OTTO, Otto acusava BENTO. Um bug de roteamento não escolheria justamente o
   * vizinho de cima a cada rodada; um teste lendo a tela velha, sim.
   *
   * Esperar a NOSSA mensagem de usuário aparecer garante que a interface já
   * está na conversa nova. Só depois disso a resposta lida é a resposta certa.
   */
  await expect(page.getByText(texto, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => mensagens.count(), { timeout }).toBeGreaterThan(0);
  // A ÚLTIMA, não `nth(antes)`: o índice foi calculado antes da troca de
  // conversa e aponta pro passado; a última é sempre a mais nova.
  const nova = mensagens.last();
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
