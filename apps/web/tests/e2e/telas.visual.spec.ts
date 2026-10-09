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

      const aceita = faltando.length === 0 && overlay === 0 && esqueleto === 0 && overflow === 0;
      if (aceita) {
        await page.screenshot({ path: `../../docs/frontend-premium/screenshots/${tela.nome}-${r.nome}.png`, fullPage: true });
      }

      // Espaça as cargas: 21 páginas disparando ~15 consultas cada passa dos
      // 300/min da API, e o limite transforma tela boa em tela recusada.
      await page.waitForTimeout(1500);

      linhas.push(
        `${aceita ? 'ok  ' : 'NAO '}${tela.rota.padEnd(14)} ${r.nome.padEnd(8)}` +
          ` overflow:${String(overflow).padStart(4)} overlay:${overlay} esqueleto:${esqueleto}` +
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
