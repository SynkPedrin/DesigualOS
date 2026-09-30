import { test, expect } from '@playwright/test';
import { EMAIL, PASSWORD, login } from './tammy-harness';

/**
 * QA VISUAL DO CONTROL PLANE.
 *
 * Não testa lógica de negócio: testa que cada tela do reposicionamento ABRE,
 * mostra o que promete, e não quebra o layout. É o que o briefing pediu como
 * "abrir cada tela no navegador e verificar overflow, textos cortados, grids,
 * sidebar, ícones, logo do Claude, estados e tabelas".
 *
 * A asserção mais importante é a última de cada tela: NENHUMA overflow
 * horizontal. Tabela densa empurrando a página é o defeito clássico deste tipo
 * de produto, e é o que faz um painel parecer amador em laptop pequeno.
 */

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

/**
 * UM WORKER SÓ, e o motivo é medido.
 *
 * Estas telas batem em serviços REAIS: a nossa API, o Supabase no login, e —
 * na tela de MCP — um servidor em outro provedor. Com dois workers, a cadeia
 * login -> API -> Railway passou de 60s e o teste reprovou uma tela que estava
 * certa (sonda confirmou: as duas chamadas voltaram 200 e a tela dizia "No
 * ar"). Em série, a mesma suíte passa inteira.
 *
 * Paralelizar aqui não economiza tempo de verdade: troca minutos de relógio por
 * falha intermitente, e falha intermitente é como se aprende a ignorar suíte.
 */
test.describe.configure({ mode: 'default', retries: 0 });

const TELAS = [
  { rota: '/', titulo: /Control Plane/i },
  { rota: '/activity', titulo: /Atividade/i },
  { rota: '/health', titulo: /Saúde do sistema/i },
  { rota: '/memory', titulo: /Memória/i },
  { rota: '/decisions', titulo: /Decisões/i },
  { rota: '/people', titulo: /Pessoas/i },
  { rota: '/mcp', titulo: /^MCP$/i },
  { rota: '/tools', titulo: /Ferramentas/i },
  { rota: '/permissions', titulo: /Permissões/i },
  { rota: '/audit', titulo: /Auditoria/i },
  { rota: '/errors', titulo: /Incidentes/i },
  { rota: '/integrations', titulo: /Integrações/i },
  { rota: '/usage', titulo: /^Uso$/i },
];

