import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A BOLHA APARECE — e some onde não deve.
 *
 * Esta suíte existe por uma razão específica: o botão flutuante é a única peça
 * da interface que não tem rota. Não há endereço para digitar nem item de menu
 * para clicar; se ele deixar de renderizar, nada no produto denuncia a falta,
 * e a feature simplesmente não existe para quem usa — foi exatamente assim que
 * a primeira versão pareceu não ter sido implementada (07/10/2026).
 *
 * Os três gates que decidem a presença dela estão aqui: a rota (em /chat ela
 * seria uma segunda caixa de texto para o mesmo agente), o Studio aberto (um
 * overlay de tela cheia) e o módulo `bento` do workspace — o MESMO gate que a
 * barra lateral aplica, porque um botão flutuante por cima de tudo não pode
 * ser a segunda porta sem a regra da primeira.
 */

const pathnameMock = vi.hoisted(() => vi.fn(() => '/people'));
const meMock = vi.hoisted(() => vi.fn(() => ({ data: { id: 'u1', name: 'Pedro' } })));
const isMasterMock = vi.hoisted(() => vi.fn(() => ({ isMaster: false, isPending: false })));
const workspaceMock = vi.hoisted(() => vi.fn(() => ({ data: { modules: ['bento'] } })));
const studioAbertoMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock() }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => meMock() }));
vi.mock('@/hooks/use-is-master', () => ({ useIsMaster: () => isMasterMock() }));
vi.mock('@/hooks/use-my-workspace', () => ({ useMyWorkspace: () => workspaceMock() }));
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (seletor: (estado: { studioModalOpen: boolean }) => unknown) =>
    seletor({ studioModalOpen: studioAbertoMock() }),
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn().mockResolvedValue({ messages: [] }) }));
vi.mock('@/lib/realtime/ws-client', () => ({ realtimeClient: { subscribe: () => () => undefined } }));

const { BentoBolha } = await import('./bento-bolha');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom não implementa `scrollIntoView` — e o painel rola para a última
 *  mensagem ao montar. Falta do ambiente de teste, não do componente. */
Element.prototype.scrollIntoView = () => undefined;

function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BentoBolha />
      </QueryClientProvider>,
    );
  });
  return container;
}

/** O botão é identificado pelo rótulo acessível, não por classe: se o nome
 *  mudar, o teste falha por uma razão real (ninguém mais acha o botão). */
function botaoDaBolha(container: HTMLElement) {
  return container.querySelector('button[aria-label="Conversar com o Bento"]');
}

beforeEach(() => {
  pathnameMock.mockReturnValue('/people');
  isMasterMock.mockReturnValue({ isMaster: false, isPending: false });
  workspaceMock.mockReturnValue({ data: { modules: ['bento'] } });
  studioAbertoMock.mockReturnValue(false);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('o botão flutuante', () => {
  it('aparece numa tela comum, com a marca do OS', () => {
    const container = montar();
    const botao = botaoDaBolha(container);
    expect(botao).not.toBeNull();
    expect(botao?.querySelector('img')?.getAttribute('src')).toContain('os-mark');
  });

  it('abre o painel de conversa no clique', () => {
    const container = montar();
    act(() => {
      (botaoDaBolha(container) as HTMLButtonElement).click();
    });
    const painel = container.querySelector('[role="dialog"]');
    expect(painel).not.toBeNull();
    expect(painel?.getAttribute('aria-label')).toBe('Conversa rápida com o Bento');
    expect(container.querySelector('#bento-bolha-campo')).not.toBeNull();
  });

  /**
   * PERMANENTE EM TODA ABA (07/10/2026). A primeira versão escondia a bolha em
   * /chat; o pedido do usuário foi explícito em tirar essa exceção. Um botão
   * que existe em quase toda tela e some numa é um botão em que não se confia.
   */
  it('continua em /chat, a presença dele não depende da rota', () => {
    pathnameMock.mockReturnValue('/chat');
    expect(botaoDaBolha(montar())).not.toBeNull();
  });

  it('não tem moldura: a marca é o botão, sem círculo em volta', () => {
    const classe = botaoDaBolha(montar())?.getAttribute('class') ?? '';
    expect(classe).not.toContain('rounded-full');
    expect(classe).not.toContain('border-grafite-elevado');
  });

  it('some com o Studio aberto, não flutua por cima de um overlay de tela cheia', () => {
    studioAbertoMock.mockReturnValue(true);
    expect(botaoDaBolha(montar())).toBeNull();
  });
});

describe('o gate de módulo é o MESMO da barra lateral', () => {
  it('sem o módulo `bento`, não existe botão', () => {
    workspaceMock.mockReturnValue({ data: { modules: ['hoje', 'clientes'] } });
    expect(botaoDaBolha(montar())).toBeNull();
  });

  it('master vê mesmo com o workspace sem `bento`, igual à navegação', () => {
    isMasterMock.mockReturnValue({ isMaster: true, isPending: false });
    workspaceMock.mockReturnValue({ data: { modules: [] } });
    expect(botaoDaBolha(montar())).not.toBeNull();
  });

  /** Workspace ainda carregando não é workspace vazio: esconder um item
   *  permitido por um instante não protege nada, e piscar é pior. */
  it('workspace ainda não carregado: aparece', () => {
    workspaceMock.mockReturnValue({ data: undefined as unknown as { modules: string[] } });
    expect(botaoDaBolha(montar())).not.toBeNull();
  });
});
