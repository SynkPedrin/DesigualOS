import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';

/**
 * BENTO_PRESERVES_USER_BRIEF_CONTENT — teste de aceite pelo runtime real
 * (chat -> Bento -> action guard -> tool gateway -> ClickUp).
 *
 * Fixture QA fixa da missão: Cliente Teste 7 / Pedro Gabriel. NUNCA usar
 * outro colaborador aqui (ver aceite-final.spec.ts, que usa Gui/Jamile —
 * proposital para outra bateria, mas não pode ser reaproveitado neste teste
 * porque cria e atribui task real a gente que não está autorizada pra QA).
 *
 * Regressão do bug real (21/09/2026): a task "Executar briefing — Cliente
 * Teste 7" foi criada, atribuída a Pedro Gabriel e persistida — mas a
 * descrição saiu com objetivo/entregáveis/aprovação em [CONFIRMAR], sem a
 * mensagem de boas-vindas pedida. Causa raiz: bento-action-guard.ts compunha
 * o briefing só por fato já rotulado (dossiê/comentário), e pedido em prosa
 * não tem essa forma. Corrigido perguntando ao LLM só pelos campos que
 * faltam, só a partir do próprio pedido (ver briefing.test.ts para o teste
 * unitário do pipeline).
 */
const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY ?? '';
const SAIDA = process.env.ACEITE_SAIDA ?? '/tmp/bento-briefing-preservation.md';
const QA_CLIENTE = 'Cliente Teste 7';
const QA_ASSIGNEE = 'Pedro Gabriel';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');
test.describe.configure({ timeout: 900_000 });

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

/** Lê a task real no ClickUp (fonte de verdade) pelo id extraído do link na resposta do chat. */
async function lerTaskReal(taskId: string): Promise<{ name: string; assignees: string[]; description: string; url: string }> {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    headers: { Authorization: CLICKUP_API_KEY },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`ClickUp GET task falhou: ${JSON.stringify(body)}`);
  return {
    name: body.name,
    assignees: (body.assignees ?? []).map((a: { username?: string }) => a.username ?? ''),
    description: body.description ?? body.text_content ?? '',
    url: body.url,
  };
}

test.beforeAll(() => writeFileSync(SAIDA, `# BENTO_PRESERVES_USER_BRIEF_CONTENT — ${new Date().toISOString()}\n`, 'utf8'));

test.describe('Bento — análise e negação não escrevem (Cliente Teste 7)', () => {
  test('D1/D2: pergunta operacional e negação explícita não criam task', async ({ page }) => {
    await login(page);

    const analise = await falar(page, `Bento, como está a operação do ${QA_CLIENTE}?`);
    expect(analise, 'consulta operacional não pode criar task').not.toMatch(LINK_TASK);

    const negacao = await falar(page, `Bento, não cria nada ainda, só analisa essa demanda do ${QA_CLIENTE}.`);
    expect(negacao, 'negação explícita não pode criar task').not.toMatch(LINK_TASK);
  });
});

test.describe('BENTO_PRESERVES_USER_BRIEF_CONTENT', () => {
  test('cria task com briefing real (não [CONFIRMAR]) e preserva no update', async ({ page }) => {
    await login(page);

    const PEDIDO = `Bento, crie uma task para o ${QA_ASSIGNEE} com um briefing de boas-vindas ao Desigual OS, parabenizando ele pelo esforço. Use o ${QA_CLIENTE}.`;
    const criada = await falar(page, PEDIDO);
    expect(criada, 'a criação não pode ser recusa').not.toMatch(RECUSA);
    expect(criada, 'a resposta precisa trazer o link real da task criada').toMatch(LINK_TASK);
    expect(criada.toLowerCase()).toContain('pedro');

    const match = criada.match(LINK_TASK);
    const taskId = match![1]!;
    const real = await lerTaskReal(taskId);
    appendFileSync(SAIDA, `\n### READ-BACK ClickUp real (${real.url})\n\n\`\`\`\n${JSON.stringify(real, null, 2)}\n\`\`\`\n`, 'utf8');

    // 1. Pedro Gabriel atribuído de verdade.
    expect(real.assignees.some((a) => a.toLowerCase().includes('pedro'))).toBe(true);
    // 2. Cliente correto no título/descrição.
    expect(real.name + real.description).toContain(QA_CLIENTE);
    // 3/4/5. Conteúdo semântico do pedido sobreviveu — não é só o template.
    expect(real.description).toMatch(/boas.?vindas/i);
    expect(real.description).toMatch(/desigual\s*os/i);
    expect(real.description.toLowerCase()).toContain('pedro');
    expect(real.description).toMatch(/esfor[çc]o|reconhec/i);
    // 7. Objetivo e entregável, que o pedido determinava, não podem ter virado [CONFIRMAR].
    const secaoPendente = real.description.split('PENDENTE DE CONFIRMAÇÃO')[1] ?? '';
    expect(secaoPendente, 'objetivo já determinado pelo pedido não pode ficar pendente').not.toMatch(/objetivo principal/i);
    expect(secaoPendente, 'entregável já determinado pelo pedido não pode ficar pendente').not.toMatch(/peças\/arquivos esperados/i);

    // D11 — IDEMPOTÊNCIA: reenviar o pedido idêntico não duplica.
    // A GARANTIA que importa é de DADO (nenhuma segunda task real), não a
    // frase exata — achado real (21/09/2026): `reciboHumano` no caminho de
    // duplicata às vezes ecoa "criei a task" em vez de "já existe", mas o
    // link devolvido é o MESMO taskId, e é isso que read-back confirma
    // abaixo, direto na fonte de verdade.
    const repetida = await falar(page, PEDIDO);
    expect(repetida, 'reenvio idêntico precisa apontar pro MESMO link, nunca criar outro').toMatch(LINK_TASK);
    const matchRepetido = repetida.match(LINK_TASK);
    expect(matchRepetido![1], 'idempotência falhou: reenvio criou uma SEGUNDA task real').toBe(taskId);

    // Update: editar o briefing da task existente, não criar outra.
    const editada = await falar(
      page,
      'Bento, atualize o briefing dessa task adicionando que a mensagem deve ter um tom humano e motivador.',
    );
    expect(editada, 'update de briefing não pode criar task nova').not.toMatch(LINK_TASK);
    expect(editada, 'update não pode ser recusa').not.toMatch(RECUSA);

    const apos = await lerTaskReal(taskId);
    appendFileSync(SAIDA, `\n### READ-BACK pós-update (${apos.url})\n\n\`\`\`\n${JSON.stringify(apos, null, 2)}\n\`\`\`\n`, 'utf8');
    // Conteúdo anterior preservado.
    expect(apos.description).toMatch(/boas.?vindas/i);
    expect(apos.description).toMatch(/desigual\s*os/i);
    // Instrução nova adicionada.
    expect(apos.description).toMatch(/humano|motivador/i);
  });
});
