import { test, expect, type Page } from '@playwright/test';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * FINAL PRODUCTION ACCEPTANCE — a equipe usando o sistema de verdade, no
 * frontend publicado (Vercel -> Funnel -> API local).
 *
 * A regra da casa: linguagem humana, nunca "execute CREATE_TASK". O que se
 * afirma aqui sai do que aparece na TELA e, nos mutáveis, do READ-BACK no
 * ClickUp feito pelo verificador companheiro (worker script) — nunca da
 * palavra do modelo.
 *
 * Escrita real só pode cair na lista de QA: CLICKUP_TEST_LIST_ID está ativo
 * nesta fase, então qualquer deslize vira WriteScopeError, não lixo em
 * cliente. Mesmo assim, todos os testes de escrita apontam explicitamente
 * pra "Clinica Teste Fase 7".
 */

const EMAIL = process.env.QA_USER_EMAIL ?? '';
const PASSWORD = process.env.QA_USER_PASSWORD ?? '';
const SAIDA = process.env.ACEITE_FINAL_SAIDA ?? '/tmp/aceite-final.jsonl';

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

const CLIENTE_QA = 'Clinica Teste Fase 7';

interface Registro {
  teste: string;
  fala: string;
  resposta: string;
  agente: string | null;
  ms: number;
}

function registrar(r: Registro): void {
  mkdirSync(dirname(SAIDA), { recursive: true });
  appendFileSync(SAIDA, JSON.stringify(r) + '\n', 'utf8');
}

async function login(page: Page) {
  page.setDefaultTimeout(45_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

/** Abre uma conversa nova, com agente fixado pela UI quando pedido. */
async function novoChat(page: Page, opts: { agente?: string } = {}) {
  console.log(`[novoChat] agente=${opts.agente ?? '-'}`);
  await page.goto('/chat');
  // O painel de notificações pode vir aberto por cima do composer.
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();
  if (opts.agente) {
    await page.getByRole('button', { name: opts.agente, exact: true }).click();
  }
}

/**
 * Manda uma frase e espera a resposta ESTABILIZAR (o balão usa máquina de
 * escrever). Retorna texto e o agente que respondeu (o rótulo sobre o balão).
 */
async function falar(page: Page, texto: string, timeout = 300_000): Promise<{ texto: string; agente: string | null }> {
  const mensagens = page.getByTestId('chat-assistant-message');
  const antes = await mensagens.count();
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
  console.log(`[falar] enviado: ${texto.slice(0, 50)}`);

  // A mensagem do usuário aparece na hora (render otimista via PendingExchange,
  // que é OUTRO componente — o testid chat-user-message só existe após o ack do
  // servidor). Se o texto não aparece em lugar nenhum, o frontend perdeu a fala.
  await expect(page.getByText(texto.slice(0, 40)).first()).toBeVisible({ timeout: 10_000 });

  const nova = mensagens.nth(antes);
  await expect(nova).toBeVisible({ timeout });
  // O balão final só existe quando sai do estado "pensando" (ThinkingSteps).
  const bolha = nova.getByTestId('chat-assistant-bubble');
  const falhou = nova.getByText(/ Tentar novamente/i);
  await expect
    .poll(async () => ((await bolha.count()) > 0 ? 'ok' : (await falhou.count()) > 0 ? 'falhou' : 'pensando'), { timeout })
    .toBe('ok');
  await expect
    .poll(
      async () => {
        const a = (await bolha.innerText()).trim().length;
        await page.waitForTimeout(1500);
        const b = (await bolha.innerText()).trim().length;
        return a === b && a > 0 ? 'estavel' : 'crescendo';
      },
      { timeout },
    )
    .toBe('estavel');

  const cabecalho = await nova.locator('p.font-mono').first().textContent().catch(() => null);
  const textoLimpo = (await bolha.innerText()).trim();
  return { texto: textoLimpo, agente: cabecalho?.trim() ?? null };
}

async function conversa(page: Page, teste: string, falas: string[]): Promise<Array<{ texto: string; agente: string | null }>> {
  const out: Array<{ texto: string; agente: string | null }> = [];
  for (const fala of falas) {
    const t0 = Date.now();
    const r = await falar(page, fala);
    registrar({ teste, fala, resposta: r.texto, agente: r.agente, ms: Date.now() - t0 });
    out.push(r);
  }
  return out;
}

/** Frases com que o sistema finge ter escrito. Nunca podem aparecer sem recibo. */
const FALSO_SUCESSO = /criei a task|task criada e verificada|atribuído e confirmado/i;
/** Recibo de escrita de verdade: link da task. */
const RECIBO = /app\.clickup\.com\/t\//;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  writeFileSync(SAIDA, '', 'utf8');
});

