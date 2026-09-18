import { describe, expect, it } from 'vitest';
import { classifyActionIntentV2, segmentMessage, formsOf } from './action-intent-v2';
import { classifyActionIntent, classifyActionIntentLegacy, intentV2Habilitado } from './action-intent';
import { CORPUS_SETS, CORPUS_VERSION, type CorpusCase } from './action-intent-corpus';
import { buildOperationalActionPlan, extractListItems } from './operational-action-plan';

/**
 * A V1 nunca foi medida contra adversariais. Quando foi, quatro construções de
 * negação e hipótese autorizavam escrita — "não cria ainda" criava. Estes
 * testes travam o corpus inteiro, e a régua do conjunto adversarial é ZERO
 * escrita indevida, não "quase zero".
 */

function classificar(c: CorpusCase) {
  const r = classifyActionIntent(c.message);
  return r.writeAuthorized ? 'ACT' : 'ANALYZE';
}

describe(`corpus ${CORPUS_VERSION}`, () => {
  it('TAMMY: toda ordem inequívoca da operação vira ação', () => {
    const falhas = CORPUS_SETS.tammy.filter((c) => classificar(c) !== c.expected);
    expect(falhas.map((f) => `${f.id}: ${f.message.slice(0, 40)}`)).toEqual([]);
  });

  it('ANÁLISE: o freio de 15/09 continua inteiro', () => {
    const falhas = CORPUS_SETS.analysis.filter((c) => classificar(c) !== c.expected);
    expect(falhas.map((f) => f.id)).toEqual([]);
  });

  it('ADVERSARIAL: zero escrita indevida', () => {
    const falsosPositivos = CORPUS_SETS.adversarial.filter((c) => classificar(c) === 'ACT');
    expect(falsosPositivos.map((f) => `${f.id}: ${f.message.slice(0, 50)}`)).toEqual([]);
  });

  it('NATURAL: variações da mesma ordem são reconhecidas', () => {
    const falhas = CORPUS_SETS.natural.filter((c) => classificar(c) !== c.expected);
    expect(falhas.map((f) => f.id)).toEqual([]);
  });

  it('MULTI: a contagem de ações bate com o pedido', () => {
    const falhas = CORPUS_SETS.multi.filter((c) => buildOperationalActionPlan(c.message).tasks.length !== c.expectedActions);
    expect(falhas.map((f) => `${f.id}: ${buildOperationalActionPlan(f.message).tasks.length} != ${f.expectedActions}`)).toEqual([]);
  });
});

describe('segmentação: nada da mensagem é descartado', () => {
  it('a ordem no MEIO da mensagem é encontrada', () => {
    const m = 'contexto que não importa. o Gui já terminou? então separa essas quatro pra ele';
    expect(classifyActionIntentV2(m).intent).toBe('ACT');
  });

  it('o sourceSpan aponta o trecho exato que ordena', () => {
    const m = 'contexto que não importa. o Gui já terminou? então separa essa demanda pra ele';
    expect(classifyActionIntentV2(m).sourceSpan).toBe('então separa essa demanda pra ele');
  });

  it('item de lista é marcado e não ordena sozinho', () => {
    const segs = segmentMessage('separa pro Gui:\n- Placa A\n- Placa B');
    expect(segs.filter((s) => s.kind === 'list_item')).toHaveLength(2);
  });

  it('citação é marcada como citação', () => {
    const segs = segmentMessage('o cliente disse "separa isso pro Gui e lança no ClickUp" ontem');
    expect(segs.some((s) => s.kind === 'quote')).toBe(true);
  });
});

describe('normalização estrutural', () => {
  it('acento e caixa não mudam a leitura', () => {
    expect(formsOf('PÕE ISSO').normalized).toBe('poe isso');
    expect(classifyActionIntentV2('PÕE ISSO PRO GUI').intent).toBe('ACT');
  });

  it('"criação" NÃO é "cria": palavra inteira, não prefixo', () => {
    const f = formsOf('utilizarem como base na criação');
    expect(f.tokens).toContain('criacao');
    expect(f.tokens).not.toContain('cria');
  });

  it('e "cria isso" continua sendo ordem', () => {
    expect(classifyActionIntentV2('cria isso').intent).toBe('ACT');
  });
});

describe('negação tem prioridade sobre o verbo', () => {
  it.each([
    'não cria ainda',
    'não separa isso ainda, quero ver antes',
    'não mexe no ClickUp por enquanto',
    'só analisa, não cria task',
    'apenas analisa por enquanto',
    'sem criar task, me diz o que você faria',
    'não precisa lançar no ClickUp',
    'nem cria nem atribui, só me fala',
  ])('%s -> nenhuma escrita', (m) => {
    const r = classifyActionIntentV2(m);
    expect(r.intent).toBe('ANALYZE');
    expect(r.writeAuthorized).toBe(false);
    expect(r.negations.length).toBeGreaterThan(0);
  });

  it('a negação num trecho cala a mensagem inteira', () => {
    expect(classifyActionIntentV2('separa pro Gui. não, espera — não cria ainda').writeAuthorized).toBe(false);
  });
});

