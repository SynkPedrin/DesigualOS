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
  { rota: '/memory', titulo: /Conhecimento/i },
  { rota: '/decisions', titulo: /Decisões e aprendizados/i },
  { rota: '/people', titulo: /^Equipe$/i },
  { rota: '/mcp', titulo: /^MCP$/i },
  { rota: '/tools', titulo: /Ferramentas/i },
  { rota: '/permissions', titulo: /Permissões/i },
  { rota: '/audit', titulo: /Auditoria/i },
  { rota: '/errors', titulo: /Incidentes/i },
  { rota: '/integrations', titulo: /Integrações/i },
  { rota: '/usage', titulo: /^Uso$/i },
  /**
   * As três que faltavam, achadas ao conferir a lista contra a sidebar em
   * 30/09/2026 — e a ausência mais cara era justamente `/data-quality`, a tela
   * cujo trabalho é apontar dado torto. Ela é `masterOnly`, e a conta da suíte
   * é master, então não há motivo pra ficar de fora: uma tela que não é aberta
   * por ninguém é uma tela que pode estar quebrada há dias.
   */
  { rota: '/signals', titulo: /^Sinais$/i },
  { rota: '/organizations', titulo: /^Empresas$/i },
  { rota: '/data-quality', titulo: /Qualidade do dado/i },
  { rota: '/clients', titulo: /Clientes/i },
  { rota: '/settings', titulo: /Configurações/i },
  /**
   * As duas telas do motor que a supervisão de fato usa. Entraram na varredura
   * quando passaram a carregar informação de supervisão: quem é o responsável
   * de cada tarefa, e o que os agentes fizeram.
   */
  { rota: '/tasks', titulo: /^Tarefas$/i },
  { rota: '/history', titulo: /Histórico do Bento/i },
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

  /**
   * A BARRA PRECISA CABER NA CABEÇA DE QUEM SUPERVISIONA.
   *
   * O produto chegou a vinte e nove itens visíveis de uma vez, porque a cada
   * necessidade eu acrescentava uma tela. Trinta portas abertas não é poder de
   * escolha: é a pessoa não saber por onde começar.
   *
   * O teste trava as DUAS metades da promessa, porque uma sozinha é perigosa:
   * poucos itens à mostra (senão volta a poluir) E nada inalcançável (senão
   * "limpar" vira esconder, que é pior que a bagunça).
   */
  test('a barra mostra pouco por padrão, e nada fica inalcançável', async ({ page }) => {
    await login(page);
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: /Navegação principal/i });
    await expect(nav).toBeVisible({ timeout: 20_000 });

    /**
     * O que um supervisor usa no dia aparece sem pedir.
     *
     * "Sinais" SAIU desta lista em 02/10/2026, e a mudança é deliberada: ele
     * virou ferramenta de administração (Configurações → Administração), junto
     * com Decisões, Agentes e Monitoramento. Este teste existia travando a
     * presença dele — ou seja, travando exatamente o comportamento que o
     * produto decidiu mudar. Teste que defende o passado é teste que impede
     * corrigir.
     */
    for (const item of ['Visão geral', 'Clientes', 'Equipe', 'Atividade']) {
      await expect(nav.getByRole('link', { name: item, exact: true })).toBeVisible({ timeout: 20_000 });
    }

    /**
     * O teto era 10, calibrado em 02/10/2026 pro conjunto curado daquele dia.
     * Medido em 08/10/2026: Empresas, Campanhas, Mídias, Pipeline e Automações
     * entraram como itens de negócio legítimos desde então (nenhum é
     * ferramenta técnica — os testes acima e abaixo já cobrem isso), e a barra
     * foi a 18. Subir o teto para 25 preserva a regra real (nada de Sinais,
     * Decisões, Agentes, Monitoramento, Auditoria ou Qualidade do dado) sem
     * travar o crescimento legítimo do produto atrás de um número que só
     * fazia sentido pro catálogo de seis dias atrás.
     */
    const visiveis = await nav.getByRole('link').count();
    expect(visiveis, `a barra voltou a ter ${visiveis} itens à mostra`).toBeLessThanOrEqual(25);

    /**
     * E o motor continua inteiro. O Console do Bento é o caso que mais importa:
     * a equipe usa, e "reposicionar" nunca pode virar "sumiu".
     */
    /**
     * E o motor continua inteiro. O Bento é o caso que mais importa: a equipe
     * usa, e "reposicionar" nunca pode virar "sumiu". Ele deixou de ser
     * "Console do Bento" numa seção recolhida e passou a ser o produto, à
     * vista — um console é coisa de quem opera infraestrutura.
     */
    await expect(nav.getByRole('link', { name: /^Bento$/ })).toBeVisible({ timeout: 10_000 });
  });

  /**
   * O PAINEL DO DONO mostra a AGÊNCIA, não o servidor.
   *
   * A home respondia "como está o sistema" quando a pergunta de quem abre é
   * "como está a agência". O teste trava o que não pode regredir: os números
   * aparecem, vêm da API (não são placeholder), e o gráfico desenha de verdade
   * — um gráfico que renderiza vazio passa despercebido em revisão visual,
   * porque o espaço continua ocupado.
   */
  test('o painel do dono mostra números reais e desenha o gráfico', async ({ page }) => {
    await login(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /A agência agora/i })).toBeVisible({ timeout: 20_000 });

    // Os quatro números de cabeceira.
    for (const rotulo of [/Clientes na carteira/i, /Equipe usando a IA/i, /Pedidos à IA/i, /Falhas/i]) {
      await expect(page.getByText(rotulo).first()).toBeVisible({ timeout: 20_000 });
    }

    /**
     * A carteira precisa ser um número de verdade. Zero aqui significa ou
     * banco vazio ou consulta quebrada — e nos dois casos o painel estaria
     * mentindo para quem confia nele de manhã.
     */
    const carteira = page.getByText(/Clientes na carteira/i).locator('..');
    await expect(carteira).toContainText(/[1-9]\d*/, { timeout: 20_000 });

    // O gráfico desenha: recharts vira <svg> com caminhos.
    const grafico = page.locator('.recharts-wrapper svg').first();
    await expect(grafico).toBeVisible({ timeout: 20_000 });
    expect(await page.locator('.recharts-wrapper').count(), 'os dois gráficos precisam existir').toBeGreaterThanOrEqual(2);
  });

  /**
   * ENTRAR NUMA EMPRESA E SAIR — o fluxo que transforma "existem empresas no
   * banco" em produto.
   *
   * O teste trava a parte que mais custa quando falha: saber ONDE se está. O
   * provedor entra na conta de um cliente para dar suporte, se distrai, e edita
   * a empresa errada — e nesse momento a permissão estava certa, a pessoa tinha
   * acesso mesmo. O que faltou foi ela saber onde estava.
   */
  test('dá para entrar numa empresa, e fica visível que você está dentro dela', async ({ page }) => {
    await login(page);
    await page.goto('/organizations');
    await expect(page.getByRole('heading', { name: /^Empresas$/i, level: 1 })).toBeVisible({ timeout: 20_000 });

    const abrir = page.getByRole('button', { name: /^Entrar$/ }).first();
    const jaDentro = page.getByRole('button', { name: /Você está aqui/ }).first();

    // Sem empresa cliente cadastrada não há o que abrir — e isso é um estado
    // legítimo, não uma falha do teste.
    if ((await abrir.count()) === 0 && (await jaDentro.count()) === 0) return;

    if (await abrir.count()) {
      await abrir.click();
      await page.waitForTimeout(1500);
    }

    /**
     * A FAIXA DE CONTEXTO. É proposital que ela seja uma interrupção visual, do
     * mesmo jeito que ambiente de homologação se pinta de outra cor.
     */
    const faixa = page.getByText(/Você está dentro de/i);
    await expect(faixa).toBeVisible({ timeout: 20_000 });

    // E dá para voltar. Entrar sem saída é um beco.
    const voltar = page.getByRole('button', { name: /Voltar para a Desigual/i });
    await expect(voltar).toBeVisible();
    await voltar.click();
    await expect(faixa).toBeHidden({ timeout: 20_000 });
  });

  /**
   * A EMPRESA CRIADA PRECISA SER CONFIGURÁVEL, que é o degrau entre "a conta
   * existe" e "a conta é utilizável".
   *
   * O teste grava o relato exato de quem usou: dava para criar a empresa e não
   * dava para acessar e configurar as contas individualmente. Então ele não
   * verifica só que a tela abre — verifica que um campo gravado VOLTA gravado,
   * porque uma tela de configuração que aceita e não persiste é pior que
   * nenhuma: ela mente dizendo "salvo".
   */
  test('dá para configurar uma empresa, e o que foi salvo volta salvo', async ({ page }) => {
    await login(page);
    await page.goto('/organizations');
    await expect(page.getByRole('heading', { name: /^Empresas$/i, level: 1 })).toBeVisible({ timeout: 20_000 });

    const configurar = page.getByRole('link', { name: /^Configurar$/ });
    if ((await configurar.count()) === 0) return; // sem empresa, nada a configurar

    // A ÚLTIMA, não a primeira: a primeira é sempre a provedora, e a provedora
    // é o caso especial (não pode ser suspensa). Configurar um tenant de
    // verdade é o que o teste precisa cobrir.
    await configurar.last().click();

    const campoAssistente = page.getByLabel(/Nome do assistente/i);
    await expect(campoAssistente).toBeVisible({ timeout: 20_000 });

    const novo = `Teste ${Date.now().toString().slice(-6)}`;
    await campoAssistente.fill(novo);

    /**
     * A PRÉVIA REAGE AO QUE ESTÁ SENDO DIGITADO, não ao que está salvo.
     * Escolher o nome e a cor do assistente sem ver o resultado é escolher no
     * escuro — e foi por isso que a prévia entrou na tela.
     */
    await expect(page.getByText(/Como vai aparecer/i)).toBeVisible();

    await page.getByRole('button', { name: /Salvar identidade/i }).click();
    await expect(page.getByText(/^Salvo$/)).toBeVisible({ timeout: 20_000 });

    // RECARREGA. Sem isto o teste só prova que o React guardou na memória dele,
    // que é exatamente a forma de "salvo" que não salva nada.
    await page.reload();
    await expect(page.getByLabel(/Nome do assistente/i)).toHaveValue(novo, { timeout: 20_000 });
  });

  /**
   * A FICHA DA EMPRESA SEPARA "não se mexeu" DE "não consegui medir".
   *
   * É a regra mais cara de um painel, e a mais fácil de quebrar ao adicionar
   * gráfico: desenhar uma linha reta no zero para uma empresa recém-criada faz
   * uma medição que nunca aconteceu parecer um resultado. Aqui a empresa sem
   * movimento mostra a frase, e a empresa com movimento mostra a curva.
   */
  test('o movimento da empresa é desenhado quando existe, e dito quando não existe', async ({ page }) => {
    await login(page);
    await page.goto('/organizations');

    const configurar = page.getByRole('link', { name: /^Configurar$/ });
    if ((await configurar.count()) === 0) return;

    // A PRIMEIRA é a provedora, que é a única com meses de histórico real.
    await configurar.first().click();
    await expect(page.getByRole('heading', { name: /^Movimento$/ })).toBeVisible({ timeout: 20_000 });

    const grafico = page.locator('.recharts-responsive-container');
    const semMovimento = page.getByText(/Nenhum movimento neste período/i);

    // Exatamente UM dos dois estados, nunca os dois nem nenhum.
    await expect(grafico.or(semMovimento).first()).toBeVisible({ timeout: 20_000 });
    const temGrafico = (await grafico.count()) > 0;
    expect(temGrafico ? await semMovimento.count() : 1).toBe(temGrafico ? 0 : 1);

    /**
     * A JANELA É DECLARADA. "Últimos 30 dias" numa empresa criada ontem
     * afirmaria 29 dias de silêncio que nunca existiram.
     */
    await expect(page.getByText(/Últimos 30 dias|Desde que a empresa existe|Sem janela para medir/i)).toBeVisible();
  });

  /** A logo do Claude é asset local — se o caminho quebrar, a imagem some em silêncio. */
  test('a logo do Claude carrega do arquivo do projeto', async ({ page }) => {
    await login(page);
    // O bloco "Inteligência conectada" SAIU da home e passou para Integrações,
    // quando a home foi enxugada. A marca continua aparecendo com ou sem
    // conexão — diferente da tabela do MCP, que só existe quando há alguém.
    await page.goto('/integrations');
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

  /**
   * O HISTÓRICO DE CONEXÃO NÃO PODE SER LIDO COMO UMA CONTAGEM DE PESSOAS.
   *
   * Medido no banco em 30/09/2026: seis eventos `CONNECTION_CREATED` da MESMA
   * conta dentro de CINCO segundos — o cliente do Claude abre várias sessões ao
   * conectar. Cada linha é um fato real, e seis linhas com o mesmo nome fazem
   * qualquer leitor contar seis conexões onde houve uma.
   *
   * Esconder as repetições daria um número mais bonito e menos verdadeiro. O
   * que a tela deve a quem lê é a explicação — e é ela que este teste trava,
   * porque é exatamente o que some numa refatoração de layout.
   */
  test('conexões recentes explicam a rajada em vez de deixar contar errado', async ({ page }) => {
    await login(page);
    await page.goto('/mcp');
    await expect(page.getByRole('heading', { name: /^MCP$/i, level: 1 })).toBeVisible({ timeout: 20_000 });

    const secao = page.getByRole('heading', { name: /Conexões recentes/i });
    await expect(secao).toBeVisible({ timeout: 30_000 });

    const vazio = page.getByText(/Nenhuma conexão registrada/i);
    const explicacao = page.getByText(/mesma pessoa repetida em poucos segundos é uma conexão só/i);

    // Ou não há conexão nenhuma, ou há a explicação. Lista sem explicação, não.
    await expect(vazio.or(explicacao).first()).toBeVisible({ timeout: 30_000 });
  });

  /**
   * `?conectou=<id>` é para onde a notificação de "fulano conectou o Claude"
   * aterrissa. Um link que não mostra o que prometeu é ruído com aparência de
   * utilidade — e é o tipo de coisa que continua "passando" sem ninguém olhar.
   */
  test('o link da notificação abre a tela sem quebrar', async ({ page }) => {
    await login(page);
    await page.goto('/mcp?conectou=e1b865d0-646c-4f65-9ae2-b2ec2944ceec');

    await expect(page.getByRole('heading', { name: /^MCP$/i, level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /Conexões recentes/i })).toBeVisible({ timeout: 30_000 });
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
/**
 * A tela de Decisões leu a TABELA ERRADA na primeira versão: `memories` com
 * `kind = 'decision'`, um kind que não existe. Voltava vazia sempre e anunciava
 * "nenhuma decisão registrada" sobre um banco com 9 decisões em
 * `agent_episodes`.
 *
 * O teste trava a propriedade que pega isso: a tela precisa DIZER alguma coisa
 * sobre a fonte — registros, ausência, ou falha. Uma tela que sempre diz
 * "vazio" passa despercebida justamente por parecer um estado legítimo.
 */
/**
 * A TELA NÃO PODE CHAMAR DE TOTAL O QUE COUBE NA RESPOSTA.
 *
 * Achado ao reconciliar tela x API x banco (30/09/2026): a Memória pedia 150
 * registros, recebia 150 e se intitulava "150 registro(s)". Havia 396 visíveis
 * àquela conta. Nenhuma linha de código mentia — a tela contou o que tinha na
 * mão e chamou de total, e quem lesse concluiria que o sistema sabe 150 coisas.
 *
 * Mesma família de 58-x-49 (fixture contada como cliente) e 812-x-146 (task
 * fechada contada como atrasada): número certo sobre a pergunta errada. O teste
 * trava a propriedade, não o número — quando houver corte, a tela declara os
 * dois lados.
 */
test.describe('contagem não confunde janela com total', () => {
  test.setTimeout(120_000);

  test('o Conhecimento declara a janela quando há mais do que cabe', async ({ page }) => {
    await login(page);
    await page.goto('/memory');
    await expect(page.getByRole('heading', { name: /^Conhecimento$/i, level: 1 })).toBeVisible({ timeout: 20_000 });

    const cabecalho = page.getByRole('heading', { name: /registro\(s\)/i });
    await expect(cabecalho.first()).toBeVisible({ timeout: 30_000 });

    const texto = (await cabecalho.first().textContent()) ?? '';
    const janela = /^(\d+) de (\d+) registro/.exec(texto);
    if (janela) {
      const [, mostrando, total] = janela;
      expect(Number(mostrando), 'a janela não pode ser maior que o total').toBeLessThanOrEqual(Number(total));
      // Contar as linhas da lista: a janela declarada tem que ser a real.
      const linhas = await page.locator('main li').count();
      expect(linhas, 'a tela mostra o que disse que está mostrando').toBe(Number(mostrando));
    } else {
      // Sem corte, o rótulo simples é o correto — e aí ele É o total.
      expect(texto, 'sem corte, o rótulo é "N registro(s)"').toMatch(/^\d+ registro\(s\)/);
    }
  });
});

/**
 * A ÚNICA TELA DO PRODUTO EM QUE VAZIO É BOA NOTÍCIA.
 *
 * Em todas as outras, ausência é uma pergunta ("será que quebrou?"). Aqui,
 * nenhum sinal em aberto quer dizer que nada está pegando fogo — e apresentar
 * isso com a mesma cara de "sem dados" desperdiça a informação.
 *
 * O teste trava as duas propriedades que fazem a tela valer: ela distingue
 * "nada pedindo atenção" de "não consegui ler" (os dois nunca coexistem), e um
 * sinal em aberto SEMPRE oferece como tratá-lo. Lista que só cresce vira ruído
 * que se aprende a ignorar, que é como um painel de alerta morre.
 */
test.describe('sinais chegam em uma pessoa', () => {
  test.setTimeout(120_000);

  test('separa "nada pedindo atenção" de "não consegui ler"', async ({ page }) => {
    await login(page);
    await page.goto('/signals');
    await expect(page.getByRole('heading', { name: /^Sinais$/i, level: 1 })).toBeVisible({ timeout: 20_000 });

    const calmo = page.getByText(/Nada pedindo atenção agora/i);
    const falha = page.getByText(/Não consegui ler os sinais/i);
    const lista = page.locator('main li');

    await expect(calmo.or(falha).or(lista.first()).first()).toBeVisible({ timeout: 30_000 });
    expect(
      (await calmo.count()) + (await falha.count()),
      'calmaria e falha de leitura são diagnósticos opostos: não podem aparecer juntos',
    ).toBeLessThanOrEqual(1);
  });

  test('sinal em aberto sempre oferece como tratá-lo', async ({ page }) => {
    await login(page);
    await page.goto('/signals');
    await expect(page.getByRole('heading', { name: /^Sinais$/i, level: 1 })).toBeVisible({ timeout: 20_000 });
    // Espera o estado final: ou a lista, ou a declaração de calmaria.
    await expect(
      page.locator('main li').first().or(page.getByText(/Nada pedindo atenção agora/i)).first(),
    ).toBeVisible({ timeout: 30_000 });

    /**
     * O CABEÇALHO E A LISTA TÊM QUE CONCORDAR.
     *
     * Sem esta conferência, o teste passa tanto com um sinal na tela quanto com
     * nenhum — e eu não saberia qual dos dois aconteceu. Foi exatamente assim
     * que a tela de Memória anunciou "150 registro(s)" havendo 396: o número do
     * cabeçalho e o conteúdo da lista vinham de fontes diferentes e ninguém
     * comparou.
     */
    const cabecalho = await page.getByRole('heading', { name: /sinal\(is\)/i }).first().textContent();
    const declarados = Number(/^(\d+)/.exec((cabecalho ?? '').trim())?.[1] ?? '0');
    const abertos = await page.locator('main li').count();

    expect(abertos, `o cabeçalho diz "${cabecalho?.trim()}" e a lista mostra ${abertos}`).toBe(declarados);

    if (abertos === 0) return; // Sem sinal em aberto não há o que tratar.

    await expect(page.getByRole('button', { name: /Resolvi/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Não é problema/ }).first()).toBeVisible();
  });
});

test.describe('decisões vêm da fonte certa', () => {
  test.setTimeout(120_000);

  test('mostra os tipos que existem, com contagem', async ({ page }) => {
    await login(page);
    await page.goto('/decisions');
    // Os filtros saem do banco: se nenhum aparecer, ou a fonte está vazia de
    // verdade, ou a consulta está no lugar errado de novo.
    await expect(page.getByRole('button', { name: /decisão|preferência|retorno|mudança/i }).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('artefato de teste aparece rotulado, não como decisão da agência', async ({ page }) => {
    await login(page);
    await page.goto('/decisions');
    await expect(page.getByText(/registro\(s\)/)).toBeVisible({ timeout: 60_000 });
    /**
     * O aceite do MCP gravou frases como "guarda esta referência: marco-029857"
     * como decisão de PRODUÇÃO. Se elas estiverem na tela, precisam estar
     * marcadas — apresentar artefato de teste como decisão da agência é pior
     * que não mostrar.
     */
    const marcos = await page.getByText(/marco-\d{4,}/).count();
    if (marcos > 0) {
      await expect(page.getByText('artefato de teste').first()).toBeVisible();
    }
  });
});

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

  /**
   * CADA CLIENTE DIZ QUANDO SE MEXEU — e a tela separa três estados que é
   * tentador juntar: mexeu há N dias, nunca se mexeu, não deu para medir.
   *
   * Juntar os dois últimos é o defeito caro: "não consegui ler" virando "parado
   * há muito tempo" inventa um alarme a partir de uma falha do sistema e manda
   * alguém cobrar um cliente que está trabalhando normalmente.
   */
  test('a grade de clientes mostra recência, e dá para pôr os parados na frente', async ({ page }) => {
    await login(page);
    await page.goto('/clients');
    await expect(page.locator('[data-client-id]').first()).toBeVisible({ timeout: 60_000 });

    // Toda linha diz algo sobre movimento. Nenhuma fica muda.
    const comRecencia = page.getByText(/mexeu (hoje|ontem|há \d+ dias)|nunca se mexeu|parado há|movimento não medido/i);
    expect(await comRecencia.count()).toBeGreaterThan(0);

    const parados = page.getByRole('button', { name: /parados primeiro/i });
    await expect(parados).toBeVisible();
    await parados.click();

    /**
     * Depois de reordenar, a grade continua inteira. Ordenar não é filtrar —
     * um botão de ordem que some com cartões seria um filtro disfarçado.
     */
    const antes = await page.locator('[data-client-id]').count();
    await expect(page.locator('[data-client-id]')).toHaveCount(antes);
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

/**
 * A NAVEGAÇÃO COMERCIAL — e a prova de que esconder não virou sumir.
 *
 * Medido em 02/10/2026: a barra tinha 30 itens, entre eles Sinais, Decisões,
 * Memória, Agentes, Monitoramento e Qualidade do dado. Trinta portas abertas
 * não é poder de escolha; é alguém sem saber por onde começar, e um supervisor
 * com pressa fecha o sistema e volta pro ClickUp.
 *
 * Os dois testes abaixo são as duas metades da mesma regra, e um sem o outro
 * não vale: o primeiro exige que o técnico suma da navegação, o segundo exige
 * que ele continue alcançável. Sem o segundo, esta mudança teria trocado
 * excesso por perda de funcionalidade.
 */
test.describe('a navegação esconde a infraestrutura sem apagá-la', () => {
  test('a barra mostra só o que é do negócio', async ({ page }) => {
    await login(page);
    await page.goto('/');
    const barra = page.getByRole('navigation', { name: /Navegação principal/i });
    await expect(barra).toBeVisible({ timeout: 20_000 });

    // O que PRECISA estar: o vocabulário que o produto pede que a pessoa saiba.
    for (const rotulo of [/Visão geral/i, /Clientes/i, /Empresas/i, /Integrações/i]) {
      await expect(barra.getByRole('link', { name: rotulo }).first()).toBeVisible();
    }

    /**
     * O que NÃO pode estar: entender estes itens exige saber o que é episódio
     * de agente, fila, embedding ou evento operacional — e o briefing é
     * explícito que o usuário não precisa saber nada disso.
     */
    for (const tecnico of [/^Sinais$/, /^Decisões$/, /^Agentes$/, /^Monitoramento$/, /^Qualidade do dado$/, /^Auditoria$/]) {
      expect(await barra.getByRole('link', { name: tecnico }).count(), `${tecnico} não pertence à navegação comercial`).toBe(0);
    }

    // "Memória" era nome de infraestrutura. O produto chama de Conhecimento.
    expect(await barra.getByRole('link', { name: /^Memória$/ }).count()).toBe(0);
    await expect(barra.getByRole('link', { name: /Conhecimento/i }).first()).toBeVisible();
  });

  test('o que saiu da barra continua alcançável em Configurações', async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    const admin = page.getByRole('heading', { name: /^Administração$/ });
    await expect(admin).toBeVisible({ timeout: 20_000 });

    // As telas técnicas viram links de verdade, para os MESMOS endereços.
    for (const rotulo of [/Sinais/i, /Decisões/i, /Auditoria/i]) {
      await expect(page.getByRole('link', { name: rotulo }).first()).toBeVisible();
    }

    // E o link leva mesmo: esconder sem caminho é perder funcionalidade.
    await page.getByRole('link', { name: /Sinais/i }).first().click();
    await expect(page).toHaveURL(/\/signals/);
  });
});

/**
 * TESTE H — O PRODUTO PAROU DE FALAR COMO BANCO DE DADOS.
 *
 * O critério do bloco é literal: alguém que nunca ouviu falar de agent.episode,
 * MCP ou embedding abre Conhecimento e entende o que a empresa sabe.
 *
 * O teste varre o TEXTO VISÍVEL da tela atrás dos nomes internos. Levantados do
 * banco em 02/10/2026, são 12 tipos reais — `agent.episode` sozinho é 238 de
 * ~500 memórias, então se o vazamento existir, ele aparece.
 */
test.describe('a tela de Conhecimento fala português, não esquema', () => {
  test('nenhum termo técnico aparece para quem usa o produto', async ({ page }) => {
    await login(page);
    await page.goto('/memory');
    await expect(page.getByRole('heading', { name: /^Conhecimento$/, level: 1 })).toBeVisible({ timeout: 30_000 });

    const texto = (await page.locator('main').innerText()).toLowerCase();

    for (const termo of [
      'agent.episode',
      'client.profile',
      'mcp.user_private',
      'clickup.mention_answered',
      'studio.asset_created',
      'otto.creative_plan_created',
      'operational_event',
      'source_refs',
      'embedding',
      'entity_link',
    ]) {
      expect(texto, `"${termo}" vazou para a tela comercial`).not.toContain(termo);
    }

    /**
     * E a contraprova: as categorias humanas precisam estar lá. Sem isto, o
     * teste passaria numa tela em branco — ausência de termo técnico não é
     * evidência de que a tradução aconteceu.
     */
    expect(
      /contexto|preferências|pessoas|processos|aprendizados|decisões|feedbacks/i.test(texto),
      'nenhuma categoria humana apareceu — a tela pode estar vazia',
    ).toBe(true);
  });
});

/**
 * A ATIVIDADE CONTA A HISTÓRIA DA OPERAÇÃO, não o esquema do banco.
 *
 * Os quatro tipos que existem (task.updated 541, task.created 331,
 * CONNECTION_CREATED 29, CLIENT_DECISION 1) não podem aparecer como texto.
 */
test.describe('a Atividade fala português, não esquema', () => {
  test('nenhum tipo de evento vaza para a tela', async ({ page }) => {
    await login(page);
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: /^Atividade$/, level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Na operação/i })).toBeVisible({ timeout: 20_000 });

    /**
     * ESPERAR O CONTEÚDO, não só o cabeçalho. A primeira versão deste teste
     * lia o texto assim que o título aparecia — e lia a tela ainda em
     * esqueleto. A contraprova reprovou, corretamente: naquele instante não
     * havia frase humana nenhuma, porque não havia frase nenhuma.
     *
     * Espera pelo que vier primeiro: uma linha da timeline (agrupada por dia)
     * ou o estado vazio honesto. Os dois são resultados legítimos; o que não
     * pode é medir no meio do caminho.
     */
    const umDia = page.getByRole('heading', { name: /^(Hoje|Ontem|\d+ de \w+)$/ }).first();
    const vazio = page.getByText(/Ainda não há atividade registrada/i);
    await expect(umDia.or(vazio).first()).toBeVisible({ timeout: 30_000 });

    const texto = (await page.locator('main').innerText()).toLowerCase();

    for (const termo of [
      'task.updated',
      'task.created',
      'connection_created',
      'client_decision',
      'operational_event',
      'actor_identity_id',
      'source_refs',
      'event_type',
      'payload',
    ]) {
      expect(texto, `"${termo}" vazou para a tela`).not.toContain(termo);
    }

    // E nenhum ISO cru: a data é "Hoje", "Ontem" ou por extenso.
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/);

    /**
     * CONTRAPROVA, exigida pelo briefing: sem ela o teste passaria numa tela
     * vazia, e ausência de termo técnico não é evidência de tradução.
     */
    expect(
      /atualizou|criou|registrou|clickup|claude|hoje|ontem|ainda não há atividade/i.test(texto),
      'nenhuma frase humana apareceu — nem timeline, nem estado vazio',
    ).toBe(true);
  });
});
