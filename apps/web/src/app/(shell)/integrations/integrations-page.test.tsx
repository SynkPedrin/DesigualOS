import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/app/theme-provider';

/**
 * TODO CARTÃO DA VITRINE PRECISA ABRIR O PAINEL DELE.
 *
 * O relato do Pedro (08/10/2026) foi "integração nenhuma vai pras telas de
 * conexão". O defeito original era estrutural: os cartões apontavam para uma
 * ÂNCORA (`href: '#conectar'`) e o painel era um bloco solto no fim da página.
 * Cartão cujo bloco ninguém lembrou de criar — Meta Ads, Google Ads, Microsoft
 * Calendar — rolava a tela para lugar nenhum. Clicar "funcionava" e não
 * acontecia nada, que é a pior forma de quebrar: sem erro, sem pista.
 *
 * A correção fez o painel virar PROPRIEDADE do cartão (`painel: ReactNode`),
 * então o tipo já impede cartão sem destino. Este teste é o que impede a
 * regressão do COMPORTAMENTO: monta a página de verdade e clica em cada
 * cartão, um por um, exigindo que um diálogo abra com o nome daquela
 * integração. Se alguém acrescentar um cartão novo, ele entra aqui sozinho —
 * a lista é lida da própria tela, não escrita à mão.
 */

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  apiFetch: apiFetchMock,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(message: string, public readonly status: number) {
      super(message);
    }
  },
  API_FETCH_UPLOAD_TIMEOUT_MS: 120_000,
}));

vi.mock('@/hooks/use-me', () => ({
  useMe: () => ({ data: { id: 'u1', name: 'Pedro', organizacao_ativa: { id: 'org-1', name: 'Desigual' } } }),
}));

/** next/image não roda em jsdom com `fill`; o logo não é o que está sob teste. */
vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => <span data-logo={alt ?? ''} />,
}));

/**
 * O jsdom não implementa `matchMedia`, e o ThemeProvider pergunta ao sistema
 * se a preferência é escura. Sem este stub o teste morre antes de renderizar
 * qualquer coisa — e a falha não diria nada sobre a tela de Integrações.
 *
 * Responde "não prefere escuro" de propósito: o produto já trata o claro como
 * caminho possível, então o teste exercita o caso menos óbvio.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((consulta: string) => ({
    matches: false,
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: IntegrationsPage } = await import('./page');

/**
 * Monta a página e ESPERA as consultas de status resolverem.
 *
 * Sem a espera, o painel do Notion abria mostrando o esqueleto de
 * carregamento — que não tem texto — e o teste acusava "painel vazio" num
 * painel perfeitamente saudável. O que interessa aqui é o estado que a pessoa
 * de fato vê depois do carregamento, não o quadro intermediário.
 */
async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      /**
       * O ThemeProvider entrou aqui quando a tela passou a usar o `PageHeader`
       * com banner (09/10/2026): o banner lê a marca pelo tema, e sem o
       * provedor ele lança "useTheme must be used within ThemeProvider".
       *
       * Envolver o teste é o conserto certo, e não afrouxar o `useTheme`: o
       * lançamento existe pra impedir que um componente de marca renderize com
       * marca nenhuma, e a aplicação de verdade sempre tem o provedor. Um teste
       * que monta a tela com menos contexto do que o produto dá testa uma tela
       * que não existe.
       *
       * A ORDEM IMPORTA: o QueryClientProvider vem POR FORA. O ThemeProvider
       * consulta a marca da organização, então invertido ele quebra com "No
       * QueryClient set" — que é o mesmo aninhamento que o AppShell usa.
       */
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <IntegrationsPage />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  await assentar();
  return container;
}

/**
 * Espera a tela ASSENTAR. Um `Promise.resolve()` só não basta: o React Query
 * resolve a consulta num tick e re-renderiza no seguinte, e um painel que
 * dispara consulta própria ao abrir precisa de mais uma rodada. Esperar de
 * menos faz o teste ler o esqueleto de carregamento e acusar "painel vazio"
 * num painel saudável — aconteceu duas vezes escrevendo este arquivo.
 */
async function assentar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Os cartões da vitrine: botão que anuncia "Configurar →". */
function cartoes(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) => b.textContent?.includes('Configurar')) as HTMLButtonElement[];
}

function nomeDoCartao(cartao: HTMLButtonElement): string {
  return cartao.querySelector('p.font-heading')?.textContent?.trim() ?? '(sem nome)';
}

