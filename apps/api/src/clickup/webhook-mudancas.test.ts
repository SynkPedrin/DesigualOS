import { describe, expect, it } from 'vitest';
import { extrairMudancas, frasearEventoDeTarefa, mudancaDeStatus, valorLegivel } from './webhook-mudancas';

/**
 * Os payloads abaixo são as FORMAS REAIS do webhook do ClickUp (doc de
 * webhooktaskpayloads): `before`/`after` mudam de tipo conforme o campo, e foi
 * isso que até 02/10/2026 fez o handler desistir de ler qualquer um deles.
 */
describe('extrairMudancas — o que o webhook jogava fora', () => {
  it('lê a mudança de status, que é a pergunta que a operação faz', () => {
    const m = extrairMudancas({
      history_items: [
        {
          field: 'status',
          before: { status: 'em produção', type: 'custom' },
          after: { status: 'em aprovação', type: 'custom' },
        },
      ],
    });
    expect(m).toEqual([{ campo: 'status', rotulo: 'status', de: 'em produção', para: 'em aprovação' }]);
  });

  it('lê TODOS os history_items, não só o primeiro', () => {
    // Uma edição em lote manda vários no mesmo corpo. Ler só o primeiro
    // (como o extrator de autor faz, por não precisar de mais) perderia o
    // status quando ele vem acompanhado de outra mudança.
    const m = extrairMudancas({
      history_items: [
        { field: 'priority', before: { priority: 'normal' }, after: { priority: 'urgent' } },
        { field: 'status', before: { status: 'a fazer' }, after: { status: 'fazendo' } },
      ],
    });
    expect(m).toHaveLength(2);
    expect(mudancaDeStatus(m)?.para).toBe('fazendo');
  });

  it('descarta item sem antes e sem depois em vez de produzir "mudou o status" sem status', () => {
    const m = extrairMudancas({ history_items: [{ field: 'status', before: null, after: null }, { field: '' }] });
    expect(m).toEqual([]);
  });

  it('payload sem history_items não quebra e não inventa', () => {
    expect(extrairMudancas(undefined)).toEqual([]);
    expect(extrairMudancas({})).toEqual([]);
    expect(extrairMudancas({ history_items: 'nada disso' })).toEqual([]);
  });
});

describe('valorLegivel — quatro formatos no mesmo payload', () => {
  it('converte epoch de prazo em data, nunca mostra o número cru', () => {
    expect(valorLegivel('1760054400000', 'due_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // O mesmo texto noutro campo é só texto: não é data e não vira data.
    expect(valorLegivel('1760054400000', 'name')).toBe('1760054400000');
  });

  it('tira o rótulo do objeto (status, prioridade, pessoa) e a lista de etiquetas', () => {
    expect(valorLegivel({ priority: 'urgent', color: '#f00' }, 'priority')).toBe('urgent');
    expect(valorLegivel({ id: 7, username: 'Tammy' }, 'assignee_add')).toBe('Tammy');
    expect(valorLegivel([{ name: 'social' }, { name: 'urgente' }], 'tag')).toBe('social, urgente');
  });

  it('vazio é null, e null é informação ("não havia"), não falha', () => {
    expect(valorLegivel(null)).toBeNull();
    expect(valorLegivel('   ')).toBeNull();
    expect(valorLegivel({ color: '#fff' })).toBeNull();
  });
});

describe('frasearEventoDeTarefa — a frase que a tela mostra', () => {
  it('monta a transição de status com o nome da tarefa', () => {
    const frase = frasearEventoDeTarefa({
      evento: 'taskUpdated',
      nomeDaTarefa: 'Campanha Outubro',
      mudancas: [{ campo: 'status', rotulo: 'status', de: 'em produção', para: 'em aprovação' }],
    });
    expect(frase).toBe('Moveu "Campanha Outubro" de em produção para em aprovação');
  });

  it('sem o nome da tarefa, diz "uma tarefa" — não inventa e não mostra o id', () => {
    const frase = frasearEventoDeTarefa({
      evento: 'taskUpdated',
      nomeDaTarefa: null,
      mudancas: [{ campo: 'status', rotulo: 'status', de: null, para: 'feito' }],
    });
    expect(frase).toBe('Colocou uma tarefa em feito');
    expect(frase).not.toMatch(/86a/);
  });

  it('não repete o autor: a tela já mostra quem fez numa coluna própria', () => {
    const frase = frasearEventoDeTarefa({ evento: 'taskCreated', nomeDaTarefa: 'Brief Elite', mudancas: [] });
    expect(frase).toBe('Criou a tarefa "Brief Elite"');
    expect(frase.toLowerCase()).not.toContain('tammy');
  });

  it('sem status, nomeia o campo que mudou em vez de "atualizou" genérico', () => {
    expect(
      frasearEventoDeTarefa({
        evento: 'taskUpdated',
        nomeDaTarefa: 'Post 12',
        mudancas: [{ campo: 'due_date', rotulo: 'prazo', de: null, para: '2026-10-10' }],
      }),
    ).toBe('Mudou prazo de "Post 12"');
  });
});

describe('a frase nunca sai torta', () => {
  it('sem nome, "criou/apagou uma tarefa" — não "a tarefa uma tarefa"', () => {
    expect(frasearEventoDeTarefa({ evento: 'taskCreated', nomeDaTarefa: null, mudancas: [] })).toBe('Criou uma tarefa');
    expect(frasearEventoDeTarefa({ evento: 'taskDeleted', nomeDaTarefa: '  ', mudancas: [] })).toBe('Apagou uma tarefa');
  });
});
