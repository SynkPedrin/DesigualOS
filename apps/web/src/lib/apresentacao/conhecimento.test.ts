import { describe, expect, it } from 'vitest';
import { apresentarConhecimento, categoriasPresentes, origemHumana } from './conhecimento';

/**
 * Os doze `kind` abaixo são os que EXISTEM no banco, levantados em 02/10/2026.
 * Se um teste aqui falhar porque surgiu um tipo novo, o mapper precisa de uma
 * decisão — não de um `default` silencioso.
 */
const TIPOS_REAIS = [
  'agent.episode',
  'client.profile',
  'clickup.mention_answered',
  'studio.asset_created',
  'mcp.agency',
  'daily_checklist',
  'mcp.user_private',
  'otto.creative_plan_created',
  'otto.studio_handoff',
  'otto.approval_reason',
  'briefing.rule',
  'otto.feedback',
] as const;

describe('TESTE A — nenhum termo técnico chega à tela', () => {
  it.each(TIPOS_REAIS)('%s não aparece como rótulo', (kind) => {
    const r = apresentarConhecimento({ kind });
    expect(r.categoria).not.toContain('.');
    expect(r.categoria).not.toMatch(/episode|profile|mcp|clickup|studio|otto|briefing|checklist/i);
  });

  it('o tipo desconhecido de amanhã também não vaza', () => {
    const r = apresentarConhecimento({ kind: 'algum.tipo.que.ainda.nao.existe' });
    expect(r.categoria).toBe('Contexto');
    expect(r.categoria).not.toContain('.');
  });
});

describe('client.profile — três coisas diferentes sob o mesmo nome', () => {
  it('o brain curado é Contexto', () => {
    const r = apresentarConhecimento({ kind: 'client.profile', metadata: { subject: 'cliente:abc:brain' } });
    expect(r.categoria).toBe('Contexto');
    expect(r.visivelNoProduto).toBe(true);
  });

  it('o dossiê operacional também é Contexto', () => {
    expect(apresentarConhecimento({ kind: 'client.profile', metadata: { subject: 'cliente:abc:dossie' } }).categoria).toBe(
      'Contexto',
    );
  });

  /**
   * O que a equipe ENSINA no chat é o caso que mais precisa da categoria
   * certa: "o decisor é a Marina" é sobre uma PESSOA, não sobre contexto.
   */
  it('o aprendizado vira categoria pelo aspecto, não pelo kind', () => {
    const decisor = apresentarConhecimento({
      kind: 'client.profile',
      metadata: { subject: 'cliente:abc:aprendizado:decisor', aspect: 'decisor' },
    });
    expect(decisor.categoria).toBe('Pessoas');

    const restricao = apresentarConhecimento({
      kind: 'client.profile',
      metadata: { subject: 'cliente:abc:aprendizado:restricao', aspect: 'restricao' },
    });
    expect(restricao.categoria).toBe('Preferências');

    const contrato = apresentarConhecimento({
      kind: 'client.profile',
      metadata: { subject: 'cliente:abc:aprendizado:contrato', aspect: 'contrato' },
    });
    expect(contrato.categoria).toBe('Processos');
  });

  it('aspecto desconhecido cai em Aprendizados, não em Contexto', () => {
    const r = apresentarConhecimento({
      kind: 'client.profile',
      metadata: { subject: 'cliente:abc:aprendizado:aspectonovo', aspect: 'aspectonovo' },
    });
    expect(r.categoria).toBe('Aprendizados');
  });
});

describe('o que NÃO é conhecimento não entra na tela', () => {
  /**
   * São 238 de ~500 memórias. Deixá-los entrar transformaria a tela de
   * Conhecimento num log de conversas e afogaria os 96 dossiês curados.
   */
  it('agent.episode é registro de turno e fica fora', () => {
    const r = apresentarConhecimento({ kind: 'agent.episode' });
    expect(r.visivelNoProduto).toBe(false);
    expect(r.motivoOculto).toMatch(/turno/i);
  });

  it('anotação privada de uma pessoa fica fora da tela compartilhada', () => {
    const r = apresentarConhecimento({ kind: 'mcp.user_private' });
    expect(r.visivelNoProduto).toBe(false);
    expect(r.motivoOculto).toMatch(/privada/i);
  });

  it('acontecimento pertence à Atividade, não ao Conhecimento', () => {
    for (const k of ['clickup.mention_answered', 'studio.asset_created', 'daily_checklist']) {
      const r = apresentarConhecimento({ kind: k });
      expect(r.visivelNoProduto, k).toBe(false);
      expect(r.motivoOculto, k).toMatch(/Atividade/i);
    }
  });
});

describe('origem em português', () => {
  it.each([
    ['claude', 'Claude'],
    ['claude_mcp', 'Claude'],
    ['clickup_webhook', 'ClickUp'],
    ['chat_message', 'Bento'],
    ['agent', 'Bento'],
    ['vault', 'Sistema'],
  ])('%s vira %s', (tecnico, humano) => {
    expect(origemHumana(tecnico)).toBe(humano);
  });

  it('fonte ausente ou desconhecida vira Sistema, nunca o nome cru', () => {
    expect(origemHumana(null)).toBe('Sistema');
    expect(origemHumana('algum_conector_novo')).toBe('Sistema');
  });
});

describe('categoriasPresentes — o filtro não oferece opção vazia', () => {
  it('lista só as categorias que de fato aparecem', () => {
    const cats = categoriasPresentes([
      { kind: 'client.profile', metadata: { subject: 'cliente:a:brain' } },
      { kind: 'client.profile', metadata: { subject: 'cliente:a:aprendizado:decisor', aspect: 'decisor' } },
      { kind: 'agent.episode' },
      { kind: 'mcp.user_private' },
    ]);
    expect(cats).toEqual(['Contexto', 'Pessoas']);
    expect(cats).not.toContain('Atividade registrada');
  });
});
