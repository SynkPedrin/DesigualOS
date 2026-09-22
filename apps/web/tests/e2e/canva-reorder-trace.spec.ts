import { test, expect, type Page } from '@playwright/test';

/**
 * TRACE DO REORDER — onde a ordem se perde, medido em cada fronteira.
 *
 * A forense em `use-canva-editor.reorder.test.tsx` cobre o lado de dentro:
 * roda o hook de verdade e mostra que UI, `page.objects` e o payload entregue
 * ao autosave saem consistentes. O que ela NÃO alcança é a outra metade do
 * caminho — o que foi realmente pela rede, o que o banco guardou e o que
 * volta depois do F5. Era justamente ali que a ordem se perdia (ver o
 * cabeçalho de lib/canva/autosave.ts: status mentindo "Salvo" e ausência de
 * flush no descarregamento da página).
 *
 * Este teste fecha a outra metade, e sem inventar canal nenhum: observa o
 * tráfego REAL. O corpo do PATCH é o que o editor enviou; a RESPOSTA do PATCH
 * é a linha já gravada, devolvida pela API; e a resposta do GET na reabertura
 * é exatamente o que a hidratação lê depois do F5.
 *
 * A ordem do Fabric não aparece aqui de propósito: lê-la exigiria um gancho
 * de depuração no código de produção, e ela já está coberta pela forense de
 * unidade, que roda o Fabric real.
 */
const EMAIL = process.env.STUDIO_TEST_EMAIL ?? '';
const PASSWORD = process.env.STUDIO_TEST_PASSWORD ?? '';
const CLIENTE = process.env.STUDIO_TEST_CLIENT ?? 'Clinica Teste Fase 7';
test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
}

async function abrirCanva(page: Page) {
  await page.goto('/studio');
  await page.getByRole('button', { name: /novo projeto/i }).waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: /^canva$/i }).first().click();
  const select = page.getByLabel('Cliente');
  await select.waitFor({ state: 'visible', timeout: 30000 });
  await select.selectOption({ label: CLIENTE });
}

