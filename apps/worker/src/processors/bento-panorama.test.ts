import { describe, expect, it, vi } from 'vitest';
import { apurarMetricas, metricasEmTexto, montarPanorama, numerosInventados, panoramaEmResposta, type MetricasDaOperacao } from './bento-panorama';

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
    updatedAt: HOJE.getTime(), assignees: ['Gui'], tags: [], parentId: null, topLevelParentId: null, listId: 'L1',
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

const ORG_A = 'org-a-11111111';
const ORG_B = 'org-b-22222222';

/**
 * "Quero o Bento saber de tudo sobre todos os clientes e todas as ações do
 * ClickUp" — ou seja, o estado da operação tem que estar na mão dele SEMPRE,
 * não só quando alguém digita "panorama".
 *
 * O risco disso é conhecido e já custou caro: varrer as listas de todos os
 * clientes por turno foi o que fez o POST /chat levar 186s. Contexto ambiente
 * não pode ser pago por turno — daí o cache, e é ele que estes testes travam.
 *
 * Todo teste passa `ORG_A` (ou outra organização explícita) como primeiro
 * argumento desde o P0.1 slice 2b: o cache deixou de ser uma variável só,
 * compartilhada por qualquer organização, e virou um Map por organização —
 * ver "isolamento cross-tenant do cache" abaixo pra prova disso.
 */
describe('estado da operação como contexto de todo turno', () => {
  beforeEach(() => __limparCacheDoEstado());

  it('apura uma vez e REUSA — o segundo turno não paga nada', async () => {
    const buscar = vi.fn(async () => ({ tasks: [task({ dueDate: dia(-1) })], truncated: false }));
    const t1 = await estadoDaOperacaoEmTexto(ORG_A, buscar, HOJE);
    const t2 = await estadoDaOperacaoEmTexto(ORG_A, buscar, new Date(HOJE.getTime() + 60_000));
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(t2).toBe(t1);
  });

  it('depois do TTL, apura de novo', async () => {
    const buscar = vi.fn(async () => ({ tasks: [task()], truncated: false }));
    await estadoDaOperacaoEmTexto(ORG_A, buscar, HOJE);
    await estadoDaOperacaoEmTexto(ORG_A, buscar, new Date(HOJE.getTime() + 10 * 60_000));
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('o bloco traz número apurado e proíbe inventar', async () => {
    const t = await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [task({ dueDate: dia(-1) })], truncated: false }), HOJE);
    expect(t).toContain('apurado do ClickUp');
    expect(t).toContain('Atrasadas: 1');
    expect(t).toContain('NÃO invente número');
  });

  it('ClickUp fora do ar não derruba o turno — devolve o cache, ou nada', async () => {
    const falha = vi.fn(async () => { throw new Error('502'); });
    expect(await estadoDaOperacaoEmTexto(ORG_A, falha, HOJE)).toBeNull();
  });

  it('falha depois de um sucesso serve o último estado conhecido, em vez de nada', async () => {
    await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [task({ dueDate: dia(-1) })], truncated: false }), HOJE);
    const depois = await estadoDaOperacaoEmTexto(
      ORG_A,
      async () => { throw new Error('502'); },
      new Date(HOJE.getTime() + 10 * 60_000),
    );
    expect(depois).toContain('Atrasadas: 1');
  });

  it('operação vazia não vira bloco — não há o que dizer', async () => {
    expect(await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [], truncated: false }), HOJE)).toBeNull();
  });
});

/**
 * P0.1 SLICE 2B (05/10/2026): o cache era uma variável só, sem chave de
 * organização — a consulta já saía recortada por tenant (slice 2a), mas a
 * RESPOSTA cacheada vazava pra qualquer organização que perguntasse dentro do
 * TTL. Estes testes travam o Map por organização que corrigiu isso.
 */
