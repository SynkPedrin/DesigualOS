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
  /**
   * Espera o campo ficar EDITÁVEL antes de escrever. O `fill` direto estourou
   * 45s em 29/09/2026 com o locator já resolvido: a página ainda estava
   * hidratando e o input existia sem aceitar digitação. Falha de login parece
   * falha do produto no relatório, e foi o que me fez reinvestigar um defeito
   * que não existia.
   */
  const email = page.getByLabel('E-mail');
  const senha = page.getByLabel('Senha');
  await expect(email).toBeEditable({ timeout: 45_000 });
  await email.fill(EMAIL);
  await expect(senha).toBeEditable({ timeout: 45_000 });
  await senha.fill(PASSWORD);
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
    /**
     * `button[aria-pressed]` + texto: são os ÚNICOS botões da tela com esse
     * atributo (os 4 agentes e o AUTO), então o seletor é preciso sem precisar
     * de testid no componente de produção.
     *
     * O que não serve: `getByRole('button', {name: /^Bento/})`. A barra lateral
     * tem conversas chamadas "Bento respondeu Oi! Tô por aqui...", e o locator
     * casa várias — em strict mode isso lança, e o `.isVisible().catch(()=>false)`
     * da versão original engolia o erro. Resultado medido em 29/09/2026: o chip
     * NUNCA foi clicado em nenhuma rodada, todo turno foi pro roteador
     * automático, e as falhas apareciam como se fossem do Bento.
     */
    const chip = page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${agente}`, 'i') }).first();
    await expect(chip, `o chip do agente ${agente} não apareceu`).toBeVisible({ timeout: 20_000 });
    await chip.click();
    // Confere que PEGOU. Clicar e seguir sem verificar foi o que deixou todos
    // os turnos irem pro roteador automático sem ninguém perceber.
    await expect(chip, `o chip ${agente} não ficou selecionado depois do clique`).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10_000 },
    );
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
  /**
   * ESTÁVEL = o texto parou de crescer em DUAS janelas seguidas.
   *
   * Com uma janela só de 1,2s, uma pausa do streaming no meio da resposta era
   * lida como fim: a persona de continuidade reprovou com "curta demais (16
   * chars)" em 29/09/2026, e a busca no banco não achou NENHUMA resposta de 16
   * caracteres nas 3 horas anteriores — 6 respostas curtas no período, todas
   * longas o bastante e todas explicáveis. Ou seja, o sistema respondeu inteiro
   * e o medidor leu pela metade.
   *
   * É o terceiro instrumento do dia mentindo na mesma direção (o extrator da
   * bateria, o clique do chip, e agora este), e a direção é sempre a mesma:
   * transformar "não consegui medir" em "medi e está ruim".
   */
  await expect
    .poll(
      async () => {
        const a = semRodape(await bolha.innerText()).length;
        await page.waitForTimeout(1200);
        const b = semRodape(await bolha.innerText()).length;
        // b === 0 é a bolha só com rodapé: a resposta ainda não começou.
        if (a !== b || b === 0) return 'crescendo';
        await page.waitForTimeout(1200);
        const c = semRodape(await bolha.innerText()).length;
        return b === c ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');
  const depois = await mensagens.count();
  return { texto: semRodape(await bolha.innerText()), duplicadas: depois - antes - 1, ms: Date.now() - inicio };
}

/**
 * O `innerText` da bolha inclui o RODAPÉ: horário e o botão "Encaminhar".
 * "12:17\nEncaminhar" tem exatamente 16 caracteres — que foi o que a persona de
 * continuidade reprovou como "curta demais (16 chars)" em 29/09/2026. Nenhuma
 * resposta do sistema no período tinha menos de 67 caracteres: o medidor leu o
 * rodapé de uma bolha que ainda não tinha texto.
 *
 * Quarto instrumento do dia lendo errado, e todos na mesma direção: "não
 * consegui medir" aparecendo como "medi e está ruim".
 */
export function semRodape(texto: string): string {
  return texto
    .replace(/\n?\s*\d{1,2}:\d{2}\s*\n?\s*(encaminhar|copiar)?\s*$/i, '')
    .trim();
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
