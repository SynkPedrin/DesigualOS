import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * ACEITE FINAL, no navegador publicado.
 *
 * Duas lições estão embutidas aqui.
 *
 * A primeira: medir por dentro não decide release. Harness que chama o dispatch
 * pula a montagem do turno, e nesta série isso me fez reportar como defeito do
 * sistema um escopo que estava certo.
 *
 * A segunda, mais cara: asserção fraca esconde comportamento quebrado. A versão
 * anterior deste arquivo checava "tamanho > 20" e "sem hashtag" — e passou com
 * o Otto recusando cinco pedidos seguidos, porque recusa é longa e não tem
 * hashtag. Aqui cada asserção olha o CONTEÚDO: três títulos são três linhas
 * curtas, uma revisão é um texto materialmente diferente, uma recusa é uma
 * falha.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/aceite-tammy.md';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

/** Frases com que um modelo se recusa a trabalhar. Nenhuma pode aparecer. */
const RECUSA =
  /(não|nao) (posso|consigo|é possível|e possivel) (gerar|criar|escrever|produzir|entregar|enviar)|não vou (gerar|criar|escrever)|impossível (gerar|criar)/i;

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

/** Manda uma frase e espera a resposta ESTABILIZAR (o balão usa máquina de escrever). */
async function falar(page: import('@playwright/test').Page, texto: string, timeout = 300_000): Promise<string> {
  const bolhas = page.getByTestId('chat-assistant-bubble');
  const antes = await bolhas.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');

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
  // Os controles da bolha ("Encaminhar", hora) não são resposta.
  return (await nova.innerText()).replace(/\n\d\d:\d\d\n?/g, '\n').replace(/\nEncaminhar\s*$/i, '').trim();
}

function registrar(titulo: string, pergunta: string, resposta: string, ms: number): void {
  appendFileSync(SAIDA, `\n### [${titulo}] "${pergunta}" (${Math.round(ms / 1000)}s)\n\n\`\`\`\n${resposta}\n\`\`\`\n`, 'utf8');
}

async function conversa(page: import('@playwright/test').Page, titulo: string, falas: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const fala of falas) {
    const t0 = Date.now();
    const r = await falar(page, fala);
    registrar(titulo, fala, r, Date.now() - t0);
    out.push(r);
  }
  return out;
}

/** Linhas que parecem item de lista (numeradas ou com marcador). */
function itensDeLista(texto: string): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(\d+[.)]|[-*•])\s+\S/.test(l));
}

/** Quanto dois textos se repetem. Serve pra provar que uma revisão mudou de fato. */
function sobreposicao(a: string, b: string): number {
  const tokens = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((x) => x.length >= 5),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let comuns = 0;
  for (const x of ta) if (tb.has(x)) comuns += 1;
  return comuns / Math.min(ta.size, tb.size);
}

