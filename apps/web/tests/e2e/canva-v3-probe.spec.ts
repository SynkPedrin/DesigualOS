/**
 * PROBE E2E — documenta o estado do editor Canva do Studio no DEPLOY REAL
 * de produção (commit 5b0e1fb). Não cria nada em produção: abre o PRIMEIRO
 * documento existente do cliente de teste.
 *
 * Uso:
 *   set -a && source .env.local && set +a && \
 *   E2E_BASE_URL=https://desigual-os.vercel.app \
 *   pnpm playwright test canva-v3-probe --project=chromium --workers=1
 */
import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMAIL, PASSWORD, CLIENTE, login, abrirCanva, capturarErros, log, type Erros,
} from './canva-helpers';

const ARTEFATOS = resolve(dirname(fileURLToPath(import.meta.url)), 'artifacts/canva-v3-recovery');

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
];

test.skip(!EMAIL || !PASSWORD, 'defina STUDIO_TEST_EMAIL/STUDIO_TEST_PASSWORD');

function shot(page: Page, nome: string) {
  const destino = `${ARTEFATOS}/${nome}.png`;
  mkdirSync(dirname(destino), { recursive: true });
  return page.screenshot({ path: destino, fullPage: false }).then(() => log(`screenshot: ${nome}.png`));
}

function salvarJson(nome: string, dados: unknown) {
  const destino = `${ARTEFATOS}/${nome}`;
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify(dados, null, 2));
  log(`json: ${nome}`);
}

