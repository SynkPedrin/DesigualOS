import { test, expect, type Page } from '@playwright/test';

/**
 * CAPTURAS QUE SÓ VALEM SE A TELA ESTIVER PRONTA.
 *
 * Três rodadas anteriores produziram imagens inúteis — tema claro, tela vazia,
 * tutorial por cima — e todas passaram nos testes, porque o que eu verificava
 * era ausência de erro. Ausência de erro não é presença de conteúdo.
 *
 * Aqui cada captura passa por um portão antes de ser aceita: nada de overlay,
 * nada de esqueleto, o conteúdo que a tela promete presente, e o console sem
 * erro. Imagem que não passa no portão não é salva como evidência.
 */
const RESOLUCOES = [
  { nome: 'desktop', width: 1920, height: 1080 },
  { nome: 'tablet', width: 768, height: 1024 },
  { nome: 'mobile', width: 390, height: 844 },
] as const;

/**
 * O que cada tela PRECISA mostrar, em minúsculas: o PageHeader aplica
 * text-transform e o `innerText` devolve o texto já transformado — uma versão
 * anterior deste teste acusou "falta Pipelines" numa tela escrita PIPELINES.
 */
const TELAS = [
  // As sete com mockup de referência em `assets/TELASS - TUTORIAL/`, que são as
  // que o portão confere por conteúdo — `exige` é o texto que a tela PROMETE.
  { rota: '/pipeline', nome: 'pipeline', exige: ['cartões no quadro', 'valor no quadro', 'maior acúmulo'] },
  { rota: '/workflows', nome: 'automacoes', exige: ['automações ativas', 'próxima execução'] },
  { rota: '/activity', nome: 'atividade', exige: ['na operação'] },
  { rota: '/integrations', nome: 'integracoes', exige: ['conectadas', 'saúde', 'sem configuração'] },
  { rota: '/memory', nome: 'memoria', exige: ['conhecimento'] },
  { rota: '/', nome: 'visao-geral', exige: [] },
  { rota: '/today', nome: 'hoje', exige: [] },

  /**
   * O RESTO DA BARRA LATERAL — sem mockup, e mesmo assim no portão.
   *
   * Sem estas, "o sistema está validado" queria dizer "sete das dezoito telas
   * que a pessoa consegue abrir pelo menu estão validadas". Aqui elas não têm
   * `exige` porque não há mockup dizendo o que prometem; o que o portão ainda
   * garante é o que independe de desenho: sem overlay preso, sem esqueleto
   * eterno, sem estouro horizontal e sem erro de JavaScript.
   */
  { rota: '/tasks', nome: 'tarefas', exige: [] },
  { rota: '/calendar', nome: 'calendario', exige: [] },
  { rota: '/clients', nome: 'clientes', exige: [] },
  { rota: '/organizations', nome: 'empresas', exige: [] },
  { rota: '/inbox', nome: 'inbox', exige: [] },
  { rota: '/demands', nome: 'campanhas', exige: [] },
  { rota: '/midias', nome: 'midias', exige: [] },
  { rota: '/people', nome: 'equipe', exige: [] },
  { rota: '/approvals', nome: 'aprovacoes', exige: [] },
  { rota: '/chat', nome: 'chat', exige: [] },
  { rota: '/settings', nome: 'configuracoes', exige: [] },
] as const;

/**
 * CONTA ESQUELETO, NÃO ANIMAÇÃO.
 *
 * `animate-pulse` é usado pra duas coisas diferentes neste produto: o bloco
 * cinza de carregando E enfeite permanente — o ponto de status ao vivo no
 * `status-badge`, o indicador de digitação do Bento. Contar os dois juntos fez
 * o portão recusar 21 de 21 capturas de telas que estavam prontas.
 *
 * O recorte: dentro do `main` (a barra lateral tem widget próprio que pulsa por
 * conta dela) e com área de bloco. Um ponto de 6px não é esqueleto.
 */
