import { describe, expect, it } from 'vitest';
import { formatCampaignBlock } from './campaign-context';

/**
 * Regressões do caso relatado em 16/09/2026: pediram legenda para a "campanha
 * de aniversário do Jardim Europa 5" e o Otto entregou peça do Jardim do Lago.
 */
describe('formatCampaignBlock', () => {
  const campanha = {
    id: 'cmp1',
    clientId: 'cli1',
    canonicalName: 'Europa V',
    status: 'active',
    taskCount: 253,
    openTaskCount: 17,
    lastSourceUpdateAt: new Date('2026-09-16T10:00:00Z'),
    recentTasks: [
      { id: 't1', name: 'Cosentino_Europa V_Campanha de Aniversário_Motion', status: 'aberto', closed: false, updatedAt: null },
      { id: 't2', name: 'Cosentino_Europa V_Campanha de Aniversário_Card Estático', status: 'pronto', closed: true, updatedAt: null },
    ],
  };

  it('otto_retrieves_latest_campaign_context: entrega o que já existe na campanha', () => {
    const b = formatCampaignBlock(
      { campanha, ambiguas: [], foraDoEscopo: [], citouCampanha: true },
      { campanhaDe: 'Cosentino' },
    );
    expect(b).toContain('Europa V');
    expect(b).toContain('Cosentino');
    expect(b).toContain('ATIVA');
    expect(b).toContain('Campanha de Aniversário_Motion');
    expect(b).toContain('2026-09-16');
    // Regressão: com o contexto em mãos, o agente ainda devolvia lista de
    // campanhas e pedia para escolher. Campanha resolvida não é pergunta.
    expect(b).toMatch(/J[ÁA] EST[ÁA] RESOLVIDA/);
    expect(b).toMatch(/n[ãa]o pergunte qual/i);
  });

  it('otto_does_not_improvise_when_specific_context_exists', () => {
    const b = formatCampaignBlock(
      { campanha: null, ambiguas: [], foraDoEscopo: [], citouCampanha: true },
      {},
    );
    expect(b).toContain('NÃO ENCONTRADA');
    expect(b).toMatch(/N[ÃA]O invente/i);
    expect(b).toMatch(/peça genérica de marca/i);
  });

  it('otto_does_not_mix_campaigns_between_clients', () => {
    const b = formatCampaignBlock(
      { campanha: null, ambiguas: [], foraDoEscopo: [{ canonicalName: 'Europa V', clientId: 'outro' }], citouCampanha: true },
      { foraDoEscopo: { outro: 'Cosentino' } },
    );
    expect(b).toContain('PERTENCE A OUTRO CLIENTE');
    expect(b).toContain('Cosentino');
    expect(b).toMatch(/N[ÃA]O use o contexto dela/i);
  });

  it('campanha ambígua vira pergunta, não escolha', () => {
    const b = formatCampaignBlock(
      { campanha: null, ambiguas: [{ canonicalName: 'Aniversário', clientId: 'a' }, { canonicalName: 'Aniversário', clientId: 'b' }], foraDoEscopo: [], citouCampanha: true },
      {},
    );
    expect(b).toContain('AMBÍGUA');
    expect(b).toMatch(/PERGUNTE qual/i);
  });

  it('campanha histórica não é apresentada como ativa', () => {
    const b = formatCampaignBlock(
      { campanha: { ...campanha, status: 'historical', openTaskCount: 0 }, ambiguas: [], foraDoEscopo: [], citouCampanha: true },
      {},
    );
    expect(b).toContain('HISTÓRICA');
    expect(b).not.toContain('ATIVA');
  });

  it('turno que não cita campanha não ganha bloco nenhum', () => {
    expect(formatCampaignBlock({ campanha: null, ambiguas: [], foraDoEscopo: [], citouCampanha: false }, {})).toBe('');
  });
});