describe('isolamento cross-tenant do cache de estado', () => {
  beforeEach(() => __limparCacheDoEstado());

  it('A cacheia, B pergunta no mesmo instante: B recebe o estado de B, nunca o de A', async () => {
    await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [task({ dueDate: dia(-1), listName: 'A_STATE' })], truncated: false }), HOJE);

    const deB = await estadoDaOperacaoEmTexto(ORG_B, async () => ({ tasks: [task({ dueDate: dia(-3), listName: 'B_STATE' })], truncated: false }), HOJE);

    // 3 atrasadas é a marca d'água do estado de B (dia(-3) com 1 task -> "Atrasadas: 1",
    // o que distingue é o conteúdo vir da segunda chamada, não da primeira).
    expect(deB).toContain('Atrasadas: 1');
    expect(deB).not.toBe(await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [], truncated: false }), HOJE));
  });

  it('invertendo a ordem (B cacheia primeiro), A continua recebendo o PRÓPRIO estado', async () => {
    const buscarA = vi.fn(async () => ({ tasks: [task({ dueDate: dia(-1) })], truncated: false }));
    const buscarB = vi.fn(async () => ({ tasks: [task({ dueDate: dia(-1) }), task({ dueDate: dia(-1) })], truncated: false }));

    await estadoDaOperacaoEmTexto(ORG_B, buscarB, HOJE);
    const deA = await estadoDaOperacaoEmTexto(ORG_A, buscarA, HOJE);

    expect(buscarA).toHaveBeenCalledTimes(1); // A não achou cache de B e consultou de verdade
    expect(deA).toContain('Atrasadas: 1');

    // Terceira chamada pra A, ainda dentro do TTL: usa o cache de A, não o de B.
    const deANovo = await estadoDaOperacaoEmTexto(ORG_A, buscarA, new Date(HOJE.getTime() + 1_000));
    expect(buscarA).toHaveBeenCalledTimes(1);
    expect(deANovo).toBe(deA);
  });

  it('duas organizações concorrentes (Promise.all) não se sobrescrevem', async () => {
    const [deA, deB] = await Promise.all([
      estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [task({ dueDate: dia(-1) })], truncated: false }), HOJE),
      estadoDaOperacaoEmTexto(ORG_B, async () => ({ tasks: [task({ dueDate: dia(-1) }), task({ dueDate: dia(-1) }), task({ dueDate: dia(-1) })], truncated: false }), HOJE),
    ]);
    expect(deA).toContain('Atrasadas: 1');
    expect(deB).toContain('Atrasadas: 3');

    // Lendo de novo, ainda dentro do TTL: cada organização continua com o PRÓPRIO número.
    const deANovamente = await estadoDaOperacaoEmTexto(ORG_A, async () => { throw new Error('não deveria consultar — devia vir do cache de A'); }, HOJE);
    const deBNovamente = await estadoDaOperacaoEmTexto(ORG_B, async () => { throw new Error('não deveria consultar — devia vir do cache de B'); }, HOJE);
    expect(deANovamente).toContain('Atrasadas: 1');
    expect(deBNovamente).toContain('Atrasadas: 3');
  });

  /**
   * FAIL CLOSED: sem organização, a função nunca lê NEM escreve
   * `cachePorOrganizacao` — ela roda a busca na hora e esquece. Provado aqui
   * ao garantir que (a) uma chamada anterior de A não "vaza" pra quem chama
   * sem organização, e (b) chamar sem organização não deixa rastro que uma
   * chamada de B possa herdar depois.
   */
  it('FAIL CLOSED: sem organizationId, nunca lê cache alheio nem cria entrada própria', async () => {
    await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [task({ dueDate: dia(-1) })], truncated: false }), HOJE);

    const buscarSemOrg = vi.fn(async () => ({ tasks: [task({ dueDate: dia(-1) }), task({ dueDate: dia(-1) })], truncated: false }));
    const semOrgNull = await estadoDaOperacaoEmTexto(null, buscarSemOrg, HOJE);
    const semOrgUndefined = await estadoDaOperacaoEmTexto(undefined, buscarSemOrg, HOJE);

    // Nunca recebeu o cache de A (1 atrasada): sempre apurou fresco (2 atrasadas).
    expect(semOrgNull).toContain('Atrasadas: 2');
    expect(semOrgUndefined).toContain('Atrasadas: 2');
    expect(buscarSemOrg).toHaveBeenCalledTimes(2); // nunca usou cache - nem o de A, nem um "default" próprio

    // E a organização B, chamando depois, não herda nada do que rodou sem organização.
    const deB = await estadoDaOperacaoEmTexto(ORG_B, async () => ({ tasks: [task({ dueDate: dia(-1) }), task({ dueDate: dia(-1) }), task({ dueDate: dia(-1) })], truncated: false }), HOJE);
    expect(deB).toContain('Atrasadas: 3');
  });
});

