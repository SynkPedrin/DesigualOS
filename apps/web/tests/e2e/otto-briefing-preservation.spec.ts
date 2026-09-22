import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * OTTO GATE — aceite pelo runtime real (chat -> Otto -> guard compartilhado
 * -> tool gateway -> ClickUp). Fixture QA fixa: Cliente Teste 7 / Pedro
 * Gabriel — nunca outro colaborador, nunca cliente real.
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/otto-gate.md';
const QA_CLIENTE = 'Cliente Teste 7';
const QA_ASSIGNEE = 'Pedro Gabriel';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');
test.describe.configure({ mode: 'serial', timeout: 1_800_000 });

const LINK_TASK = /app\.clickup\.com\/t\/([a-z0-9]+)/i;
const RECUSA = /(não|nao) (posso|consigo|é possível|e possivel) (gerar|criar|escrever|produzir)/i;

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.goto('/chat');
}

async function falar(page: import('@playwright/test').Page, texto: string, timeout = 300_000): Promise<string> {
  const bolhas = page.getByTestId('chat-assistant-bubble');
  const antes = await bolhas.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  await expect.poll(async () => (await campo.inputValue()).trim() === '', { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => bolhas.count(), { timeout }).toBeGreaterThan(antes);
  const nova = bolhas.nth(antes);
  const conteudo = async () =>
    (await nova.innerText()).replace(/\n?\d\d:\d\d\n?/g, '').replace(/\n?Encaminhar\s*$/i, '').trim();
  await expect.poll(async () => (await conteudo()).length, { timeout }).toBeGreaterThan(20);
  await expect
    .poll(async () => {
      const a = await conteudo();
      await page.waitForTimeout(1500);
      return a === (await conteudo()) ? 'estavel' : 'crescendo';
    }, { timeout })
    .toBe('estavel');
  const r = await conteudo();
  appendFileSync(SAIDA, `\n### "${texto.replace(/\s+/g, ' ').slice(0, 140)}"\n\n\`\`\`\n${r}\n\`\`\`\n`, 'utf8');
  return r;
}

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

async function lerTaskReal(taskId: string): Promise<{ name: string; assignees: string[]; description: string; url: string }> {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, { headers: { Authorization: CLICKUP_API_KEY } });
  const body = await res.json();
  if (!res.ok) throw new Error(`ClickUp GET task falhou: ${JSON.stringify(body)}`);
  return {
    name: body.name,
    assignees: (body.assignees ?? []).map((a: { username?: string }) => a.username ?? ''),
    description: body.description ?? body.text_content ?? '',
    url: body.url,
  };
}

test.beforeAll(() => writeFileSync(SAIDA, `# OTTO GATE — ${new Date().toISOString()}\n`, 'utf8'));

test.describe('OTTO_ANALYSIS_NO_WRITE + OTTO_CONTEXT_RETRIEVAL', () => {
  test('análise de cliente não cria task; resposta é específica, não inventa dado', async ({ page }) => {
    await login(page);
    const r = await falar(page, `Otto, analise o ${QA_CLIENTE} e me diga qual direção criativa faria mais sentido.`);
    expect(r, 'análise não pode criar task').not.toMatch(LINK_TASK);
    expect(r, 'análise não pode ser recusa').not.toMatch(RECUSA);
    // Não pode inventar posicionamento/campanha real de outro cliente conhecido.
    expect(r).not.toMatch(/\b(d-carvalho|facil-seguros|costa-azul|jardim-do-lago|elite|cosentino|colpar)\b/i);
  });

  test('"o que você acha desse roteiro?" e "analisa essa copy" não escrevem', async ({ page }) => {
    await login(page);
    const r1 = await falar(page, 'Otto, o que você acha desse roteiro: abre com um problema, mostra a solução, fecha com prova social?');
    expect(r1).not.toMatch(LINK_TASK);
    const r2 = await falar(page, `Otto, analisa essa copy: "Transforme seu atendimento com IA." pro ${QA_CLIENTE}.`);
    expect(r2).not.toMatch(LINK_TASK);
  });
});

