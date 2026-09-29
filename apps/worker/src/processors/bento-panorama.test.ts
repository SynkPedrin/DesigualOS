import { describe, expect, it, vi } from 'vitest';
import { apurarMetricas, metricasEmTexto, montarPanorama, panoramaEmResposta } from './bento-panorama';

type Escritor = (prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>;
import type { OperationTask } from '@desigual-os/tool-gateway';

/**
 * "Um gerenciador, não um executor de task" (pedido da operação, 28/09/2026).
 *
 * A diferença aparece em "como tá a operação hoje?": a resposta antiga eram 50
 * linhas de tarefa, e ninguém lê 50 linhas. O que estes testes protegem é a
 * separação que impede o panorama de virar opinião com cara de dado — número
 * apurado aqui, determinístico; leitura escrita pelo modelo sobre ELE.
 */

const HOJE = new Date(2026, 8, 28, 10, 0); // segunda, 28/09/2026
const dia = (n: number) => new Date(2026, 8, 28 + n).getTime();

function task(over: Partial<OperationTask> = {}): OperationTask {
  return {
    id: 't', name: 'Task', description: null, status: 'aberto', statusType: 'open',
    priority: null, url: null, dueDate: dia(2), startDate: null, createdAt: null,
    updatedAt: HOJE.getTime(), assignees: ['Gui'], tags: [], listId: 'L1',
    listName: 'D. Carvalho', folderName: null, spaceId: null, ...over,
  };
}

describe('os números são apurados, nunca opinados', () => {
  it('atrasada é prazo ANTERIOR a hoje; vencer hoje não é atraso', () => {
    const m = apurarMetricas([task({ dueDate: dia(-1) }), task({ dueDate: dia(0) })], HOJE);
    expect(m.atrasadas).toBe(1);
    expect(m.venceHoje).toBe(1);
  });

  it('sem dono é contado, e sem dono E parado vira ABANDONADA', () => {
    const m = apurarMetricas(
      [
        task({ assignees: [], updatedAt: HOJE.getTime() }),
        task({ assignees: [], updatedAt: dia(-9) }),
      ],
      HOJE,
    );
    expect(m.semDono).toBe(2);
    // É o modo silencioso de perder trabalho: está no ClickUp, logo "está resolvido".
    expect(m.abandonadas).toBe(1);
  });

  it('gargalo é concentração de prazo na MESMA pessoa e cliente', () => {
    const m = apurarMetricas(
      [task(), task(), task(), task({ assignees: ['Bruna'] })],
      HOJE,
    );
    expect(m.gargalos).toEqual([{ pessoa: 'Gui', cliente: 'D. Carvalho', quantas: 3 }]);
  });

  it('duas tasks na mesma pessoa não são gargalo — é agenda', () => {
    expect(apurarMetricas([task(), task()], HOJE).gargalos).toEqual([]);
  });

  it('task com dois responsáveis conta carga pros dois', () => {
    const m = apurarMetricas([task({ assignees: ['Gui', 'Bruna'] })], HOJE);
    expect(m.sobrecarga.map((s) => s.pessoa).sort()).toEqual(['Bruna', 'Gui']);
  });

  it('sem prazo é contado à parte — não é atraso nem agenda', () => {
    const m = apurarMetricas([task({ dueDate: null })], HOJE);
    expect(m.semPrazo).toBe(1);
    expect(m.atrasadas).toBe(0);
    expect(m.venceNaSemana).toBe(0);
  });

  it('cliente sem risco nenhum não polui o recorte', () => {
    const m = apurarMetricas([task({ listName: 'Tranquilo', dueDate: dia(40) })], HOJE);
    expect(m.porCliente).toEqual([]);
  });
});

describe('a leitura não pode ir além dos números', () => {
  const tasks = [task({ dueDate: dia(-2) }), task({ assignees: [] })];

  it('o prompt proíbe inventar nome e número', async () => {
    const escritor = vi.fn<Escritor>(async () => '## O QUE ESTÁ EM RISCO\n- algo');
    await montarPanorama({ tasks, escritor, agora: HOJE });
    const prompt = escritor.mock.calls[0]![0];
    expect(prompt).toContain('NÃO tem informação além dos números');
    expect(prompt).toContain('Nenhum número novo');
  });

  it('operação vazia não chama o modelo — não há o que ler', async () => {
    const escritor = vi.fn(async () => 'qualquer coisa');
    const p = await montarPanorama({ tasks: [], escritor, agora: HOJE });
    expect(escritor).not.toHaveBeenCalled();
    expect(panoramaEmResposta(p)).toContain('Nenhuma tarefa aberta');
  });

  it('modelo mudo NÃO derruba o panorama: os números valem sozinhos', async () => {
    const p = await montarPanorama({ tasks, escritor: vi.fn(async () => null), agora: HOJE });
    expect(p.leitura).toBeNull();
    expect(panoramaEmResposta(p)).toContain('Atrasadas: 1');
  });

  it('escritor que explode não derruba o turno', async () => {
    const p = await montarPanorama({
      tasks,
      escritor: vi.fn(async () => { throw new Error('timeout'); }),
      agora: HOJE,
    });
    expect(p.leitura).toBeNull();
  });

  it('a resposta traz número E leitura, nessa ordem', async () => {
    const p = await montarPanorama({ tasks, escritor: vi.fn(async () => '## O QUE ESTÁ EM RISCO\n- x'), agora: HOJE });
    const r = panoramaEmResposta(p);
    expect(r.indexOf('Atrasadas')).toBeLessThan(r.indexOf('O QUE ESTÁ EM RISCO'));
  });
});

describe('os números em texto são conferíveis', () => {
  it('trazem o que o gerente precisa sem abrir o ClickUp', () => {
    const t = metricasEmTexto(apurarMetricas([task({ dueDate: dia(-1) }), task({ assignees: [] })], HOJE));
    expect(t).toContain('Atrasadas: 1');
    expect(t).toContain('Sem responsável: 1');
    expect(t).toContain('D. Carvalho');
  });
});

import { pedePanorama } from './bento-panorama';

describe('o gatilho reconhece pedido de panorama, não de escrita', () => {
  it.each([
    'me atualiza',
    'panorama da operação',
    'como está a operação hoje?',
    'como tá o time?',
    'o que está travado',
    'onde está o risco',
    'status geral',
    'me põe a par',
  ])('%s -> panorama', (m) => {
    expect(pedePanorama(m)).toBe(true);
  });

  it.each([
    'muda o status dessa task',
    'altera o status para urgente',
    'cria a task do carrossel',
    'me lista as tarefas da D Carvalho',
    'qual o status da task 13?',
  ])('%s -> NÃO é panorama', (m) => {
    expect(pedePanorama(m)).toBe(false);
  });
});

import { estadoDaOperacaoEmTexto, __limparCacheDoEstado } from './bento-panorama';
import { beforeEach } from 'vitest';

/**
 * "Quero o Bento saber de tudo sobre todos os clientes e todas as ações do
 * ClickUp" — ou seja, o estado da operação tem que estar na mão dele SEMPRE,
 * não só quando alguém digita "panorama".
 *
 * O risco disso é conhecido e já custou caro: varrer as listas de todos os
 * clientes por turno foi o que fez o POST /chat levar 186s. Contexto ambiente
 * não pode ser pago por turno — daí o cache, e é ele que estes testes travam.
 */
describe('estado da operação como contexto de todo turno', () => {
  beforeEach(() => __limparCacheDoEstado());

  it('apura uma vez e REUSA — o segundo turno não paga nada', async () => {
    const buscar = vi.fn(async () => [task({ dueDate: dia(-1) })]);
    const t1 = await estadoDaOperacaoEmTexto(buscar, HOJE);
    const t2 = await estadoDaOperacaoEmTexto(buscar, new Date(HOJE.getTime() + 60_000));
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(t2).toBe(t1);
  });

  it('depois do TTL, apura de novo', async () => {
    const buscar = vi.fn(async () => [task()]);
    await estadoDaOperacaoEmTexto(buscar, HOJE);
    await estadoDaOperacaoEmTexto(buscar, new Date(HOJE.getTime() + 10 * 60_000));
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('o bloco traz número apurado e proíbe inventar', async () => {
    const t = await estadoDaOperacaoEmTexto(async () => [task({ dueDate: dia(-1) })], HOJE);
    expect(t).toContain('apurado do ClickUp');
    expect(t).toContain('Atrasadas: 1');
    expect(t).toContain('NÃO invente número');
  });

  it('ClickUp fora do ar não derruba o turno — devolve o cache, ou nada', async () => {
    const falha = vi.fn(async () => { throw new Error('502'); });
    expect(await estadoDaOperacaoEmTexto(falha, HOJE)).toBeNull();
  });

  it('falha depois de um sucesso serve o último estado conhecido, em vez de nada', async () => {
    await estadoDaOperacaoEmTexto(async () => [task({ dueDate: dia(-1) })], HOJE);
    const depois = await estadoDaOperacaoEmTexto(
      async () => { throw new Error('502'); },
      new Date(HOJE.getTime() + 10 * 60_000),
    );
    expect(depois).toContain('Atrasadas: 1');
  });

  it('operação vazia não vira bloco — não há o que dizer', async () => {
    expect(await estadoDaOperacaoEmTexto(async () => [], HOJE)).toBeNull();
  });
});

describe('número truncado é declarado, nunca apresentado como total', () => {
  it('batendo no teto, o bloco avisa que é uma fatia', async () => {
    __limparCacheDoEstado();
    const muitas = Array.from({ length: 500 }, () => task({ dueDate: dia(-1) }));
    const t = await estadoDaOperacaoEmTexto(async () => muitas, HOJE);
    expect(t).toContain('teto de 500');
    expect(t).toContain('FATIA');
  });

  it('abaixo do teto, nada de ressalva — o número é o total', async () => {
    __limparCacheDoEstado();
    const t = await estadoDaOperacaoEmTexto(async () => [task({ dueDate: dia(-1) })], HOJE);
    expect(t).not.toContain('FATIA');
  });
});