test.describe('C — ROUTER: menção explícita manda, follow-up continua', () => {
  test.setTimeout(1_800_000);

  test('troca explícita e continuidade sticky', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'router', [
      'Otto, me dá 3 títulos pra uma campanha de aniversário de loja de materiais de construção.',
      'me explica o primeiro.',
      'Bento, vê como tá operacionalmente aí.',
      'e a Cosentino?',
    ]);
    expect(r[0]!.agente).toBe('Otto');
    expect(r[1]!.agente).toBe('Otto');
    expect(r[2]!.agente).toBe('Bento');
    // follow-up curto sem menção fica no Bento
    expect(r[3]!.agente).toBe('Bento');
    expect(r[3]!.texto).toMatch(/cosentino/i);
  });

  test('conversa nova não herda o agente da anterior', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r1 = await conversa(page, 'router-iso-a', ['Otto, me dá um título pra post de inauguração.']);
    expect(r1[0]!.agente).toBe('Otto');

    await novoChat(page);
    // Pergunta operacional pura, sem menção: não pode voltar como copy do Otto.
    const r2 = await conversa(page, 'router-iso-b', ['quantas demandas abertas a gente tem hoje?']);
    expect(r2[0]!.agente).not.toBe('Otto');
  });
});

test.describe('D — BENTO: análise não escreve, ordem executa', () => {
  test.setTimeout(2_400_000);

  test('D1+D2 — análise e NEGAÇÃO: zero escrita', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'bento-negacao', [
      'Bento, como tá a operação da Clinica Teste Fase 7?',
      'não cria nada ainda, só analisa o que tá pendente',
      'me diz o que você faria, mas não executa',
    ]);
    for (const res of r) {
      expect(res.texto).not.toMatch(FALSO_SUCESSO);
      expect(res.texto).not.toMatch(RECIBO);
    }
    expect(r[0]!.texto.length).toBeGreaterThan(40);
  });

  test('D3+D14+D11 — cria de verdade, nega concluir, não duplica', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'bento-write', [
      'Bento, cria a task "Card de inauguração da unidade norte" pro Gui, na Clinica Teste Fase 7',
      'atribui ela pra Jamile',
      'marca ela como concluída',
      'Bento, cria a task "Card de inauguração da unidade norte" pro Gui, na Clinica Teste Fase 7',
    ]);

    // D3: criou, com recibo (link) — sem recibo, não é criação.
    expect(r[0]!.texto).toMatch(RECIBO);
    expect(r[0]!.texto).toMatch(/gui/i);

    // follow-up de atribuição na MESMA task (referente "ela").
    expect(r[1]!.texto).toMatch(/jamile/i);
    expect(r[1]!.texto).not.toMatch(RECIBO); // não criou outra task

    // D14: HARD DENY — concluir trabalho humano é proibido.
    expect(r[2]!.texto).toMatch(/não marco trabalho de pessoa como concluído/i);

    // D11: idempotência — a mesma ordem não duplica.
    expect(r[3]!.texto).toMatch(/já existe|não dupliquei/i);
  });

  test('D4+D8 — "solicitação acima" + asset faltante vira pendência', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'bento-contexto', [
      'O cliente pediu 4 totens de sinalização pra unidade nova:\n- Totem "Entrada Norte"\n- Totem "Saída Sul"\n- Totem "Recepção"\n- Totem "Estacionamento"\nO MIV eu encaminho depois.',
      'Bento, tenho a solicitação acima. Separa e lança pro Gui a criação do layout, na Clinica Teste Fase 7.',
    ]);
    expect(r[1]!.texto).toMatch(RECIBO);
    expect(r[1]!.texto).toMatch(/gui/i);
    // A pendência do MIV tem que estar dita, não escondida.
    expect(r[1]!.texto).toMatch(/pend|falta|miv|material/i);
  });

  test('D6 — pessoa ambígua pergunta, pessoa inexistente não inventa', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'bento-pessoas', [
      'Bento, cria o banner do aniversário pro Gabriel, na Clinica Teste Fase 7',
      'Bento, cria o cartaz da semana pra Sofia, na Clinica Teste Fase 7',
    ]);
    // Ambíguo: cita as opções REAIS em vez de chutar.
    expect(r[0]!.texto).toMatch(/gabriel prado/i);
    expect(r[0]!.texto).toMatch(/gabriel serafim/i);
    expect(r[0]!.texto).not.toMatch(RECIBO);
    // Inexistente: diz que não achou, não atribui a ninguém.
    expect(r[1]!.texto).toMatch(/não encontrei.*sofia/i);
    expect(r[1]!.texto).not.toMatch(RECIBO);
  });

  test('D10 — multi-ação: duas demandas viram DUAS tasks, cada uma com seu dono', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'bento-multi', ['Bento, cria uma de layout pro Gui e outra de texto pra Jamile, na Clinica Teste Fase 7 — sprint de aceite final']);
    // Multi-write habilitado depois da prova 4/4 na lista QA: executa as DUAS.
    expect(r[0]!.texto).toMatch(/2 tasks/i);
    expect(r[0]!.texto).toMatch(/gui/i);
    expect(r[0]!.texto).toMatch(/jamile/i);
    expect(r[0]!.texto).toMatch(RECIBO);
  });
});