/** Ids das camadas na ordem VISUAL (topo primeiro), como o painel mostra. */
async function ordemNaTela(page: Page): Promise<string[]> {
  // O botão ALTERNA (aria-pressed): garantir estado, nunca alternar.
  const aba = page.getByRole('button', { name: 'Camadas' }).first();
  if ((await aba.getAttribute('aria-pressed')) !== 'true') {
    await aba.click({ timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
  return page.locator('[data-canva-layer]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-canva-layer') ?? ''),
  );
}

interface DocumentoNaRede {
  pages?: Array<{ objects?: Array<{ id: string; name?: string; zIndex: number }> }>;
}

/**
 * Ordem VISUAL (topo primeiro) por ID.
 *
 * Por ID, e não por `name`: `name` é OPCIONAL no CanvaObject — o painel de
 * camadas DERIVA o rótulo ("Forma - star") para exibir. Uma sonda que lê
 * `name` de um objeto nunca renomeado devolve uma lista de vazios, que parece
 * "o editor não mandou nada" e é só o campo errado. Custou duas execuções.
 */
function ordemDoDocumento(doc: DocumentoNaRede | null): string[] {
  const objs = doc?.pages?.[0]?.objects;
  if (!objs) return [];
  return [...objs].sort((a, b) => b.zIndex - a.zIndex).map((o) => o.id);
}

/** Só os 6 primeiros caracteres do id: o trace precisa caber numa linha. */
const curto = (ids: string[]) => ids.map((i) => i.slice(0, 6)).join(',');

test('TRACE: a ordem do reorder sobrevive a PATCH, banco e F5', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);

  /**
   * Três observações, todas do tráfego REAL:
   *  - `patchOrder`: o que o editor ENVIOU no último PATCH;
   *  - `dbOrder`: o que a API DEVOLVEU depois de gravar (a linha persistida);
   *  - `getOrder`: o que um GET traz — é o que a hidratação lê no F5.
   */
  let patchOrder: string[] = [];
  let dbOrder: string[] = [];
  let getOrder: string[] = [];
  /** Contadores: sem eles, uma linha vazia no trace não diz se foi o produto ou a sonda. */
  const vistos = { patch: 0, get: 0, patchComPaginas: 0, respostaIlegivel: 0 };
  page.on('response', async (res) => {
    if (!/\/studio\/canvas-documents\/[^/?]+(\?.*)?$/.test(res.url())) return;
    const metodo = res.request().method();
    if (metodo !== 'PATCH' && metodo !== 'GET') return;

    // O que foi ENVIADO é lido primeiro e de forma independente: se a resposta
    // vier ilegível, ainda assim sabemos o que o editor mandou.
    if (metodo === 'PATCH') {
      vistos.patch += 1;
      const corpo = (() => {
        try {
          return res.request().postDataJSON() as DocumentoNaRede | null;
        } catch {
          return null;
        }
      })();
      const enviada = ordemDoDocumento(corpo);
      if (enviada.length > 0) {
        patchOrder = enviada;
        vistos.patchComPaginas += 1;
      }
    } else {
      vistos.get += 1;
    }

    const doc = (await res.json().catch(() => null)) as DocumentoNaRede | null;
    if (!doc) {
      vistos.respostaIlegivel += 1;
      return;
    }
    const ordem = ordemDoDocumento(doc);
    if (ordem.length === 0) return;
    if (metodo === 'PATCH') dbOrder = ordem;
    else getOrder = ordem;
  });

  await login(page);
  await abrirCanva(page);
  await page.getByRole('button', { name: /novo design/i }).first().click();
  await page.getByRole('button', { name: 'Criar design' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button').filter({ hasText: 'Instagram Portrait' }).first().click();
  await page.locator('input:not([type])').first().fill(`trace-reorder-${Date.now() % 1000000}`);
  await page.getByRole('button', { name: 'Criar design' }).click();
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });

  // Quatro camadas, como o roteiro pede.
  for (const forma of ['Retângulo', 'Elipse', 'Triângulo', 'Estrela']) {
    const b = page.getByRole('button', { name: forma, exact: true }).first();
    if (!(await b.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Elementos' }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.getByRole('button', { name: forma, exact: true }).first().click();
    await page.waitForTimeout(450);
  }

  await expect(page.getByText(/salvo/i).first()).toBeVisible({ timeout: 30000 });
  const uiAntes = await ordemNaTela(page);
  const patchAntes = [...patchOrder];
  const dbAntes = [...dbOrder];

  // O DRAG: move a camada do topo para a segunda posição.
  const linhas = page.locator('[data-canva-layer]');
  await linhas.nth(0).dragTo(linhas.nth(1));
  await page.waitForTimeout(900);
  const uiDepois = await ordemNaTela(page);

  await expect(page.getByText(/salvo/i).first()).toBeVisible({ timeout: 30000 });
  const patchDepois = [...patchOrder];
  const dbDepois = [...dbOrder];

  // F5 DE VERDADE, e reabrir o documento.
  await page.reload();
  await abrirCanva(page);
  await page.locator('[data-canva-doc]').first().click({ timeout: 45000 });
  await page.getByRole('button', { name: /exportar/i }).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(1500);
  const uiF5 = await ordemNaTela(page);
  const dbF5 = [...getOrder];

  console.log('\n===== TRACE DO REORDER =====');
  console.log('ANTES DO DRAG');
  console.log('  UI    :', curto(uiAntes));
  console.log('  PATCH :', curto(patchAntes));
  console.log('  DB    :', curto(dbAntes));
  console.log('DEPOIS DO DRAG');
  console.log('  UI    :', curto(uiDepois));
  console.log('  PATCH :', curto(patchDepois));
  console.log('  DB    :', curto(dbDepois));
  console.log('DEPOIS DO F5');
  console.log('  GET   :', curto(dbF5), ' <- o que a hidratacao leu');
  console.log('  UI    :', curto(uiF5));
  console.log(
    `respostas observadas: PATCH=${vistos.patch} (com páginas=${vistos.patchComPaginas}) GET=${vistos.get} ilegíveis=${vistos.respostaIlegivel}`,
  );
  console.log('============================\n');

  // O drag mudou alguma coisa de fato.
  expect(uiDepois).not.toEqual(uiAntes);
  // A ordem sobreviveu ao recarregamento — o defeito original era exatamente
  // isto voltar ao estado anterior.
  expect(uiF5, 'o F5 releu a ordem nova').toEqual(uiDepois);
  /**
   * E não é a tela lembrando: esta é a resposta do GET que a hidratação usa,
   * ou seja, a linha que está GRAVADA. Se o banco tivesse a ordem velha, ela
   * apareceria aqui.
   */
  expect(dbF5, 'o documento gravado tem a ordem nova').toEqual(uiDepois);

  /**
   * O CORPO do PATCH não é verificável por aqui, e isso é limite da sonda, não
   * do produto: o payload de autosave leva a thumbnail como data URL junto das
   * páginas, e `postDataJSON()` não devolve um corpo desse tamanho (medido:
   * PATCH observado = 1, com páginas legíveis = 0). O que o editor envia já
   * está coberto pela forense de unidade, que inspeciona o payload direto; e o
   * que chegou ao destino está provado acima, pela leitura do documento
   * gravado. Asserção que o instrumento não consegue fazer não vira asserção
   * frouxa: sai, e o motivo fica escrito.
   */
});
