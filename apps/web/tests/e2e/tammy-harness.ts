import { expect, type Page } from '@playwright/test';

/**
 * tammy-harness.ts — o que já existia em bento-tammy-release-readiness.spec.ts,
 * extraído pra ser usado por mais de uma suíte.
 *
 * Não muda comportamento nenhum: é o mesmo login, o mesmo `falar`, as mesmas
 * esperas. Saiu de lá porque as personas de uso livre (tammy-operacao.spec.ts)
 * precisam exatamente disto, e duplicar o `falar` significaria duas definições
 * de "a resposta terminou" — que é a parte difícil e a que mais dá falso
 * negativo.
 */

export const EMAIL = process.env.QA_USER_EMAIL ?? '';
export const PASSWORD = process.env.QA_USER_PASSWORD ?? '';

export interface Resposta {
  texto: string;
  /** Bolhas extras além da esperada: duplicata é bug conhecido e volta. */
  duplicadas: number;
  ms: number;
}

export async function login(page: Page): Promise<void> {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

export async function novoChat(page: Page, agente?: 'Bento' | 'Otto' | 'Jarbas' | 'AUTO'): Promise<void> {
  await page.goto('/chat');
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
  if (agente) {
    /**
     * FALHA SE O CHIP NÃO ESTIVER LÁ, em vez de seguir em silêncio.
     *
     * A versão anterior fazia `if (visible) click()`. Quando o chip não
     * renderizava a tempo, o teste seguia sem agente escolhido, o roteador
     * decidia sozinho e a pergunta ia parar no Jarbas — e a falha aparecia
     * como se fosse bug do Bento. Aconteceu em 29/09/2026 e me fez caçar um
     * defeito de produto que era, em parte, o teste não fazendo o que dizia.
     *
     * (A caçada valeu: o roteador REALMENTE mandava "o que está em risco hoje"
     * pro Jarbas, e isso virou regra em packages/router/src/rules.ts. Mas isso
     * é sorte, não método — teste que mente sobre o que fez é o mesmo erro do
     * medidor que relata falha falsa.)
     */
    const chip = page.getByRole('button', { name: new RegExp(`^${agente}\\b`, 'i') });
    await expect(chip, `o chip do agente ${agente} não apareceu`).toBeVisible({ timeout: 20_000 });
    await chip.click();
  }
}

export async function selecionaCliente(page: Page, cliente: string): Promise<void> {
  const select = page.locator('select').first();
  await expect(select).toBeVisible({ timeout: 45_000 });
  await select.selectOption({ label: cliente });
}

/**
 * Manda a mensagem e espera a resposta ESTABILIZAR (o texto para de crescer),
 * não só aparecer. Sem isso o teste lê metade do streaming e reprova por
 * tamanho — falso negativo que ensina a ignorar o teste.
 */
export async function falar(page: Page, texto: string, timeout = 120_000): Promise<Resposta> {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
  const inicio = Date.now();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect(page.getByText(texto.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });

  const nova = mensagens.nth(antes);
  await expect(nova).toBeVisible({ timeout });
  const bolha = nova.getByTestId('chat-assistant-bubble');
  const falhou = nova.getByText(/Tentar novamente/i);
  await expect
    .poll(async () => ((await bolha.count()) > 0 ? 'ok' : (await falhou.count()) > 0 ? 'falhou' : 'pensando'), { timeout })
    .toBe('ok');
  await expect
    .poll(
      async () => {
        const a = (await bolha.innerText()).trim().length;
        await page.waitForTimeout(1200);
        const b = (await bolha.innerText()).trim().length;
        return a === b && a > 0 ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');
  const depois = await mensagens.count();
  return { texto: (await bolha.innerText()).trim(), duplicadas: depois - antes - 1, ms: Date.now() - inicio };
}

export function log(rotulo: string, r: Resposta): void {
  console.log(`\n=== ${rotulo} (${Math.round(r.ms / 1000)}s) ===`);
  console.log(r.texto);
  if (r.duplicadas !== 0) console.log(`[ALERTA] bolhas extras nesta rodada: ${r.duplicadas}`);
}

/** Erro interno cru vazando pro usuário. Cada item saiu de um caso medido. */
export const ERRO_CRU =
  /(zod|schemaValidation|chatJson|undefined is not|stack trace|SyntaxError:|at Object\.<anonymous>|Ollama|HTTP \d{3}|ECONNRE|fetch failed)/i;

/**
 * "Não sei" escrito como número. Medido na bateria de uso livre de 29/09/2026:
 * perguntado quanto a agência faturou, ele explicou certo que o ClickUp não
 * guarda receita e concluiu "Logo, R$ 0,00 faturado registrado no sistema".
 */
export const NAO_SEI_VIROU_ZERO = /(R\$ ?0[,.]00|faturamento (de |total )?(de )?(R\$ ?)?0\b|receita (de )?(R\$ ?)?0\b)/i;