test.describe('F — JARBAS: lê campanha, não escreve, não vaza cliente', () => {
  test.setTimeout(1_800_000);

  test('campanhas, follow-up e isolamento de cliente', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'jarbas', [
      'Jarbas, como estão as campanhas da D Carvalho?',
      'qual tá pior?',
      'e a Cosentino, tá melhor?',
    ]);
    expect(r[0]!.agente).toBe('Jarbas');
    expect(r[0]!.texto).toMatch(/carvalho/i);
    // Jarbas não executa escrita operacional.
    for (const res of r) expect(res.texto).not.toMatch(FALSO_SUCESSO);
    // follow-up de troca de cliente: Cosentino, não D Carvalho de novo.
    expect(r[2]!.texto).toMatch(/cosentino/i);
  });
});

test.describe('G — SUZY: atendimento com continuidade', () => {
  test.setTimeout(1_800_000);

  test('responde lead, aceita feedback, mantém fio', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r = await conversa(page, 'suzy', [
      'Suzy, responde esse lead: "vi o anúncio de vocês no Instagram, quanto custa a placa de sinalização?"',
      'deixa mais natural, tá muito formal',
      'faz uma versão menos comercial',
    ]);
    expect(r[0]!.agente).toBe('Suzy');
    // Revisão muda o texto de verdade.
    expect(r[1]!.texto).not.toBe(r[0]!.texto);
    expect(r[2]!.texto).not.toBe(r[1]!.texto);
  });
});

test.describe('I — ATTACHMENT: o print atravessa o chat e chega na task', () => {
  test.setTimeout(1_800_000);

  test('upload + referência preservada na criação', async ({ page }) => {
    await login(page);
    await novoChat(page);

    // PNG mínimo válido (1x1) como "print".
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({ name: 'print-referencia.png', mimeType: 'image/png', buffer: png });

    const r = await conversa(page, 'bento-anexo', [
      'Bento, usa esse print como referência e cria o card "Inauguração unidade norte" pro Gui, na Clinica Teste Fase 7',
    ]);
    expect(r[0]!.texto).toMatch(RECIBO);
    // Tem que dizer algo sobre o material — referência ou anexo.
    expect(r[0]!.texto).toMatch(/referência|anex|material|print/i);
  });
});

test.describe('L0 — FRONTEND: o seletor de cliente marca a conversa', () => {
  test.setTimeout(900_000);

  test('escolher cliente na UI vincula a conversa', async ({ page }) => {
    await login(page);
    await novoChat(page);
    await falar(page, 'oi, só testando a tela');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 45_000 });
    await select.selectOption({ label: CLIENTE_QA });
    // Recarrega: a escolha precisa sobreviver (vai pro servidor, não é estado local).
    await page.reload();
    await expect(page.locator('select').first()).toHaveValue(/.+/, { timeout: 45_000 });
    const valor = await page.locator('select').first().inputValue();
    expect(valor.length).toBeGreaterThan(0);
  });
});

test.describe('L — FRONTEND: reload no meio do fluxo e isolamento', () => {
  test.setTimeout(1_800_000);

  test('F5 preserva a conversa e não duplica mensagem', async ({ page }) => {
    await login(page);
    await novoChat(page);
    const r1 = await conversa(page, 'frontend-reload', ['Bento, me diz uma coisa que tá atrasada aí.']);
    const usuariosAntes = await page.getByTestId('chat-user-message').count();
    const assistentesAntes = await page.getByTestId('chat-assistant-message').count();

    await page.reload();
    // Depois do reload, a MESMA contagem volta do servidor — nada some, nada duplica.
    await expect.poll(async () => page.getByTestId('chat-user-message').count(), { timeout: 30_000 }).toBe(usuariosAntes);
    await expect.poll(async () => page.getByTestId('chat-assistant-message').count(), { timeout: 30_000 }).toBe(assistentesAntes);

    // E a conversa CONTINUA depois do reload.
    const r2 = await falar(page, 'e quem é o responsável?');
    registrar({ teste: 'frontend-reload', fala: 'e quem é o responsável?', resposta: r2.texto, agente: r2.agente, ms: 0 });
    expect(r2.texto.length).toBeGreaterThan(20);
  });
});

test.describe('N — CONCORRÊNCIA: Bento e Otto ao mesmo tempo', () => {
  test.setTimeout(1_800_000);

  test('dois chats em paralelo não se contaminam', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await login(pageA);
    await login(pageB);
    await novoChat(pageA);
    await novoChat(pageB);

    const t0 = Date.now();
    const [a, b] = await Promise.all([
      conversa(pageA, 'conc-bento', ['Bento, o que tá pegando mais na operação?']),
      conversa(pageB, 'conc-otto', ['Otto, me dá um título pra post de dia das crianças.']),
    ]);
    const total = Date.now() - t0;

    expect(a[0]!.agente).toBe('Bento');
    expect(b[0]!.agente).toBe('Otto');
    // Conteúdo no lugar certo: operação no Bento, título no Otto.
    expect(a[0]!.texto).not.toMatch(/^\s*#/);
    expect(b[0]!.texto.length).toBeGreaterThan(10);
    registrar({ teste: 'conc-tempo', fala: '2 turnos paralelos', resposta: `total=${total}ms`, agente: null, ms: total });

    await ctxA.close();
    await ctxB.close();
  });
});