/**
 * O CRACHÁ DE DEV DO NEXT SAI DA FOTO — e isto não é maquiar o produto.
 *
 * `next.config.ts` tem `devIndicators: { position: 'top-left' }`, e o Playwright
 * sobe o app com `pnpm dev`. O resultado é um quadrado escuro com um "N" por
 * cima do logo da barra lateral, em TODAS as 21 capturas. Passei um tempo
 * procurando no componente de logo um defeito que não existe ali.
 *
 * Esse elemento não existe em produção: é ferramenta de desenvolvimento, não
 * parte da interface. Escondê-lo aproxima a captura do que a pessoa vê, que é
 * o contrário de disfarçar. Nada do produto é tocado — só o `nextjs-portal`,
 * que é o custom element onde o Next monta o próprio overlay.
 */
async function esconderFerramentasDeDev(page: Page) {
  await page.addInitScript(() => {
    /**
     * `addInitScript` roda ANTES do documento ser montado, então
     * `document.documentElement` pode ser null — e era: a primeira versão disto
     * disparou "Cannot read properties of null (reading 'appendChild')" nas 21
     * capturas, e o portão registrou 24 problemas de console que eu mesmo tinha
     * acabado de criar. Instrumento que suja o que está medindo mede o próprio
     * ruído.
     */
    const aplicar = () => {
      if (document.getElementById('sem-ferramentas-de-dev')) return;
      const raiz = document.documentElement ?? document.head ?? document.body;
      if (!raiz) return;
      const estilo = document.createElement('style');
      estilo.id = 'sem-ferramentas-de-dev';
      estilo.textContent =
        'nextjs-portal, [data-nextjs-dev-tools-button], #__next-dev-tools-indicator { display: none !important; }';
      raiz.appendChild(estilo);
    };
    aplicar();
    document.addEventListener('DOMContentLoaded', aplicar);
  });
}

/**
 * CARTÃO CORTADO É DEFEITO, não detalhe estético.
 *
 * Regra do Pedro, 09/10/2026: "os cards sempre tem q aparecer por inteiros".
 * Ele relatou duas vezes o mesmo problema — barra lateral com "Configurações"
 * terminando 11px abaixo da caixa de rolagem, encoberto pelo cartão de saúde —
 * e nas duas o corte fazia a lista PARECER acabada. Um item cortado não é um
 * item menos bonito: é um item que a pessoa não sabe que existe.
 *
 * O que esta conta considera corte, e o que ela de propósito ignora:
 *
 * CORTE é um bloco que ultrapassa a caixa que o contém SEM QUE A ROLAGEM
 * RESOLVA. Ou o ancestral tem `overflow: hidden` (nunca vai revelar), ou o
 * ancestral rola mas já está no fim (não há mais pra onde ir).
 *
 * NÃO é corte um bloco abaixo da dobra de um container que ainda pode rolar:
 * isso é lista comprida, e acusar isso faria o portão recusar toda tela com
 * conteúdo. Por isso cada container é levado até o fim ANTES de medir — a
 * pergunta não é "está visível agora", é "existe posição em que apareça
 * inteiro".
 */
async function blocosCortados(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const raiz = document.querySelector('main')?.parentElement ?? document.body;

    /** Ancestral que de fato recorta o elemento. */
    function recortador(el: Element): Element | null {
      let pai = el.parentElement;
      while (pai && pai !== document.body) {
        const s = getComputedStyle(pai);
        if (/(hidden|auto|scroll)/.test(s.overflowY) || /(hidden|auto|scroll)/.test(s.overflowX)) return pai;
        pai = pai.parentElement;
      }
      return null;
    }

    // Leva cada rolagem ao fim: o que aparece depois de rolar não é corte.
    for (const el of raiz.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY)) el.scrollTop = el.scrollHeight;
    }

    const achados: string[] = [];
    // Só blocos de verdade: cartão, item de navegação, linha de tabela.
    const candidatos = raiz.querySelectorAll('a, button, li, tr, [class*="rounded-lg"], [class*="rounded-xl"]');

    for (const el of candidatos) {
      const caixa = el.getBoundingClientRect();
      if (caixa.width * caixa.height < 600) continue;
      const pai = recortador(el);
      if (!pai) continue;
      const limite = pai.getBoundingClientRect();
      const sobraEmbaixo = caixa.bottom - limite.bottom;
      const sobraNaDireita = caixa.right - limite.right;
      // 2px de folga: arredondamento de layout não é corte.
      if (sobraEmbaixo <= 2 && sobraNaDireita <= 2) continue;

      const paiRolaMais =
        (sobraEmbaixo > 2 && pai.scrollHeight - pai.scrollTop - pai.clientHeight > 2) ||
        (sobraNaDireita > 2 && pai.scrollWidth - pai.scrollLeft - pai.clientWidth > 2);
      if (paiRolaMais) continue;

      const texto = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 34) || el.tagName.toLowerCase();
      achados.push(`"${texto}" sobra ${Math.round(Math.max(sobraEmbaixo, sobraNaDireita))}px`);
    }
    return [...new Set(achados)].slice(0, 6);
  });
}