test.describe('Control Plane — cada tela abre e se comporta', () => {
  test.setTimeout(300_000);

  for (const { rota, titulo } of TELAS) {
    test(`${rota} abre, titula e não estoura a largura`, async ({ page }) => {
      const errosDeConsole: string[] = [];
      page.on('pageerror', (e) => errosDeConsole.push(e.message));

      await login(page);
      await page.goto(rota);

      await expect(page.getByRole('heading', { name: titulo, level: 1 })).toBeVisible({ timeout: 30_000 });

      // Overflow horizontal: o defeito que faz painel denso parecer amador.
      const estoura = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(estoura, `${rota} tem rolagem horizontal`).toBe(false);

      expect(errosDeConsole, `${rota} lançou erro de runtime`).toEqual([]);
    });
  }

  /** A sidebar agrupada é o que reposiciona o produto — se ela não agrupar, nada mais importa. */
  test('a sidebar mostra as seções do Control Plane, com o interno por último', async ({ page }) => {
    await login(page);
    await page.goto('/');
    for (const secao of ['Visão geral', 'Inteligência', 'Controle', 'Sistema', 'Interno']) {
      await expect(page.getByText(secao, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    }
    // O console do Bento continua alcançável: mudou de lugar, não de estado.
    await expect(page.getByRole('link', { name: /Console do Bento/i })).toBeVisible();
  });

  /** A logo do Claude é asset local — se o caminho quebrar, a imagem some em silêncio. */
  test('a logo do Claude carrega do arquivo do projeto', async ({ page }) => {
    await login(page);
    // A home sempre tem a marca no bloco "Inteligência conectada", com ou sem
    // conexão — diferente da tabela do MCP, que só existe quando há alguém.
    await page.goto('/');
    const logo = page.locator('img[alt="Claude"]').first();
    await expect(logo).toBeVisible({ timeout: 20_000 });
    await expect(logo).toHaveJSProperty('naturalWidth', 320);
  });

  /**
   * A promessa central: o estado do MCP é LIDO, nunca escrito no código.
   *
   * Este teste já afirmou o contrário — exigia "Não publicado" e proibia
   * qualquer URL. Passou verde enquanto a tela mentia: o servidor tinha subido
   * no Railway e a página seguia anunciando ausência, com o teste defendendo a
   * mentira. É o mesmo defeito de instrumento que apareceu quatro vezes no
   * chat, agora no front.
   *
   * O que ele trava agora é a propriedade que não envelhece: a tela mostra
   * exatamente um dos estados possíveis, e o endereço que mostra veio da API.
   */
  test('MCP mostra o estado REAL do servidor, vindo da API', async ({ page }) => {
    await login(page);
    await page.goto('/mcp');

    const endpoint = page.getByText(/Endpoint/i).locator('..');
    await expect(endpoint).toBeVisible({ timeout: 20_000 });

    /**
     * ESPERA O ESTADO FINAL APARECER, em vez de contar o tempo até o
     * "Consultando" sumir.
     *
     * A diferença não é estilo: a cadeia é login -> /mcp/status (nossa API) ->
     * /health (o servidor MCP, que é outro serviço, em outro provedor). Com
     * dois workers competindo pelo login, isso passou de 30s e o teste reprovou
     * uma tela que estava certa — conferido com sonda: as duas chamadas
     * voltaram 200 e a tela dizia "No ar".
     *
     * Esperar pelo que se quer ver, e não pelo que se quer que suma, também diz
     * melhor o que o teste protege.
     */
    const estadoFinal = page.getByText(/^(No ar|No ar · banco em \d+ms|Não respondeu|Sem endereço configurado|Não consegui ler o estado)/);
    await expect(estadoFinal.first()).toBeVisible({ timeout: 60_000 });
    expect(await estadoFinal.count(), 'a tela precisa declarar exatamente um estado do servidor').toBe(1);

    // Se diz que está no ar, tem que mostrar um endereço de verdade — não "—".
    if ((await page.getByText(/^No ar/).count()) > 0) {
      await expect(endpoint).toContainText(/https?:\/\//);
    }
  });

  /** Conexão e chamada são NÚMEROS LIDOS: zero aparece como ausência, não como falha. */
  test('MCP separa "ninguém conectou" de "não consegui ler"', async ({ page }) => {
    await login(page);
    await page.goto('/mcp');
    await expect(page.getByRole('heading', { name: /^MCP$/i, level: 1 })).toBeVisible({ timeout: 20_000 });
    // As duas frases NUNCA podem aparecer juntas: são diagnósticos opostos.
    const semNinguem = await page.getByText(/Ninguém conectou ainda/i).count();
    const semLeitura = await page.getByText(/Não consegui ler as conexões/i).count();
    expect(semNinguem + semLeitura, 'ausência e falha de leitura não podem coexistir').toBeLessThanOrEqual(1);
  });
});

/**
 * A CAMADA DE INTELIGÊNCIA APLICADA A UMA CONTA.
 *
 * Duas propriedades que separam "painel de tarefas" de "camada de
 * inteligência", e que já divergiram entre telas neste produto:
 *
 *   1. Clientes e Overview contam a MESMA carteira. Enquanto a grade tratava
 *      fixture de teste como cliente, o Overview dizia 49 e a grade mostrava 58
 *      — a família de defeito mais cara deste projeto (1222 x 411, 33 x 35).
 *   2. A ficha do cliente mostra o que o sistema APRENDEU, não só o que está
 *      aberto no ClickUp.
 */
test.describe('inteligência por cliente', () => {
  test.setTimeout(180_000);

  test('a tela de Clientes conta a carteira, não a tabela inteira', async ({ page }) => {
    await login(page);
    await page.goto('/clients');
    /**
     * Espera OS CARDS, que são a precondição real — e não o chip de
     * "Carregando..." sumir.
     *
     * Duas tentativas anteriores erraram por esperar a coisa errada: primeiro
     * eu não esperei nada, depois esperei o chip do usuário, que com dois
     * workers competindo pelo login demora mais de 30s e não tem relação
     * nenhuma com a lista de clientes ter chegado.
     *
     * A regra que sai disso, e que já valeu pra tela de MCP hoje: espere o que
     * você quer VER, e que o próprio teste depende — não um sintoma vizinho.
     */
    await expect(page.locator('[data-client-id]').first()).toBeVisible({ timeout: 60_000 });
    // A descrição do cabeçalho separa carteira de interno e de teste.
    await expect(page.getByText(/\d+ na carteira/)).toBeVisible({ timeout: 30_000 });
  });

  test('a ficha do cliente tem aba de Memória', async ({ page }) => {
    await login(page);
    await page.goto('/clients');
    // Abre a primeira conta da grade. O card É a precondição — esperar por ele
    // dispensa esperar qualquer outro sinal de carregamento.
    const primeiro = page.locator('[data-client-id]').first();
    await expect(primeiro).toBeVisible({ timeout: 60_000 });
    await primeiro.click();
    const aba = page.getByRole('button', { name: 'Memória', exact: true });
    await expect(aba).toBeVisible({ timeout: 20_000 });
    await aba.click();
    /**
     * A prova é NEGATIVA e é a que importa: a aba precisa dizer alguma coisa —
     * registros, "nada aprendido ainda", ou falha de leitura. O que ela não
     * pode é ficar em branco, que é o estado em que ninguém sabe se o sistema
     * não sabe nada ou se não conseguiu ler.
     */
    await expect(
      page.getByText(/registro\(s\)|Nada aprendido sobre este cliente|Não consegui ler a memória/),
    ).toBeVisible({ timeout: 30_000 });
  });
});