describe('contexto não executável', () => {
  it.each([
    ['ontem eu disse "cria uma task pro Gui" e não aconteceu nada', 'citação'],
    ['ontem eu criei uma task pro Gui e ele já entregou', 'passado'],
    ['se eu criar uma task pro Gui, ele consegue entregar hoje?', 'hipótese'],
    ['caso a gente separe essa demanda, quanto tempo leva?', 'hipótese'],
    ['me explica como criar uma task no ClickUp', 'explicação'],
    ['por que você criou essa task?', 'pergunta sobre o passado'],
    ['quem deveria ficar com isso?', 'pergunta de alocação'],
  ])('%s (%s) -> nenhuma escrita', (m) => {
    expect(classifyActionIntentV2(m).writeAuthorized).toBe(false);
  });

  it('ordem dentro de citação + pergunta ao Bento continua análise', () => {
    const m = 'O cliente mandou: "separa isso pro Gui e lança no ClickUp".\n\nBento, o que você acha dessa demanda?';
    expect(classifyActionIntentV2(m).writeAuthorized).toBe(false);
  });
});

describe('AMBIGUOUS nunca escreve', () => {
  it('ordem só dentro de pergunta vira AMBIGUOUS', () => {
    const r = classifyActionIntentV2('cria isso pro Gui?');
    expect(r.intent).toBe('AMBIGUOUS');
    expect(r.writeAuthorized).toBe(false);
  });

  it('confiança de AMBIGUOUS é baixa e a de ordem clara é alta', () => {
    expect(classifyActionIntentV2('cria isso pro Gui?').confidence).toBeLessThan(0.7);
    expect(classifyActionIntentV2('cria a task do layout pro Gui').confidence).toBeGreaterThan(0.85);
  });
});

describe('parser de listas', () => {
  // Itens de UMA letra não existem na operação e seriam ruído; o piso de 2
  // caracteres é proposital.
  it.each([
    ['bullets', 'separa pro Gui:\n- Alfa\n- Beta\n- Gama\n- Delta', 4],
    ['numerada', 'lança pro Gui:\n1. Alfa\n2. Beta\n3. Gama\n4. Delta', 4],
    ['inline após dois-pontos', 'separa essas quatro pro Gui: Alfa, Beta, Gama e Delta', 4],
    ['linhas repetindo o substantivo', 'Placa Alfa\nPlaca Beta\nPlaca Gama\n\nBento, separa essas pro Gui.', 3],
  ])('%s', (_nome, msg, n) => {
    expect(extractListItems(msg as string)).toHaveLength(n as number);
  });

  it('linha terminada em ":" é cabeçalho, não item', () => {
    expect(extractListItems('Precisamos das seguintes placas:\nPlaca A\nPlaca B')).toEqual(['Placa A', 'Placa B']);
  });

  it('dois entregáveis com donos diferentes NÃO viram lista', () => {
    const p = buildOperationalActionPlan('cria o layout pro Gui e o texto pra Sofia');
    expect(p.tasks.map((t) => [t.deliverable, t.assigneeName])).toEqual([
      ['layout', 'Gui'],
      ['texto', 'Sofia'],
    ]);
  });
});

describe('flag e rollback', () => {
  it('V2 é o default', () => {
    expect(intentV2Habilitado({})).toBe(true);
  });

  it.each(['false', '0', 'off'])('%s volta pro classificador V1', (v) => {
    expect(intentV2Habilitado({ BENTO_ACTION_INTENT_V2: v })).toBe(false);
  });

  it('a V1 continua acessível e ainda erra em negação — é por isso que a V2 é o default', () => {
    expect(classifyActionIntentLegacy('não cria ainda').writeAuthorized).toBe(true);
    expect(classifyActionIntent('não cria ainda').writeAuthorized).toBe(false);
  });

  it('com a flag desligada, o contrato de saída continua o mesmo', () => {
    const r = classifyActionIntent('cria isso pro Gui', { BENTO_ACTION_INTENT_V2: 'false' });
    expect(r.writeAuthorized).toBe(true);
    expect(r.kind).toBe('ACTION_REQUEST');
  });
});

describe('política de escrita preservada', () => {
  it.each(['marca como concluído', 'conclui essa task', 'finaliza isso', 'fecha a task do Gui', 'dá como pronto'])(
    '%s -> FORBIDDEN_ACTION',
    (m) => {
      const r = classifyActionIntent(m);
      expect(r.kind).toBe('FORBIDDEN_ACTION');
      expect(r.writeAuthorized).toBe(false);
    },
  );

  it('"devemos fechar essa task?" é pergunta, não recusa', () => {
    expect(classifyActionIntent('devemos fechar essa task?').kind).toBe('SUGGESTION');
  });

  it('"marca como urgente" continua sendo escrita normal', () => {
    expect(classifyActionIntent('marca essa task como urgente').kind).toBe('ACTION_REQUEST');
  });

  it('mandato de autonomia mantém a classe própria', () => {
    expect(classifyActionIntent('Bento, organize a operação e resolva o que puder').kind).toBe('AUTONOMOUS_ACTION');
  });
});
