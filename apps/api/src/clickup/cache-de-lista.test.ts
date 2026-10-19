import { afterEach, describe, expect, it, vi } from 'vitest';
import { chaveDaLista, esquecerTarefasDaLista, tarefasDaListaComCache } from './cache-de-lista';

/**
 * O que estes testes protegem não é "o cache funciona" — é que ele não troque
 * velocidade por resposta errada. Um cache de tarefa de cliente erra de três
 * jeitos, e os três custam caro:
 *
 * 1. servir a lista de A para quem pediu a lista de B;
 * 2. servir a quem PERDEU acesso no ClickUp o que o cache de outra pessoa
 *    guardou;
 * 3. continuar servindo depois de a tarefa mudar no ClickUp.
 */
afterEach(() => {
  esquecerTarefasDaLista();
  vi.useRealTimers();
});

describe('tarefasDaListaComCache', () => {
  it('a segunda leitura não vai ao ClickUp', async () => {
    const buscar = vi.fn().mockResolvedValue(['a']);
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['a']);
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['a']);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('listas diferentes não se misturam', async () => {
    await tarefasDaListaComCache('tok', 'lista-1', false, async () => ['da-1']);
    const resultado = await tarefasDaListaComCache('tok', 'lista-2', false, async () => ['da-2']);
    expect(resultado).toEqual(['da-2']);
  });

  /**
   * O caso que vira problema de ACESSO, não de desempenho: quem perdeu
   * permissão no ClickUp continuaria lendo pela entrada de quem ainda tem.
   */
  it('tokens diferentes não compartilham entrada, mesmo na mesma lista', async () => {
    await tarefasDaListaComCache('token-da-ana', 'lista-1', false, async () => ['o que a ana vê']);
    const buscar = vi.fn().mockResolvedValue(['o que o joao vê']);
    const resultado = await tarefasDaListaComCache('token-do-joao', 'lista-1', false, buscar);
    expect(resultado).toEqual(['o que o joao vê']);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('incluir fechadas é outra pergunta, e tem outra entrada', async () => {
    await tarefasDaListaComCache('tok', 'lista-1', false, async () => ['só abertas']);
    const buscar = vi.fn().mockResolvedValue(['abertas e fechadas']);
    expect(await tarefasDaListaComCache('tok', 'lista-1', true, buscar)).toEqual(['abertas e fechadas']);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  /**
   * É esta linha que torna "mais rápido" e "mais atualizado" compatíveis. Sem
   * ela, o cache seria só cópia velha com outro nome.
   */
  it('o webhook esvazia: depois dele a próxima leitura vai ao ClickUp', async () => {
    const buscar = vi.fn().mockResolvedValueOnce(['antes']).mockResolvedValueOnce(['depois']);
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['antes']);
    esquecerTarefasDaLista();
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['depois']);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('passados 10 minutos o guardado não é mais servido', async () => {
    vi.useFakeTimers();
    const buscar = vi.fn().mockResolvedValueOnce(['velho']).mockResolvedValueOnce(['novo']);
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['velho']);
    vi.advanceTimersByTime(600_001);
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['novo']);
  });

  /**
   * Releitura em segundo plano que falha não pode derrubar o processo nem
   * piorar a resposta: o pior caso é continuar servindo o que já se tinha.
   */
  it('falha na releitura de fundo não lança e não apaga o que estava guardado', async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(['bom'])
      .mockRejectedValueOnce(new Error('ClickUp fora do ar'));

    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['bom']);

    // Passa da janela de frescor sem passar da validade: serve o guardado E
    // dispara a releitura, que vai falhar.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['bom']);
    vi.useRealTimers();

    await new Promise((r) => setTimeout(r, 10));
    // A terceira leitura ainda encontra o valor bom, não um buraco.
    expect(await tarefasDaListaComCache('tok', 'lista-1', false, buscar)).toEqual(['bom']);
  });
});

describe('chaveDaLista', () => {
  it('não carrega o token em claro', () => {
    const chave = chaveDaLista('token-secreto-do-clickup', 'lista-1', false);
    expect(chave).not.toContain('token-secreto-do-clickup');
    expect(chave).toContain('lista-1');
  });

  it('é estável para a mesma pergunta', () => {
    expect(chaveDaLista('tok', 'l1', false)).toBe(chaveDaLista('tok', 'l1', false));
    expect(chaveDaLista('tok', 'l1', false)).not.toBe(chaveDaLista('tok', 'l1', true));
  });
});