describe('número truncado é declarado, nunca apresentado como total', () => {
  it('batendo no teto, o bloco avisa que é uma fatia', async () => {
    __limparCacheDoEstado();
    const muitas = Array.from({ length: 500 }, () => task({ dueDate: dia(-1) }));
    const t = await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: muitas, truncated: true }), HOJE);
    expect(t).toContain('truncada');
    expect(t).toContain('FATIA');
  });

  it('abaixo do teto, nada de ressalva — o número é o total', async () => {
    __limparCacheDoEstado();
    const t = await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [task({ dueDate: dia(-1) })], truncated: false }), HOJE);
    expect(t).not.toContain('FATIA');
  });
});

/**
 * Bateria de uso livre, 29/09/2026: "quanto a gente faturou com esse cliente?"
 * voltou com a explicação certa (o ClickUp não guarda receita) e a conclusão
 * errada — "Logo, R$ 0,00 faturado registrado no sistema". Quem lê rápido
 * entende que o cliente faturou zero, e isso vira fato citável.
 */
describe('ausência de dado nunca pode virar zero', () => {
  it('o bloco proíbe explicitamente responder "não sei" com um número', async () => {
    __limparCacheDoEstado();
    const t = await estadoDaOperacaoEmTexto(ORG_A, async () => ({ tasks: [task()], truncated: false }), HOJE);
    expect(t).toContain('AUSÊNCIA DE DADO NÃO É ZERO');
    expect(t).toContain('R$ 0,00');
  });
});

/**
 * Medido no navegador com a persona de gerente de conta (29/09/2026): o gatilho
 * conhecia "onde está o risco" e NÃO "o que está em risco", que é a forma mais
 * natural de perguntar a mesma coisa. A pergunta caía no core, que responde
 * listando tarefa, e a análise causal nunca era usada.
 */
describe('perguntar por risco, do jeito que se pergunta', () => {
  it.each([
    'o que está em risco na Cosentino?',
    'o que ta em risco hoje',
    'quais os riscos da operação',
    'qual risco a gente tem',
  ])('%s -> panorama', (m) => {
    expect(pedePanorama(m)).toBe(true);
  });

  it('"risco" solto dentro de outra frase NÃO vira panorama', () => {
    expect(pedePanorama('essa task é de risco alto, muda a prioridade')).toBe(false);
    expect(pedePanorama('cria uma task de análise de risco')).toBe(false);
  });
});

/**
 * Medido no navegador em 29/09/2026, num turno que acertou todo o resto: a
 * leitura fechou com "Redistribuir 13 das 24 peças atrasadas para Bruna
 * Baldacini". O 24 é real, o 13 não existe em lugar nenhum dos números
 * apurados. O prompt já proibia número novo — proibir não basta.
 */