test.describe('OTTO_V1_CREATION -> FEEDBACK -> APPROVED -> TASK (multi-turn, uma conversa)', () => {
  test('fluxo completo: V1, "ficou genérico" -> V2 melhor, aprovação, task com V2', async ({ page }) => {
    await login(page);

    // V1
    const v1 = await falar(page, `Otto, crie um Reel para ${QA_CLIENTE} sobre IA no atendimento.`);
    expect(v1, 'V1 não pode ser recusa').not.toMatch(RECUSA);
    expect(v1, 'criação criativa não pode criar task ainda').not.toMatch(LINK_TASK);
    expect(v1.length, 'V1 precisa ser roteiro de verdade, não 2 linhas').toBeGreaterThan(200);

    // Feedback genérico -> V2 precisa ser MATERIALMENTE diferente, não sinônimo,
    // e precisa ser uma REVISÃO DE VERDADE — não um "Registrado: -Ficou
    // genérico." (achado real 22/09/2026: sem checar isso, o teste passava
    // com o Otto nunca reescrevendo nada, só confirmando que "anotou" o
    // feedback como preferência permanente).
    const v2 = await falar(page, 'Ficou genérico.');
    expect(v2, 'feedback não pode ser recusa').not.toMatch(RECUSA);
    expect(v2, 'V2 não pode criar task').not.toMatch(LINK_TASK);
    expect(v2, 'a resposta ao feedback não pode ser uma confirmação de "anotado" — precisa ser o roteiro revisado').not.toMatch(
      /^registrado[: ]|fica valendo a partir de agora|volta nas próximas conversas/i,
    );
    expect(v2.length, 'V2 precisa ser um roteiro de verdade, não um reconhecimento curto do feedback').toBeGreaterThan(200);
    expect(
      sobreposicao(v1, v2),
      'V2 precisa ser materialmente diferente de V1 (não é só reescrever com outras palavras)',
    ).toBeLessThan(0.75);

    // Aprovação — NÃO é pedido de mutation, e também não pode virar "Registrado:".
    const aprovacao = await falar(page, 'Agora gostei.');
    expect(aprovacao, 'aprovar não pode criar task sozinho').not.toMatch(LINK_TASK);
    expect(aprovacao, 'aprovação não pode virar registro de conhecimento').not.toMatch(/^registrado[: ]/i);

    // Execução explícita — ESSA sim precisa criar/atribuir.
    const criada = await falar(page, `Cria a task pro ${QA_ASSIGNEE} editar.`);
    expect(criada, 'execução explícita precisa criar task').toMatch(LINK_TASK);
    expect(criada.toLowerCase()).toContain('pedro');
    expect(criada, 'execução não pode ser recusa').not.toMatch(RECUSA);

    const match = criada.match(LINK_TASK);
    const taskId = match![1]!;
    const real = await lerTaskReal(taskId);
    appendFileSync(SAIDA, `\n### READ-BACK ClickUp real (${real.url})\n\n\`\`\`\n${JSON.stringify(real, null, 2)}\n\`\`\`\n`, 'utf8');

    expect(real.assignees.some((a) => a.toLowerCase().includes('pedro')), 'Pedro Gabriel precisa estar atribuído de verdade').toBe(true);
    expect(real.name + real.description).toContain(QA_CLIENTE);
    // A task precisa carregar o CONTEÚDO aprovado (V2), não regenerar outro conceito.
    expect(
      sobreposicao(v2, real.description),
      'a task precisa usar o conteúdo aprovado (V2) como base, não um briefing genérico novo',
    ).toBeGreaterThan(0.4);

    // OTTO_RETRY_IDEMPOTENT: reenviar a mesma ordem de execução não duplica.
    const repetida = await falar(page, `Cria a task pro ${QA_ASSIGNEE} editar.`);
    expect(repetida, 'retry não pode criar uma SEGUNDA task real').toMatch(LINK_TASK);
    const matchRepetido = repetida.match(LINK_TASK);
    expect(matchRepetido![1], 'idempotência falhou: retry criou task diferente').toBe(taskId);
  });
});
