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
     * ESPERA A CONSULTA ASSENTAR antes de contar.
     *
     * A primeira versão contava na hora e reprovava com "0 estados" — porque a
     * tela ainda dizia "Consultando", que é um estado legítimo e o único que o
     * regex não cobre. Teste que lê antes do dado chegar acusa o produto de um
     * defeito que é do teste; já aconteceu quatro vezes neste projeto em um dia.
     */
    await expect(page.getByText('Consultando', { exact: true })).toHaveCount(0, { timeout: 30_000 });

    // Um dos três, nunca dois: publicado, sem endereço, ou não consegui ler.
    const estados = await page.getByText(/^(Publicado|Sem endereço configurado|Não consegui ler o estado)$/).count();
    expect(estados, 'a tela precisa declarar exatamente um estado do servidor').toBe(1);

    // Se diz publicado, tem que mostrar um endereço de verdade — não "—".
    const publicado = await page.getByText('Publicado', { exact: true }).count();
    if (publicado > 0) {
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