beforeEach(() => {
  /**
   * Resposta POR ENDPOINT, não uma só para tudo.
   *
   * Um mock único devolvendo o mesmo objeto para toda rota escondia um defeito
   * de verdade: `Consentimento` lia `historico.consentimentos[0]` sem proteger
   * o campo, e um corpo sem a lista derrubava a VITRINE INTEIRA — era o
   * "nenhuma integração abre" relatado. O mock agora imita a API de verdade,
   * e o componente foi endurecido.
   *
   * Todas respondem "não conectado" de propósito: é justamente nesse estado
   * que a pessoa precisa conseguir abrir o painel para conectar.
   */
  apiFetchMock.mockImplementation(async (rota: string) => {
    // Duas rotas distintas, com formas distintas — exatamente como a API:
    // `/consent/fontes` é o catálogo, `/consent` é o histórico.
    if (rota.startsWith('/consent/fontes')) {
      return { fontes: [{ id: 'clickup', nome: 'ClickUp', permite: ['ler tarefas'] }], nao_faz: ['não apaga nada'] };
    }
    if (rota.startsWith('/consent')) return { consentimentos: [] };
    if (rota.startsWith('/mcp')) return { servers: [], pessoas_conectadas: 0 };
    if (rota.startsWith('/motion/providers')) return { providers: [] };
    // Bento no WhatsApp: canal ligado, número desta pessoa ainda não vinculado.
    if (rota.startsWith('/bento-whatsapp/me')) return { enabled: true, bot_phone: '+55 18 99798-7295', link: null, pending_code: null };
    // Conectores da empresa (WhatsApp) — lista vazia é o estado "não vinculado".
    if (rota.includes('/whatsapp')) return { status: 'nao_vinculado', configured: false, connected: false };
    if (rota.includes('/connectors')) return { connectors: [] };
    return { connected: false, configured: true, destinos: [] };
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  apiFetchMock.mockReset();
});

describe('vitrine de Integrações', () => {
  it('mostra os cartões das integrações que o produto tem', async () => {
    const nomes = cartoes(await montar()).map(nomeDoCartao);

    expect(nomes).toEqual(
      expect.arrayContaining(['ClickUp', 'Notion', 'WhatsApp', 'Meta Ads', 'Google Ads', 'Microsoft Calendar', 'Bento no WhatsApp']),
    );
  });

  /** O teste que o relato do Pedro pede: clicar leva a ALGUM lugar, sempre. */
  it('cada cartão abre o painel de conexão dele, nenhum cai no vazio', async () => {
    const container = await montar();
    const total = cartoes(container).length;
    expect(total).toBeGreaterThan(0);

    for (let i = 0; i < total; i += 1) {
      const cartao = cartoes(container)[i]!;
      const nome = nomeDoCartao(cartao);

      // O painel só monta ao abrir, então as consultas DELE começam agora —
      // sem este segundo flush o teste leria o esqueleto de carregamento e
      // acusaria "painel vazio" num painel que está só chegando.
      await act(async () => {
        cartao.click();
      });
      await assentar();

      const dialogo = container.querySelector('[role="dialog"]');
      expect(dialogo, `o cartão "${nome}" não abriu painel nenhum`).not.toBeNull();
      expect(dialogo?.getAttribute('aria-label'), `o painel aberto não é o de "${nome}"`).toBe(nome);
      // E o painel tem conteúdo, não é uma caixa vazia com título.
      const corpo = (dialogo?.textContent ?? '').replace(nome, '').replace('Fechar', '').trim();
      expect(corpo.length, `o painel de "${nome}" abriu VAZIO, só o título, sem nada pra conectar`).toBeGreaterThan(0);

      await act(async () => {
        (container.querySelector('[role="dialog"] button[aria-label="Fechar"]') as HTMLButtonElement).click();
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    }
  });

  it('a busca filtra a vitrine e o cartão filtrado continua abrindo', async () => {
    const container = await montar();
    const campo = container.querySelector('input[type="search"], input') as HTMLInputElement;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(campo, 'meta');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const nomes = cartoes(container).map(nomeDoCartao);
    expect(nomes).toContain('Meta Ads');
    expect(nomes).not.toContain('Notion');

    await act(async () => {
      cartoes(container)[0]!.click();
    });
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Meta Ads');
  });
});
