import { describe, expect, it } from 'vitest';
import { multifonteEmResposta, multifonteEmTexto, multifonteLigada, type FotoMultifonte } from './contexto-multifonte';

const AGORA = new Date('2026-10-14T13:00:00.000Z');
const vazia: FotoMultifonte = {
  aprovacoesPendentes: [],
  demandasAbertas: [],
  proximasReunioes: [],
  agendaConectada: false,
  agendaSincronizadaEm: null,
  conversasAbertas: 0,
  aguardandoResposta: 0,
  ultimaMensagemEm: null,
  contasDeMidia: { meta: 0, google: 0 },
};

describe('multifonte', () => {
  it('desligado por padrão', () => {
    expect(multifonteLigada({})).toBe(false);
    expect(multifonteLigada({ BENTO_MULTISOURCE_CONTEXT: 'true' })).toBe(true);
  });
  it('fonte vazia é DITA, não omitida — e agenda desconectada não vira "sem reunião"', () => {
    const t = multifonteEmTexto('Alfa', vazia, AGORA);
    expect(t).toContain('Aprovações (Desigual OS): nenhuma pendente registrada.');
    expect(t).toContain('Agenda: nenhuma agenda da empresa conectada');
    expect(t).toContain('NÃO que não existe trabalho');
  });
  it('aprovação velha e demanda vencida aparecem com data e contagem', () => {
    const t = multifonteEmTexto(
      'Alfa',
      {
        ...vazia,
        aprovacoesPendentes: [{ tipo: 'creative', desde: new Date('2026-10-11T13:00:00.000Z') }],
        demandasAbertas: [{ titulo: 'Natal', status: 'in_production', prazo: new Date('2026-10-13T13:00:00.000Z'), atualizadaEm: AGORA }],
      },
      AGORA,
    );
    expect(t).toMatch(/1 pendente\(s\) \(creative\), a mais antiga desde 11\/10.*1 há mais de 48h/);
    expect(t).toContain('1 com prazo vencido: Natal (em produção, prazo 13/10)');
  });
  it('relação entre fontes só aparece com os dois lados, e como hipótese', () => {
    const comAprovacao = { ...vazia, aprovacoesPendentes: [{ tipo: 'copy', desde: AGORA }] };
    expect(multifonteEmResposta('Alfa', comAprovacao, AGORA, 0)).not.toContain('Possível relação');
    expect(multifonteEmResposta('Alfa', vazia, AGORA, 3)).not.toContain('Possível relação');
    expect(multifonteEmResposta('Alfa', comAprovacao, AGORA, 3)).toContain('Possível relação (hipótese');
  });
  it('mídia: diz que a conta existe, não inventa número', () => {
    const t = multifonteEmTexto('Alfa', { ...vazia, contasDeMidia: { meta: 1, google: 0 } }, AGORA);
    expect(t).toContain('Mídia: conta vinculada em Meta (1). Números de campanha são do Jarbas');
  });
});