test.describe('Aceite final — a Tammy usando de verdade', () => {
  test.setTimeout(1_800_000);

  test('bento: operação, prioridade e fonte', async ({ page }) => {
    writeFileSync(SAIDA, `# Aceite final\n\nRodado em ${new Date().toISOString()}\n`, 'utf8');
    await login(page);
    await page.goto('/chat');

    const r = await conversa(page, 'BENTO', [
      'Bento, me atualiza aí.',
      'O que tá pegando mais?',
      'Se eu só conseguir resolver três coisas, o que eu faço?',
      'E a Tammy?',
      'E a Cosentino?',
      'Me dá um resumo pra reunião.',
      'De onde você tirou esses números?',
    ]);

    for (const resposta of r) {
      expect(resposta).not.toMatch(/memory_id|sourceId|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
      expect(resposta).not.toMatch(/\b(d-carvalho|facil-seguros|costa-azul|jardim-do-lago)\b/);
    }

    // Panorama traz a operação; não devolve a pergunta.
    expect(r[0]).not.toMatch(/de qual cliente|qual cliente você/i);
    expect(r[0]).toMatch(/\d/);

    // O follow-up elíptico continua com dado — era ele que dizia "não tenho acesso".
    expect(r[2]).not.toMatch(/não (tenho|estão) (acesso|disponí)|dados .* não estão disponíveis/i);
    expect(itensDeLista(r[2]).length).toBeGreaterThanOrEqual(2);

    // Pessoa e cliente resolvem no follow-up curto.
    expect(r[3]).toMatch(/tammy/i);
    expect(r[4]).toMatch(/cosentino/i);

    /**
     * ESCOPO DO NÚMERO no resumo de reunião. O total da carteira não pode
     * aparecer colado ao nome de um cliente: foi exatamente assim que saiu
     * "1106 tarefas abertas em andamento no Cosentino".
     */
    const resumo = r[5]!;
    const totalColadoNoCliente = /\b(\d{3,})\s+tarefas?[^.\n]{0,40}\b(no|na|do|da)\s+(Cosentino|Elite|Colpar)\b/i;
    expect(resumo).not.toMatch(totalColadoNoCliente);

    // A fonte citada é fonte de verdade, não identificador nem "ClickUp" por hábito.
    expect(r[6]).toMatch(/ClickUp|conversa|dossiê|registro/i);
    expect(r[6]).not.toMatch(/de o |de a /);
  });

  test('otto: lacuna no dossiê não pode travar a entrega', async ({ page }) => {
    await login(page);
    await page.goto('/chat');

    /**
     * A Elite é a SOFT GAP deliberada deste fluxo: o dossiê dela tem voz
     * verbal, público e CTA marcados como [FALTA]. É sobre esse dossiê que o
     * Otto recusou cinco pedidos seguidos na bateria anterior.
     */
    const r = await conversa(page, 'OTTO', [
      'Otto, lembra daquela campanha de aniversário da Elite?',
      'Me explica.',
      'Me dá 3 títulos.',
      'Agora faz uma legenda.',
      'Tá com cara de IA.',
      'Faz de outro jeito então.',
      'Uma versão pro cliente.',
      'Leva em conta o que falei ontem.',
      'E vê como tá operacionalmente.',
      'Agora fecha uma versão final.',
    ]);

    // NENHUM turno criativo pode ser recusa.
    for (const i of [2, 3, 4, 5, 6, 9]) {
      expect(r[i], `turno ${i} recusou em vez de entregar`).not.toMatch(RECUSA);
    }

    // Três títulos são TRÊS, e são títulos.
    const titulos = itensDeLista(r[2]!);
    expect(titulos.length).toBe(3);
    for (const t of titulos) {
      expect(t.length).toBeLessThan(140);
      expect(t).not.toMatch(/#\w+/);
      expect(t).not.toMatch(/📲|link na bio/i);
    }

    // Legenda é legenda: texto com corpo, e não três linhas soltas.
    const legenda = r[3]!;
    expect(legenda.length).toBeGreaterThan(200);

    // "Tá com cara de IA" produz texto NOVO, não sinônimo do anterior.
    expect(sobreposicao(legenda, r[4]!)).toBeLessThan(0.75);
    // "Faz de outro jeito" também, e não vira relatório operacional.
    expect(r[5]).not.toMatch(/tarefas? (abertas?|registradas?) no ClickUp/i);

    // A versão final existe como TEXTO entregue.
    expect(r[9]!.length).toBeGreaterThan(150);
  });

  test('cross-session: o que foi ensinado sobrevive a reload e conversa nova', async ({ page }) => {
    await login(page);
    await page.goto('/chat');
    await page.reload();
    await page.goto('/chat');

    const r = await conversa(page, 'CROSS-SESSION', [
      'Bento, quem decide na Colpar mesmo?',
      'De onde você tirou isso?',
    ]);

    expect(r[0]).toMatch(/Fernanda/i);
    expect(r[0]).not.toMatch(/Colpar mesmo/i);
    // A fonte é a conversa, não o ClickUp nem o dossiê (onde o campo é [FALTA]).
    expect(r[1]).toMatch(/conversa/i);
  });
});