async function instalarContador(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __esqueletos: () => number }).__esqueletos = () => {
      const area = document.querySelector('main') ?? document.body;
      return [...area.querySelectorAll('.animate-pulse')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height > 1500;
      }).length;
    };
  });
}

async function prontaParaCaptura(page: Page, exige: readonly string[]) {
  // 1. Overlay: modal, diálogo ou vídeo do tutorial cobrindo a tela.
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 20_000 });

  // 2. Conteúdo: espera o que a tela promete, em vez de cronometrar. Dormir um
  //    tempo fixo dava resultado diferente pra MESMA rota em resoluções
  //    diferentes — corrida, não layout.
  if (exige.length > 0) {
    await page
      .waitForFunction(
        (termos) => {
          const t = (document.body.innerText || '').toLowerCase();
          return termos.every((x) => t.includes(x));
        },
        [...exige],
        { timeout: 25_000 },
      )
      .catch(() => undefined);
  }

  // 3. Esqueleto no CONTEÚDO, e só o que é bloco.
  await page.waitForFunction(() => (window as unknown as { __esqueletos: () => number }).__esqueletos() === 0, undefined, { timeout: 20_000 }).catch(() => undefined);

  // Deixa a animação de entrada assentar — framer-motion abre em ~180ms.
  await page.waitForTimeout(600);
}

