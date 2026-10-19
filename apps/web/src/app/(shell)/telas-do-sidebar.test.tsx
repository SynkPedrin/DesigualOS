import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import { ThemeProvider } from '@/app/theme-provider';

/**
 * TODA TELA DO SIDEBAR PRECISA ABRIR SEM QUEBRAR.
 *
 * Este arquivo nasceu de dois defeitos reais encontrados em 08/10/2026 na tela
 * de Integrações, ambos invisíveis em typecheck e em lint:
 *
 *     historico?.consentimentos[0]     // o ?. protege `historico`, não a lista
 *     data?.providers.find(...)        // idem
 *
 * Quando a resposta chega sem aquele campo, o erro estoura DENTRO do render.
 * E como os dois componentes eram filhos da página, levavam a VITRINE INTEIRA
 * junto — todos os cartões sumiam. O relato que chegou foi "integração nenhuma
 * abre"; a causa era a tela nem chegar a existir.
 *
 * O que este teste faz é simples e é o que faltava: monta cada tela do sidebar
 * com respostas de API MÍNIMAS — objetos vazios, listas vazias, `null` — que é
 * o estado de qualquer colaborador no primeiro dia, e exige que ela renderize.
 * Tela que só funciona com dado cheio não está pronta para operação.
 *
 * A lista de telas é lida de NAV_ITEMS, não escrita à mão: item novo na barra
 * entra na cobertura sozinho.
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
  API_FETCH_DEFAULT_TIMEOUT_MS: 30_000,
  setAccessTokenProvider: vi.fn(),
  setAccessTokenAsyncProvider: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'cliente-1' }),
}));

vi.mock('next/image', () => ({ default: ({ alt }: { alt?: string }) => <span data-img={alt ?? ''} /> }));

vi.mock('@/lib/realtime/ws-client', () => ({
  realtimeClient: { subscribe: () => () => undefined, connect: vi.fn(), disconnect: vi.fn() },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => undefined;
window.matchMedia = ((q: string) => ({
  matches: false, media: q, onchange: null,
  addEventListener: () => undefined, removeEventListener: () => undefined,
  addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

/**
 * A RESPOSTA MAIS POBRE QUE A API PODE DAR, de propósito.
 *
 * Objeto vazio com listas vazias nos nomes mais usados. Se uma tela quebra
 * aqui, ela quebra para quem acabou de ser convidado — que é exatamente quem
 * vai receber o sistema agora.
 */
const VAZIO: Record<string, unknown> = {
  clients: [], tasks: [], demands: [], threads: [], events: [], items: [], rows: [], data: [],
  memories: [], members: [], users: [], collaborators: [], conversations: [], messages: [],
  executions: [], nodes: [], servers: [], pessoas: [], conexoes_recentes: [], por_ferramenta: [],
  providers: [], consentimentos: [], fontes: [], nao_faz: [], destinos: [], connectors: [],
  approvals: [], tool_calls: [], signals: [], decisions: [], errors: [], automations: [],
  workflows: [], templates: [], modules: [], assets: [], jobs: [], projects: [], reports: [],
  notifications: [], agents: [], sources: [], documents: [], contacts: [], stages: [], cards: [],
  connected: false, configured: true, clickup_synced: false, pessoas_conectadas: 0, total: 0,
};

async function assentar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Telas que precisam de contexto que este harness não dá (rota dinâmica, canvas). */
const FORA = new Set(['/studio']);

const ROTAS = [...new Set(NAV_ITEMS.map((i) => i.href.split('?')[0]!))]
  .filter((href) => !FORA.has(href))
  .sort();

function caminhoDoModulo(href: string): string {
  return href === '/' ? './page' : `./${href.replace(/^\//, '')}/page`;
}

beforeEach(() => {
  apiFetchMock.mockImplementation(async () => ({ ...VAZIO }));
});

afterEach(() => {
  document.body.innerHTML = '';
  apiFetchMock.mockReset();
  vi.clearAllMocks();
});

describe('toda tela do sidebar renderiza com a API vazia', () => {
  /**
   * Teto generoso de propósito: estas telas montam a árvore inteira, e
   * algumas (Analytics, Visão geral) desenham gráficos. Rodando junto com os
   * outros pacotes no `turbo run test`, a máquina fica disputada e o default
   * de 5s estourava em Analytics — falha de relógio, não de código. Teste que
   * acusa quebra onde não há ensina a ignorar o teste.
   */
  it.each(ROTAS)('%s', { timeout: 30_000 }, async (href) => {
    const mod = (await import(caminhoDoModulo(href))) as { default: React.ComponentType };
    const Tela = mod.default;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const erros: unknown[] = [];
    const erroOriginal = console.error;
    console.error = (...args: unknown[]) => {
      const texto = String(args[0] ?? '');
      /**
       * O que conta como QUEBRA aqui é erro de render. Fica de fora:
       *  · avisos de act()/key — ruído de ambiente de teste;
       *  · "Query data cannot be undefined" — isto é o React Query reclamando
       *    do MEU mock, não da tela. Quando acontece de verdade, a consulta
       *    entra em estado de erro e a página mostra o próprio aviso; ela não
       *    some. Tratar como quebra esconderia as quebras de verdade no meio
       *    de ruído do harness.
       */
      const ruidoDoHarness =
        texto.includes('not wrapped in act') ||
        texto.includes('unique "key"') ||
        texto.includes('Query data cannot be undefined');
      if (!ruidoDoHarness) erros.push(args[0]);
    };

    try {
      await act(async () => {
        root.render(
          // ThemeProvider porque Configurações usa `useTheme` — no app ele
          // envolve a árvore inteira, então exigi-lo aqui é reproduzir o real.
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ThemeProvider>
              <Tela />
            </ThemeProvider>
          </QueryClientProvider>,
        );
      });
      await assentar();
    } finally {
      console.error = erroOriginal;
    }

    // A tela existe no DOM e não estourou durante o render.
    expect(erros, `${href} registrou erro de render: ${String(erros[0] ?? '')}`).toHaveLength(0);
    expect(container.textContent?.length ?? 0, `${href} renderizou vazia`).toBeGreaterThan(0);
  });
});
