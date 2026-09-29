import { describe, expect, it } from 'vitest';
import { parseEstimativa, resolverCampoPersonalizado, ehFalhaDeCampo, explicarFalhaDeCampo } from './bento-field-values';
import type { ClickUpCustomField } from '@desigual-os/tool-gateway';

const H = 3_600_000;
const MIN = 60_000;

describe('estimativa em linguagem de agência', () => {
  it.each([
    ['2h', 2 * H],
    ['2 horas', 2 * H],
    ['30min', 30 * MIN],
    ['45 minutos', 45 * MIN],
    ['1h30', H + 30 * MIN],
    ['1:30', H + 30 * MIN],
    ['meia hora', H / 2],
    ['meio dia', 4 * H],
    ['1 dia', 8 * H],
    ['2 dias', 16 * H],
  ])('%s -> %i ms', (texto, ms) => {
    expect(parseEstimativa(texto)).toBe(ms);
  });

  it.each(['', '   ', 'depois', 'rápido', 'o quanto antes', null, undefined])(
    '%s não vira estimativa (campo fica vazio, não chutado)',
    (t) => {
      expect(parseEstimativa(t as string | null | undefined)).toBeNull();
    },
  );
});

const CAMPOS: ClickUpCustomField[] = [
  { id: 'f1', name: 'Etapa', type: 'drop_down', options: [{ id: 'o1', name: 'Briefing' }, { id: 'o2', name: 'Aprovação' }] },
  { id: 'f2', name: 'Verba', type: 'currency', options: [] },
  { id: 'f3', name: 'Observações', type: 'text', options: [] },
  { id: 'f4', name: 'Aprovado pelo cliente', type: 'checkbox', options: [] },
];

describe('campo personalizado: o nome que a pessoa falou vira id real', () => {
  it('dropdown resolve pela OPÇÃO, não pelo texto cru', () => {
    const r = resolverCampoPersonalizado(CAMPOS, 'Etapa', 'Aprovação');
    expect(ehFalhaDeCampo(r)).toBe(false);
    if (!ehFalhaDeCampo(r)) expect(r).toMatchObject({ fieldId: 'f1', value: 'o2', rotulo: 'Aprovação' });
  });

  it('acento e caixa não atrapalham', () => {
    const r = resolverCampoPersonalizado(CAMPOS, 'etapa', 'aprovacao');
    expect(ehFalhaDeCampo(r)).toBe(false);
  });

  it('número vira número', () => {
    const r = resolverCampoPersonalizado(CAMPOS, 'Verba', 'R$ 1.500,50');
    if (!ehFalhaDeCampo(r)) expect(r.value).toBe(1500.5);
  });

  it('checkbox vira booleano', () => {
    const r = resolverCampoPersonalizado(CAMPOS, 'Aprovado pelo cliente', 'sim');
    if (!ehFalhaDeCampo(r)) expect(r.value).toBe(true);
  });

  it('campo que não existe é DECLARADO, com as opções reais — nunca inventado', () => {
    const r = resolverCampoPersonalizado(CAMPOS, 'Carimbo', 'x');
    expect(ehFalhaDeCampo(r)).toBe(true);
    if (ehFalhaDeCampo(r)) expect(explicarFalhaDeCampo(r)).toContain('Etapa');
  });

  it('opção que não existe lista as válidas', () => {
    const r = resolverCampoPersonalizado(CAMPOS, 'Etapa', 'Finalizado');
    expect(ehFalhaDeCampo(r)).toBe(true);
    if (ehFalhaDeCampo(r)) {
      const msg = explicarFalhaDeCampo(r);
      expect(msg).toContain('Briefing');
      expect(msg).toContain('Aprovação');
    }
  });

  it('valor que não é número num campo de moeda é recusado, não zerado', () => {
    const r = resolverCampoPersonalizado(CAMPOS, 'Verba', 'a combinar');
    expect(ehFalhaDeCampo(r)).toBe(true);
  });
});

/**
 * 28/09/2026 — tipos que faltavam. Múltipla escolha e data seguem a
 * documentação do ClickUp; NÃO foram conferidos contra o workspace real
 * porque ele só tem `number` e `short_text` hoje. O que está travado aqui é o
 * FORMATO, que é onde o erro silencioso mora: mandar id solto num campo de
 * múltipla faz o ClickUp aceitar e guardar errado.
 */
const CAMPOS_NOVOS: ClickUpCustomField[] = [
  { id: 'f5', name: 'Etapas', type: 'labels', options: [{ id: 'a', name: 'Briefing' }, { id: 'b', name: 'Aprovação' }] },
  { id: 'f6', name: 'Data de veiculação', type: 'date', options: [] },
];

describe('múltipla escolha e data', () => {
  it('múltipla devolve LISTA de ids, não um id solto', () => {
    const r = resolverCampoPersonalizado(CAMPOS_NOVOS, 'Etapas', 'Briefing, Aprovação');
    expect(ehFalhaDeCampo(r)).toBe(false);
    if (!ehFalhaDeCampo(r)) {
      expect(r.value).toEqual(['a', 'b']);
      expect(r.rotulo).toBe('Briefing, Aprovação');
    }
  });

  it('múltipla com um valor só continua sendo lista', () => {
    const r = resolverCampoPersonalizado(CAMPOS_NOVOS, 'Etapas', 'Briefing');
    if (!ehFalhaDeCampo(r)) expect(r.value).toEqual(['a']);
  });

  it('uma opção inválida no meio reprova o campo inteiro — nada pela metade', () => {
    const r = resolverCampoPersonalizado(CAMPOS_NOVOS, 'Etapas', 'Briefing, Inexistente');
    expect(ehFalhaDeCampo(r)).toBe(true);
    if (ehFalhaDeCampo(r)) expect(explicarFalhaDeCampo(r)).toContain('Inexistente');
  });

  it('data em ISO vira epoch ms', () => {
    const r = resolverCampoPersonalizado(CAMPOS_NOVOS, 'Data de veiculação', '2026-10-05');
    if (!ehFalhaDeCampo(r)) expect(new Date(r.value as number).getDate()).toBe(5);
  });

  it('texto que não é data é RECUSADO — filtro que mente é pior que campo vazio', () => {
    expect(ehFalhaDeCampo(resolverCampoPersonalizado(CAMPOS_NOVOS, 'Data de veiculação', 'amanhã'))).toBe(true);
  });
});
