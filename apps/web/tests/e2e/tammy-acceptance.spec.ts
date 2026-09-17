import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * ACEITE FINAL, no navegador publicado.
 *
 * Tudo que veio antes mediu por dentro: harness chamando o dispatch, script
 * montando o contexto. Serve pra achar defeito, não serve pra decidir release —
 * duas vezes nesta série um atalho do medidor me fez reportar defeito que não
 * existia, e uma vez escondeu um que existia.
 *
 * Aqui é a Tammy: login pela tela, conversa de verdade, frase curta, assunto
 * mudando no meio, follow-up sem repetir o contexto. O critério não é cada
 * resposta estar certa — é ela não precisar ensinar o sistema a cada frase.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/aceite-tammy.md';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

/**
 * Manda uma frase e espera a resposta ESTABILIZAR. O balão renderiza com efeito
 * de máquina de escrever: ler cedo captura a resposta pela metade, e já fez uma
 * asserção falhar com o texto cortado no meio de uma palavra.
 */
async function falar(page: import('@playwright/test').Page, texto: string, timeout = 300_000): Promise<string> {
  const bolhas = page.getByTestId('chat-assistant-bubble');
  const antes = await bolhas.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');

  // A bolha NOVA, não a primeira: numa conversa de doze turnos, `first()` é
  // sempre a resposta do primeiro turno.
  await expect.poll(async () => bolhas.count(), { timeout }).toBeGreaterThan(antes);
  const nova = bolhas.nth(antes);
  await expect.poll(async () => (await nova.innerText()).trim().length, { timeout }).toBeGreaterThan(20);
  await expect
    .poll(
      async () => {
        const a = (await nova.innerText()).trim().length;
        await page.waitForTimeout(1500);
        const b = (await nova.innerText()).trim().length;
        return a === b ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');
  return (await nova.innerText()).trim();
}

function registrar(titulo: string, pergunta: string, resposta: string, ms: number): void {
  appendFileSync(
    SAIDA,
    `\n### [${titulo}] "${pergunta}" (${Math.round(ms / 1000)}s)\n\n\`\`\`\n${resposta}\n\`\`\`\n`,
    'utf8',
  );
}

async function conversa(
  page: import('@playwright/test').Page,
  titulo: string,
  falas: string[],
): Promise<string[]> {
  const respostas: string[] = [];
  for (const fala of falas) {
    const t0 = Date.now();
    const r = await falar(page, fala);
    registrar(titulo, fala, r, Date.now() - t0);
    respostas.push(r);
  }
  return respostas;
}

test.describe('Aceite final — a Tammy usando de verdade', () => {
  test.setTimeout(1_800_000);

  test('bento: conversa natural de operação', async ({ page }) => {
    writeFileSync(SAIDA, `# Aceite final\n\nRodado em ${new Date().toISOString()}\n`, 'utf8');
    await login(page);
    await page.goto('/chat');

    const r = await conversa(page, 'BENTO', [
      'Bento, me atualiza aí.',
      'O que tá pegando mais hoje?',
      'Se eu só conseguir resolver três coisas, o que eu faço?',
      'E a Tammy?',
      'E a Cosentino?',
      'Quem é a Esther mesmo?',
      'Quem decide na Colpar?',
      'De onde você tirou isso?',
      'O que a gente decidiu ontem?',
      'O que mudou desde então?',
      'Tem alguma coisa que depende de mim?',
      'Me dá um resumo que eu consiga usar numa reunião agora.',
    ]);

    // O que NÃO pode acontecer, em nenhuma resposta da conversa.
    for (const resposta of r) {
      expect(resposta.length).toBeGreaterThan(20);
      // Identificador técnico na cara de quem lê.
      expect(resposta).not.toMatch(/memory_id|sourceId|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
      // Slug no lugar do nome do cliente.
      expect(resposta).not.toMatch(/\b(d-carvalho|facil-seguros|costa-azul|jardim-do-lago)\b/);
    }

    // Panorama tem que TRAZER a operação, não pedir cliente.
    expect(r[0]).not.toMatch(/de qual cliente|qual cliente você/i);
    expect(r[1]).not.toMatch(/de qual cliente|qual cliente você/i);
    // Esther não pode ganhar vínculo inventado.
    expect(r[5]).not.toMatch(/Esther Mesmo/i);
    // A fonte da resposta anterior tem que ser a conversa, não o ClickUp.
    expect(r[7]).toMatch(/conversa/i);
  });

  test('otto: conversa natural de criação', async ({ page }) => {
    await login(page);
    await page.goto('/chat');

    const r = await conversa(page, 'OTTO', [
      'Otto, lembra daquela campanha de aniversário da Elite?',
      'Me explica rapidinho o que a gente tá fazendo.',
      'Me dá 3 títulos.',
      'Agora faz uma legenda.',
      'Tá com cara de IA.',
      'Faz de outro jeito então.',
      'Leva em conta o que eu te falei ontem.',
      'E vê como tá operacionalmente também.',
      'Agora me dá uma versão que eu poderia mandar pro cliente.',
      'De onde vieram as informações que você usou?',
    ]);

    for (const resposta of r) expect(resposta.length).toBeGreaterThan(20);

    // Três títulos são três linhas curtas, não três legendas.
    const titulos = r[2]!;
    expect(titulos).not.toMatch(/#\w+/); // hashtag é de legenda
    expect(titulos.split('\n').filter((l) => l.trim().length > 0).length).toBeLessThanOrEqual(8);
  });

  test('cross-session: reload e conversa nova não perdem o que foi ensinado', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    await page.reload();
    await page.goto('/chat');

    const r = await conversa(page, 'CROSS-SESSION', [
      'Bento, quem decide na Colpar mesmo?',
      'Otto, lembra do direcionamento que eu te passei ontem?',
    ]);

    // O fato ensinado sobrevive a reload e a conversa nova.
    expect(r[0]).toMatch(/Fernanda/i);
    // E o nome não pode ter virado "Colpar mesmo".
    expect(r[0]).not.toMatch(/Colpar mesmo/i);
  });
});