describe('a leitura não pode inventar número', () => {
  const APURADO = 'Atrasadas: 24\nSem responsável: 31\n- Bruna Baldacini: 0 / 1 / 1';

  it('pega o caso real', () => {
    expect(numerosInventados('Redistribuir 13 das 24 peças atrasadas para Bruna.', APURADO)).toEqual([13]);
  });

  it('número que está no apurado passa', () => {
    expect(numerosInventados('São 24 atrasadas e 31 sem responsável.', APURADO)).toEqual([]);
  });

  it('data, percentual e numeração de lista não são invenção', () => {
    expect(numerosInventados('1. Prazo 25/09, cobertura de 80%.', APURADO)).toEqual([]);
  });

  it('"apenas uma tarefa" não vira acusação de número falso', () => {
    expect(numerosInventados('Bruna tem apenas 1 tarefa pendente.', APURADO)).toEqual([]);
  });

  it('leitura que insiste em inventar é DESCARTADA — os números bastam sozinhos', async () => {
    const p = await montarPanorama({
      tasks: [task({ dueDate: dia(-1) })],
      escritor: vi.fn(async () => '## O QUE ESTÁ EM RISCO\n- redistribuir 137 peças'),
      agora: HOJE,
    });
    expect(p.leitura).toBeNull();
    expect(panoramaEmResposta(p)).toContain('Atrasadas: 1');
  });

  it('acertando na reespera, a leitura é mantida', async () => {
    const escritor = vi
      .fn<Escritor>()
      .mockResolvedValueOnce('## O QUE ESTÁ EM RISCO\n- redistribuir 137 peças')
      .mockResolvedValueOnce('## O QUE ESTÁ EM RISCO\n- a maioria das atrasadas está sem dono');
    const p = await montarPanorama({ tasks: [task({ dueDate: dia(-1) })], escritor, agora: HOJE });
    expect(escritor).toHaveBeenCalledTimes(2);
    expect(p.leitura).toContain('a maioria');
  });
});

/**
 * A CASA NÃO É CLIENTE, TAMBÉM NO PANORAMA (29/09/2026).
 *
 * Medido numa resposta real a "como tá a operação hoje?": "- Agência Desigual:
 * 34 / 17 / 0" apareceu no meio da carteira, entre Cosentino e D. Carvalho. O
 * bloco de dado ao vivo já separava; o panorama monta a própria apresentação e
 * ficou para trás.
 */
describe('panorama separa carteira de frente interna', () => {
  const medidas: MetricasDaOperacao = {
    total: 100, atrasadas: 40, semDono: 20, abandonadas: 10, venceHoje: 2,
    venceNaSemana: 8, semPrazo: 5, sobrecarga: [], gargalos: [],
    porCliente: [
      { cliente: 'Cosentino', atrasadas: 24, semDono: 31, vencendoNaSemana: 0 },
      { cliente: 'Agência Desigual', atrasadas: 34, semDono: 17, vencendoNaSemana: 0 },
      { cliente: 'D. Carvalho', atrasadas: 12, semDono: 20, vencendoNaSemana: 6 },
    ],
  };

  it('a agência sai da lista de clientes e ganha bloco próprio', () => {
    const texto = metricasEmTexto(medidas);
    const linhaCarteira = texto.indexOf('Por cliente (');
    const linhaInterna = texto.indexOf('Frentes INTERNAS');
    expect(linhaInterna).toBeGreaterThan(linhaCarteira);
    // e a agência está DEPOIS do cabeçalho interno, não antes
    expect(texto.indexOf('Agência Desigual')).toBeGreaterThan(linhaInterna);
  });

  it('o trabalho da casa continua com os números — não some', () => {
    const texto = metricasEmTexto(medidas);
    expect(texto).toContain('Agência Desigual: 34 / 17 / 0');
  });

  it('a instrução diz para não somar na carteira', () => {
    expect(metricasEmTexto(medidas)).toContain('não são cliente');
  });

  it('sem frente interna, nenhum cabeçalho extra aparece', () => {
    const soCarteira: MetricasDaOperacao = { ...medidas, porCliente: [{ cliente: 'Cosentino', atrasadas: 1, semDono: 0, vencendoNaSemana: 0 }] };
    const texto = metricasEmTexto(soCarteira);
    expect(texto).not.toContain('Frentes INTERNAS');
    expect(texto).toContain('Por cliente (');
  });
});
