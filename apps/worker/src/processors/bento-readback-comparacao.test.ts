import { describe, expect, it } from 'vitest';
import { checklistConfere, inicioConfere, seguidorConfere } from './bento-update-executor';

/**
 * O VERIFICADOR ERA MAIS ESTRITO QUE O ARMAZENAMENTO (29/09/2026).
 *
 * O leitor de saúde pegou três escritas relatadas como "escrito, mas a
 * releitura não confirmou" — seguidor, checklist e data de início — e nas três
 * a escrita tinha funcionado. Os campos que sempre passaram comparam com
 * tolerância (prazo por dia, status em minúsculo, responsável por id); estes
 * três comparavam com igualdade estrita de epoch ou de string.
 */

const DIA = (iso: string) => Date.parse(iso);

describe('inicioConfere — por dia, como o prazo', () => {
  it('mesmo dia com horário diferente CONFERE — o ClickUp normaliza a hora', () => {
    // Era `===` de epoch: entrava às 12:00, voltava às 03:00 do mesmo dia, e o
    // Bento dizia que não confirmou.
    expect(inicioConfere(DIA('2026-10-02T03:00:00-03:00'), DIA('2026-10-02T12:00:00-03:00'))).toBe(true);
  });

  it('dia diferente NÃO confere — a tolerância é de hora, não de data', () => {
    expect(inicioConfere(DIA('2026-10-03T12:00:00-03:00'), DIA('2026-10-02T12:00:00-03:00'))).toBe(false);
  });

  it('início ausente na releitura não confere', () => {
    expect(inicioConfere(null, DIA('2026-10-02T12:00:00-03:00'))).toBe(false);
  });

  it('a virada do dia não engana: 23:59 e 00:01 são dias diferentes', () => {
    expect(inicioConfere(DIA('2026-10-03T00:01:00-03:00'), DIA('2026-10-02T23:59:00-03:00'))).toBe(false);
  });
});

describe('seguidorConfere — ausente não é vazio', () => {
  it('campo NÃO devolvido pelo ClickUp aceita: não dá pra reprovar sem ter olhado', () => {
    expect(seguidorConfere(null, 42)).toBe(true);
  });

  it('campo devolvido VAZIO reprova — aí sim olhamos e não tem ninguém', () => {
    expect(seguidorConfere([], 42)).toBe(false);
  });

  it('seguidor presente confere; outro seguidor não basta', () => {
    expect(seguidorConfere([{ id: 42 }], 42)).toBe(true);
    expect(seguidorConfere([{ id: 7 }], 42)).toBe(false);
    expect(seguidorConfere([{ id: 7 }, { id: 42 }], 42)).toBe(true);
  });
});

describe('checklistConfere — o conteúdo do item, não o espaçamento do provedor', () => {
  const itens = ['Revisar ortografia', 'Conferir CTA'];

  it('confere quando o ClickUp devolve com espaçamento próprio', () => {
    expect(checklistConfere([{ name: 'Checklist', items: ['  Revisar ortografia ', 'Conferir  CTA'] }], 'Checklist', itens)).toBe(true);
  });

  it('confere ignorando caixa', () => {
    expect(checklistConfere([{ name: 'checklist', items: ['REVISAR ORTOGRAFIA', 'conferir cta'] }], 'Checklist', itens)).toBe(true);
  });

  it('item FALTANDO reprova — normalizar não é afrouxar', () => {
    expect(checklistConfere([{ name: 'Checklist', items: ['Revisar ortografia'] }], 'Checklist', itens)).toBe(false);
  });

  it('item com texto DIFERENTE reprova', () => {
    expect(checklistConfere([{ name: 'Checklist', items: ['Revisar ortografia', 'Conferir link'] }], 'Checklist', itens)).toBe(false);
  });

  it('checklist com outro nome não vale', () => {
    expect(checklistConfere([{ name: 'Outro', items: ['Revisar ortografia', 'Conferir CTA'] }], 'Checklist', itens)).toBe(false);
  });

  it('nenhum checklist na releitura reprova', () => {
    expect(checklistConfere([], 'Checklist', itens)).toBe(false);
  });

  it('itens a MAIS na task não reprovam — o pedido foi atendido', () => {
    expect(checklistConfere([{ name: 'Checklist', items: [...itens, 'Item que já existia'] }], 'Checklist', itens)).toBe(true);
  });
});