async function medirLayout(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom };
    };
    const css = (el: Element | null) => {
      if (!el) return null;
      const c = getComputedStyle(el);
      return {
        overflow: c.overflow, overflowY: c.overflowY, overflowX: c.overflowX,
        height: c.height, maxHeight: c.maxHeight, position: c.position, display: c.display,
      };
    };
    const desc = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].length ? '.' + [...el.classList].join('.') : ''}`;

    const artboard =
      document.querySelector('[data-canva-artboard]') ??
      document.querySelector('canvas.upper-canvas') ??
      document.querySelector('.canvas-container') ??
      document.querySelector('canvas');

    const ancestors: { descricao: string; css: ReturnType<typeof css>; rect: ReturnType<typeof rect> }[] = [];
    let el: Element | null = artboard;
    while (el && el !== document.body) {
      ancestors.push({ descricao: desc(el), css: css(el), rect: rect(el) });
      el = el.parentElement;
    }
    ancestors.push({ descricao: desc(document.body), css: css(document.body), rect: rect(document.body) });

    const first = (sel: string[]) => {
      for (const s of sel) { const e = document.querySelector(s); if (e) return e; }
      return null;
    };

    return {
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
      scroll: {
        documentElementScrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
        windowScrollY: window.scrollY,
      },
      html: css(document.documentElement),
      body: css(document.body),
      rects: {
        editorRoot: rect(first(['[data-canva-editor]', '[data-canva-root]', 'main'])),
        artboard: rect(artboard),
        topbar: rect(first(['[data-canva-topbar]', 'header', '[class*="topbar" i]'])),
        sidebar: rect(first(['[data-canva-sidebar]', 'aside', '[class*="sidebar" i]'])),
        properties: rect(document.querySelector('[data-canva-properties]')),
      },
      artboardSelector: artboard ? desc(artboard) : null,
      ancestorsDoArtboard: ancestors,
    };
  });
}

async function textoVisivel(page: Page, texto: string) {
  return page.getByText(texto, { exact: false }).first().isVisible().catch(() => false);
}

async function probarTexto(page: Page, prefixo: string, erros: Erros) {
  const resultado: Record<string, unknown> = {};
  // deploy antigo não tem data-canva-artboard — o container do Fabric sempre existe
  const artboard = page.locator('[data-canva-artboard], .canvas-container').first();
  // no deploy 5b0e1fb, texto selecionado faz a FloatingToolbar mostrar "Escolher fonte"
  const fonteBtn = page.getByRole('button', { name: 'Escolher fonte' });

  const estadoToolbarTexto = async () => {
    const count = await fonteBtn.count();
    if (!count) return { presenteNoDom: false };
    const visivel = await fonteBtn.first().isVisible({ timeout: 800 }).catch(() => false);
    const box = await fonteBtn.first().boundingBox({ timeout: 800 }).catch(() => null);
    const vw = page.viewportSize();
    return {
      presenteNoDom: true,
      visivelCss: visivel,
      box,
      dentroDoViewport: box && vw
        ? box.y >= 0 && box.y + box.height <= vw.height && box.x >= 0 && box.x + box.width <= vw.width
        : null,
    };
  };

  // baseline: a toolbar "sem seleção" (TextAddMenu/Imagem/Background) também fica
  // ancorada em bottom-4 da área do canvas — verifica se ela está no viewport
  const shellToolbar = page.locator('div.bg-grafite\\/90').first();
  const boxShell = await shellToolbar.boundingBox({ timeout: 800 }).catch(() => null);
  const vw0 = page.viewportSize();
  resultado.toolbarPadraoBottom = {
    presenteNoDom: (await page.locator('div.bg-grafite\\/90').count()) > 0,
    box: boxShell,
    dentroDoViewport: boxShell && vw0 ? boxShell.y >= 0 && boxShell.y + boxShell.height <= vw0.height : null,
  };
  resultado.toolbarTextoAntesDoClique = await estadoToolbarTexto();

  const caixaArt = await artboard.boundingBox({ timeout: 5000 }).catch(() => null);
  resultado.artboardEncontrado = !!caixaArt;

  // (a) clique único DIRETO no título do documento (posição relativa medida nos screenshots)
  let selecionou = false;
  let pontoSelecionado: { fx: number; fy: number } | null = null;
  if (caixaArt) {
    for (const [fx, fy] of [[0.55, 0.25], [0.5, 0.3], [0.5, 0.42], [0.5, 0.5], [0.35, 0.25], [0.6, 0.55], [0.4, 0.6], [0.5, 0.7]] as const) {
      await artboard.click({ position: { x: caixaArt.width * fx, y: caixaArt.height * fy }, force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      const est = await estadoToolbarTexto();
      if (est.presenteNoDom) { selecionou = true; pontoSelecionado = { fx, fy }; resultado.selecionadoNoPonto = pontoSelecionado; break; }
    }
  }
  resultado.cliqueSelecionouTexto = selecionou;
  resultado.toolbarTextoDepoisDoClique = await estadoToolbarTexto();
  await shot(page, `${prefixo}-02-texto-selecionado`);

  // (b) se não selecionou, adiciona um texto pela UI (aba Texto > "Adicionar título")
  if (!selecionou) {
    const abaTexto = page.getByRole('button', { name: /^texto$/i }).first();
    if (await abaTexto.isVisible({ timeout: 1500 }).catch(() => false)) {
      await abaTexto.click().catch(() => {});
      await page.waitForTimeout(400);
    }
    const addTitulo = page.getByRole('button', { name: /adicionar t[íi]tulo/i }).first();
    if (await addTitulo.isVisible({ timeout: 1500 }).catch(() => false)) {
      await addTitulo.click().catch(() => {});
      await page.waitForTimeout(1000);
      resultado.adicionouTextoPelaUI = true;
      resultado.toolbarTextoDepoisDeAdicionar = await estadoToolbarTexto();
      await shot(page, `${prefixo}-03-texto-adicionado`);
    } else {
      resultado.botaoAdicionarTituloEncontrado = false;
    }
  }

  // (c) duplo clique entra em edição de texto (IText isEditing => textarea no DOM)?
  // dblclick no MESMO ponto que selecionou (senão cai em objeto vazio/outro objeto)
  const pontoDbl = pontoSelecionado ?? { fx: 0.5, fy: 0.3 };
  const caixa2 = await artboard.boundingBox({ timeout: 3000 }).catch(() => null);
  if (caixa2) {
    await artboard.dblclick({ position: { x: caixa2.width * pontoDbl.fx, y: caixa2.height * pontoDbl.fy }, force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, `${prefixo}-04-texto-editando`);
    await page.keyboard.type('X').catch(() => {});
    await page.waitForTimeout(400);
    resultado.edicao = await page.evaluate(() => {
      const ta = document.querySelector('textarea');
      const style = ta ? getComputedStyle(ta) : null;
      return {
        pontoDbl: true,
        textareaNoDom: !!ta,
        textareaVisivel: !!ta && !!style && style.display !== 'none' && style.visibility !== 'hidden',
        activeElement: document.activeElement?.tagName ?? null,
      };
    });
    await shot(page, `${prefixo}-05-texto-digitado`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }

  // (d) re-seleciona o texto (o Escape pode ter tirado a seleção) e scrolla o main:
  // a FloatingToolbar é bottom-4 da área do canvas — scrollar o main a traz pro viewport?
  if (pontoSelecionado && caixa2) {
    await artboard.click({ position: { x: caixa2.width * pontoSelecionado.fx, y: caixa2.height * pontoSelecionado.fy }, force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  resultado.scrollMain = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const antes = main.scrollTop;
    main.scrollTop = main.scrollHeight;
    return { antes, depois: main.scrollTop, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, rolou: main.scrollTop !== antes };
  });
  await page.waitForTimeout(500);
  resultado.toolbarTextoAposScrollMain = await estadoToolbarTexto();
  await shot(page, `${prefixo}-06-apos-scroll-main`);

  // (e) mudar cor pela UI: ColorPicker "Cor" da FloatingToolbar
  const corBtn = page.getByRole('button', { name: /^cor$/i }).first();
  if (await corBtn.count()) {
    const boxCor = await corBtn.boundingBox({ timeout: 800 }).catch(() => null);
    resultado.botaoCor = { presenteNoDom: true, box: boxCor, dentroDoViewport: boxCor && vw0 ? boxCor.y >= 0 && boxCor.y + boxCor.height <= vw0.height : null };
    await corBtn.click({ force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    resultado.paletaCorAbriu = await page.locator('input[type="text"]').count().then(() => true).catch(() => false);
    await shot(page, `${prefixo}-06-cor-picker`);
  } else {
    resultado.botaoCor = { presenteNoDom: false };
  }

  resultado.errosAteAqui = {
    pageerror: erros.pageerror.length,
    consoleError: erros.consoleError.slice(0, 10),
  };
  return resultado;
}

for (const vp of VIEWPORTS) {
  test(`probe canva v3 em producao ${vp.width}x${vp.height}`, async ({ page }) => {
    test.setTimeout(300_000);
    const p = `${vp.width}x${vp.height}`;
    const erros = capturarErros(page);
    await page.setViewportSize(vp);

    await login(page);
    await abrirCanva(page);
    await shot(page, `prod-00-lista-${p}`);

    const heroAntes = await textoVisivel(page, 'STUDIO');
    const tabGaleria = await page.getByRole('button', { name: /^galeria$/i }).first().isVisible().catch(() => false);
    const tabCanva = await page.getByRole('button', { name: /^canva$/i }).first().isVisible().catch(() => false);

    // abre o PRIMEIRO documento existente — não cria nada em produção
    // (o deploy 5b0e1fb não tem data-canva-doc; o card clicável é o botão
    // aspect-square com o thumbnail dentro da seção "Seus designs")
    const docs = page.locator('[data-canva-doc]');
    const cardsAntigos = page.locator('main button.aspect-square');
    await docs.first().or(cardsAntigos.first()).waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const totalDocs = (await docs.count()) + (await cardsAntigos.count());
    log(`documentos existentes do cliente ${CLIENTE}: ${totalDocs}`);
    if (totalDocs === 0) {
      salvarJson(`prod-medidas-${p}.json`, { erro: 'nenhum documento existente; probe abortado antes de criar' });
      throw new Error('SEM_DOCUMENTO: nenhum documento existente no cliente de teste em produção');
    }
    const alvo = (await docs.count()) > 0 ? docs.first() : cardsAntigos.first();
    await alvo.click({ timeout: 45000 });
    await page.getByRole('button', { name: /exportar/i }).first().waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(2500);

    await shot(page, `prod-01-editor-${p}`);

    const medidas = await medirLayout(page);
    const heroDepois = await textoVisivel(page, 'STUDIO');
    const tabsDepois = {
      galeria: await page.getByRole('button', { name: /^galeria$/i }).first().isVisible().catch(() => false),
      canva: await page.getByRole('button', { name: /^canva$/i }).first().isVisible().catch(() => false),
    };

    // teste de scroll
    const scroll = await page.evaluate(() => {
      const antes = window.scrollY;
      window.scrollTo(0, 500);
      const depoisWindow = window.scrollY;
      const painel = document.querySelector('[data-canva-properties]') as HTMLElement | null;
      let painelRola: boolean | null = null;
      if (painel) {
        const antesPainel = painel.scrollTop;
        painel.scrollTop = 500;
        painelRola = painel.scrollTop !== antesPainel;
      }
      const scrolaveis: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const h = el as HTMLElement;
        if (h.scrollHeight > h.clientHeight + 20) {
          const c = getComputedStyle(h);
          if (c.overflowY === 'auto' || c.overflowY === 'scroll') {
            scrolaveis.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')} (scrollHeight=${h.scrollHeight} clientHeight=${h.clientHeight})`);
          }
        }
      });
      return { windowRolou: depoisWindow !== antes, scrollYFinal: depoisWindow, painelRola, elementosRolaveis: scrolaveis.slice(0, 20) };
    });

    const relatorio: Record<string, unknown> = {
      viewport: vp,
      heroStudioVisivel: { antesDeAbrirDoc: heroAntes, duranteEdicao: heroDepois },
      tabsVisiveis: { antes: { galeria: tabGaleria, canva: tabCanva }, duranteEdicao: tabsDepois },
      medidas,
      scroll,
    };
    // salva o parcial antes do probe de texto: se ele estourar o timeout, as medidas não se perdem
    salvarJson(`prod-medidas-${p}.json`, relatorio);

    const texto = await probarTexto(page, `prod-${p}`, erros);

    relatorio.texto = texto;
    relatorio.erros = {
      pageerror: erros.pageerror,
      consoleError: erros.consoleError.slice(0, 30),
      requisicoesFalhas: erros.requisicoesFalhas.slice(0, 30),
    };
    salvarJson(`prod-medidas-${p}.json`, relatorio);
    log(`relatório ${p}: ${JSON.stringify({ hero: relatorio.heroStudioVisivel, tabs: relatorio.tabsVisiveis, scroll: { windowRolou: scroll.windowRolou, painelRola: scroll.painelRola }, texto: { selecionou: texto.cliqueSelecionouTexto, toolbarPadraoNoViewport: (texto.toolbarPadraoBottom as { dentroDoViewport?: boolean } | undefined)?.dentroDoViewport, toolbarTextoDepois: texto.toolbarTextoDepoisDoClique, edicao: texto.edicao, scrollMain: (texto.scrollMain as { rolou?: boolean } | null)?.rolou } })}`);
  });
}