test('capturas limpas das telas, em três resoluções', async ({ page }) => {
  test.setTimeout(TELAS.length * RESOLUCOES.length * 45_000);

  const problemas: string[] = [];
  let atual = '';
  /**
   * 429 ACUSA O AMBIENTE, NUNCA A TELA.
   *
   * A API limita 300 requisições por minuto e isenta o loopback FORA de
   * produção (server.ts). Só que aqui ela roda com NODE_ENV=production, porque
   * em development o bundle ESM quebra no `__dirname` do pino-pretty. Resultado:
   * a isenção não vale, a suíte acumula requisições ao longo das 21 cargas e as
   * últimas telas recebem 429 — as consultas ficam repetindo e o esqueleto nunca
   * sai.
   *
   * Foi exatamente o que aconteceu em 09/10/2026: `/today` recusada em tablet e
   * mobile por 15 esqueletos. Aberta sozinha, a mesma tela em 390px resolve com
   * ZERO esqueleto. A tela estava certa.
   *
   * O mesmo defeito já tinha sido medido em 01/10/2026 e está escrito no
   * server.ts: "um instrumento que falha por esgotar o próprio limite acusa o
   * produto por um defeito do ambiente". Contar aqui é o que impede a próxima
   * pessoa de ir depurar a tela.
   */
  let respostas429 = 0;
  page.on('response', (r) => {
    if (r.status() === 429) respostas429++;
  });

  /**
   * O INSTRUMENTO PARA DE DISPUTAR CONSIGO MESMO.
   *
   * Medido em 09/10/2026: `/clients` recusada nas três resoluções por
   * esqueleto, e aberta sozinha ela assenta em 11,8s — dentro dos 20s que o
   * portão espera. O mesmo valia pra /organizations (2,6s), /calendar (6,3s) e
   * /settings (1,4s). Nenhuma tinha defeito.
   *
   * O que acontecia: a suíte navega 54 vezes seguidas e ia pra próxima tela com
   * as consultas da anterior ainda no ar. O pool do Postgres tem TRÊS conexões
   * (`DATABASE_POOL_MAX`), então a tela nova entrava na fila atrás da velha, e
   * a soma passava dos 20s. O portão estava medindo a carga que ele mesmo
   * criava e cobrando isso do produto.
   *
   * Esperar as requisições anteriores drenarem custa segundos e devolve o que
   * a medição deveria ter: cada tela medida sozinha, como a pessoa a abre.
   */
  const emVoo = new Set<string>();
  page.on('request', (r) => emVoo.add(r.url()));
  page.on('response', (r) => emVoo.delete(r.request().url()));
  page.on('requestfailed', (r) => emVoo.delete(r.url()));

  async function esperarDrenar(limiteMs = 15_000) {
    const ate = Date.now() + limiteMs;
    while (Date.now() < ate) {
      const pendentes = [...emVoo].filter((u) => {
        const caminho = new URL(u).pathname;
        return !caminho.startsWith('/_next') && !caminho.includes('.');
      });
      if (pendentes.length === 0) return;
      await page.waitForTimeout(250);
    }
  }
  page.on('pageerror', (e) => problemas.push(`${atual} ESTOURO: ${e.message.slice(0, 120)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) problemas.push(`${atual} CONSOLE: ${m.text().slice(0, 100)}`);
  });

  await instalarContador(page);
  await esconderFerramentasDeDev(page);
  const linhas: string[] = [];

  for (const tela of TELAS) {
    for (const r of RESOLUCOES) {
      atual = `${tela.rota}@${r.nome}`;
      await page.setViewportSize({ width: r.width, height: r.height });
      await page.goto(tela.rota, { waitUntil: 'domcontentloaded' });
      await prontaParaCaptura(page, tela.exige);

      const corpo = (await page.locator('body').innerText()).toLowerCase();
      const faltando = tela.exige.filter((t) => !corpo.includes(t));
      const overlay = await page.locator('[role="dialog"]').count();
      const esqueleto = await page.evaluate(() => (window as unknown as { __esqueletos: () => number }).__esqueletos());
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const cortados = await blocosCortados(page);

      const aceita =
        faltando.length === 0 && overlay === 0 && esqueleto === 0 && overflow === 0 && cortados.length === 0;
      if (aceita) {
        await page.screenshot({ path: `../../docs/frontend-premium/screenshots/${tela.nome}-${r.nome}.png`, fullPage: true });
      }

      // Espaça as cargas: 54 páginas disparando ~15 consultas cada passa dos
      // 300/min da API, e o limite transforma tela boa em tela recusada.
      await page.waitForTimeout(1500);
      // E espera o que ficou no ar terminar, pra próxima tela não medir a fila
      // da anterior (ver "O INSTRUMENTO PARA DE DISPUTAR CONSIGO MESMO").
      await esperarDrenar();

      linhas.push(
        `${aceita ? 'ok  ' : 'NAO '}${tela.rota.padEnd(14)} ${r.nome.padEnd(8)}` +
          ` overflow:${String(overflow).padStart(4)} overlay:${overlay} esqueleto:${esqueleto}` +
          `${cortados.length ? `  CORTADO: ${cortados.join('; ')}` : ''}` +
          `${faltando.length ? `  FALTA: ${faltando.join(', ')}` : ''}`,
      );
    }
  }

  console.log('\n=== CAPTURAS ===\n' + linhas.join('\n'));
  console.log(`\n${problemas.length} problema(s) de console/JS`);
  if (problemas.length) console.log([...new Set(problemas)].join('\n'));

  const recusadas = linhas.filter((l) => l.startsWith('NAO'));
  console.log(`${recusadas.length} captura(s) recusadas de ${linhas.length}`);
  console.log(`${respostas429} resposta(s) 429 da API`);

  /**
   * A ordem importa: se houve 429, a recusa é do ambiente e dizer "a tela tem
   * esqueleto" seria mandar alguém depurar o lugar errado.
   */
  expect(
    respostas429,
    `a API recusou ${respostas429} requisição(ões) por limite de taxa durante a captura. ` +
      'As telas do fim da fila aparecem incompletas por causa disso, não por defeito delas. ' +
      'Rode a suíte com a API fora de NODE_ENV=production (a isenção de loopback volta a valer) ' +
      'ou espere um minuto entre rodadas.',
  ).toBe(0);
  expect(recusadas, 'capturas recusadas pelo portão de qualidade').toEqual([]);
});
