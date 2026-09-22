import { describe, expect, it } from 'vitest';
import { classifyDeliveryType, sectionsFor } from './briefing-schema';
import { extractLabeledFacts, mergeFacts } from './briefing-facts';
import { composeBriefing, pendingCriticalFields } from './briefing-composer';
import { evaluateBriefing } from './briefing-quality';

/**
 * O briefing que motivou tudo isto dizia "Executar a entrega descrita no
 * título desta task" e foi anexado como se fosse trabalho. Estes testes
 * guardam as duas coisas: que ele REPROVA, e que o briefing novo muda de
 * forma conforme o que está sendo produzido.
 */

const base = {
  taskName: 'Campanha de lançamento',
  clientName: 'Nexa Fit',
  requestedBy: 'QA Bot',
  dueDateLabel: '20/09',
  assignee: 'Ana',
  references: [] as string[],
  requestSummary: 'Lançar a nova unidade com campanha de captação de matrículas',
};

const fatosRicos = [
  { field: 'objetivo', value: 'captar matrículas para a nova unidade', source: 'pedido do usuário' },
  { field: 'publico', value: '25-40 anos, profissionais com pouco tempo', source: 'dossiê do cliente' },
  { field: 'oferta', value: 'primeiro mês por R$49', source: 'comentário da task' },
  { field: 'produto', value: 'academia premium', source: 'dossiê do cliente' },
  { field: 'tom', value: 'sofisticado, energético, sem exagero', source: 'brand kit' },
  { field: 'mensagem', value: 'treino premium que cabe na agenda', source: 'dossiê do cliente' },
  { field: 'cta', value: 'Agende sua aula inaugural', source: 'pedido do usuário' },
  { field: 'canal', value: 'Meta Ads + Instagram', source: 'pedido do usuário' },
  { field: 'entregaveis', value: '3 criativos estáticos + 1 vídeo', source: 'pedido do usuário' },
  { field: 'aprovacao', value: 'aprovação do gestor da unidade antes de subir mídia', source: 'comentário da task' },
];

describe('classificação por tipo de entrega', () => {
  it.each([
    ['campanha de lançamento da nova unidade', 'campaign'],
    ['produzir 3 reels para lançamento', 'video'],
    ['landing page da campanha', 'landing_page'],
    ['automatizar a entrada dos leads no CRM', 'technical'],
    ['post de carrossel para o feed', 'social_content'],
    ['revisar contrato', 'generic'],
  ])('%s -> %s', (texto, esperado) => {
    expect(classifyDeliveryType(texto)).toBe(esperado);
  });

  it('cada tipo tem estrutura DIFERENTE', () => {
    const chaves = (t: Parameters<typeof sectionsFor>[0]) => sectionsFor(t).map((s) => s.key).join(',');
    expect(chaves('technical')).not.toBe(chaves('campaign'));
    expect(chaves('video')).not.toBe(chaves('landing_page'));
  });

  it('briefing técnico NÃO fala de direção visual nem público', () => {
    const chaves = sectionsFor('technical').map((s) => s.key);
    expect(chaves).not.toContain('visual');
    expect(chaves).not.toContain('publico');
    expect(chaves).toContain('tecnico');
  });

  it('briefing de vídeo exige hook e estrutura', () => {
    const campos = sectionsFor('video').flatMap((s) => s.fields.map((f) => f.key));
    expect(campos).toContain('hook');
    expect(campos).toContain('estrutura');
  });

  it('landing page exige seções e critério de conversão', () => {
    const campos = sectionsFor('landing_page').flatMap((s) => s.fields.map((f) => f.key));
    expect(campos).toContain('secoes');
    expect(campos).toContain('conversao');
  });
});

describe('extração de fatos com procedência', () => {
  it('lê rótulos de markdown do dossiê', () => {
    const fatos = extractLabeledFacts('- Público: donos de pet shop\n- Segmento: varejo', 'dossiê');
    expect(fatos).toEqual([
      { field: 'publico', value: 'donos de pet shop', source: 'dossiê', sourceId: null },
      { field: 'produto', value: 'varejo', source: 'dossiê', sourceId: null },
    ]);
  });

  it('ignora placeholder de "não informado" (não é fato)', () => {
    expect(extractLabeledFacts('- Público: `Não informado`\n- Oferta: a definir', 'dossiê')).toEqual([]);
  });

  it('precedência: a primeira fonte declarada vence', () => {
    const merged = mergeFacts(
      [{ field: 'oferta', value: 'R$49', source: 'pedido' }],
      [{ field: 'oferta', value: 'R$99', source: 'dossiê' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toBe('R$49');
  });
});

describe('composição — não inventa, declara pendência', () => {
  it('briefing rico fica executável e específico', () => {
    const b = composeBriefing({ ...base, deliveryType: 'campaign', facts: fatosRicos });
    const ev = evaluateBriefing(b, { clientName: 'Nexa Fit' });
    expect(ev.executable).toBe(true);
    expect(ev.recommendation).toBe('approve');
    expect(b.markdown).toContain('primeiro mês por R$49');
    expect(b.markdown).toContain('25-40 anos');
    expect(ev.dimensions.clientSpecificity).toBeGreaterThan(0.9);
  });

  it('contexto ausente vira PENDENTE, nunca dado inventado', () => {
    const b = composeBriefing({
      ...base,
      taskName: 'Campanha de lançamento do Produto X',
      clientName: 'Produto X',
      deliveryType: 'campaign',
      facts: [{ field: 'objetivo', value: 'lançar o produto', source: 'pedido do usuário' }],
    });
    expect(b.markdown).toContain('PENDENTE DE CONFIRMAÇÃO');
    expect(b.missing).toContain('Público-alvo');
    expect(b.missing).toContain('Oferta');
    // O ponto do teste: nada de público inventado.
    expect(b.markdown).not.toMatch(/\d{2}\s*a\s*\d{2}\s*anos/);
    expect(evaluateBriefing(b).executable).toBe(false);
  });

  it('todo campo preenchido carrega fonte (rastro interno)', () => {
    const b = composeBriefing({ ...base, deliveryType: 'campaign', facts: fatosRicos });
    expect(b.grounded.every((g) => g.source.length > 0)).toBe(true);
    expect(b.grounded.find((g) => g.field === 'oferta')?.source).toBe('comentário da task');
  });

  it('multi-fonte: pedido + comentário + memória + dossiê convivem', () => {
    const b = composeBriefing({
      ...base,
      deliveryType: 'campaign',
      facts: mergeFacts(
        extractLabeledFacts('Objetivo: campanha de aniversário', 'pedido do usuário'),
        extractLabeledFacts('Oferta: 20% de desconto', 'comentário da task'),
        [{ field: 'proibidos', value: 'Preferência de emoji: não usar emojis', source: 'memória do cliente' }],
        extractLabeledFacts('- Público: famílias da região\n- Posicionamento: bairro, afetivo', 'dossiê do cliente'),
      ),
    });
    expect(b.markdown).toContain('20% de desconto');
    expect(b.markdown).toContain('famílias da região');
    expect(b.markdown).toContain('não usar emojis');
    const fontes = new Set(b.grounded.map((g) => g.source));
    expect(fontes.has('pedido do usuário')).toBe(true);
    expect(fontes.has('comentário da task')).toBe(true);
    expect(fontes.has('memória do cliente')).toBe(true);
    expect(fontes.has('dossiê do cliente')).toBe(true);
  });
});

describe('porta anti-genérico do briefing', () => {
  const GENERICO = [
    '# Briefing: QA',
    '## OBJETIVO',
    '- Objetivo principal: Executar a entrega descrita no título desta task, dentro do prazo.',
    '## CONTEXTO',
    '- Situação: Task criada via chat. Detalhes adicionais devem ser complementados pelo solicitante.',
  ].join('\n');

  it('REPROVA o briefing genérico que estava sendo anexado', () => {
    const ev = evaluateBriefing({
      markdown: GENERICO,
      deliveryType: 'generic',
      missingCritical: [],
      missing: [],
      grounded: [
        { field: 'objetivo', source: 'template' },
        { field: 'situacao', source: 'template' },
        { field: 'entregaveis', source: 'template' },
        { field: 'aprovacao', source: 'template' },
      ],
    });
    expect(ev.executable).toBe(false);
    expect(ev.genericSections.length).toBeGreaterThan(0);
    expect(ev.recommendation).toBe('revise');
  });

  it('briefing que é quase só pendência também reprova', () => {
    const b = composeBriefing({ ...base, deliveryType: 'campaign', facts: [] });
    const ev = evaluateBriefing(b);
    expect(ev.executable).toBe(false);
    expect(ev.recommendation).toBe('retrieve_more_context');
  });

  it('recomendação diz o que fazer, não só que está ruim', () => {
    const b = composeBriefing({
      ...base,
      deliveryType: 'campaign',
      facts: fatosRicos.filter((x) => x.field !== 'entregaveis'),
    });
    const ev = evaluateBriefing(b, { clientName: 'Nexa Fit' });
    expect(['revise', 'ask_user', 'retrieve_more_context']).toContain(ev.recommendation);
  });
});

/**
 * BENTO_PRESERVES_USER_BRIEF_CONTENT — regressão do bug real medido em
 * 21/09/2026: a task "Executar briefing — Cliente Teste 7" saiu do pedido
 *
 *   "Bento, crie uma task para o Pedro Gabriel com um briefing de
 *    boas-vindas ao Desigual OS, parabenizando ele pelo esforço."
 *
 * com objetivo/entregáveis/aprovação em [CONFIRMAR] — a mensagem de
 * boas-vindas pedida nunca apareceu na task, embora estivesse escrita, em
 * prosa, no próprio pedido.
 *
 * Causa raiz: `retrieveBriefingContext` só lê fato no formato "Rótulo:
 * valor" (via `extractLabeledFacts`); pedido em prosa não tem essa forma e
 * os campos saem MISSING mesmo respondidos. O guard corrige perguntando ao
 * LLM SÓ pelos campos pendentes, SÓ a partir do pedido, e devolvendo no
 * mesmo formato "campo: valor" — que estes testes simulam aqui sem mockar
 * o guard inteiro, exercitando a mesma composição (`pendingCriticalFields`
 * -> `extractLabeledFacts` -> `mergeFacts` -> `composeBriefing`) que
 * `bento-action-guard.ts` roda de verdade.
 */
describe('BENTO_PRESERVES_USER_BRIEF_CONTENT', () => {
  const PEDIDO =
    'Bento, crie uma task para o Pedro Gabriel com um briefing de boas-vindas ao Desigual OS, parabenizando ele pelo esforço. Use o Cliente Teste 7.';

  const inputSemFatos = {
    taskName: 'Executar briefing — Cliente Teste 7',
    clientName: 'Cliente Teste 7',
    deliveryType: 'generic' as const,
    facts: [] as never[],
    references: [] as string[],
    requestedBy: 'QA Bot',
    dueDateLabel: null,
    assignee: 'Pedro Gabriel',
    requestSummary: PEDIDO,
  };

  it('sem interpretar o pedido, objetivo/entregáveis/aprovação ficam MISSING (reproduz o bug)', () => {
    const gaps = pendingCriticalFields(inputSemFatos);
    const chaves = gaps.map((g) => g.key);
    expect(chaves).toContain('objetivo');
    expect(chaves).toContain('entregaveis');
    expect(chaves).toContain('aprovacao');

    // "Situação" ecoa o pedido cru (comportamento correto e preexistente) —
    // o bug não é a ausência da frase no markdown, é ela não virar OBJETIVO/
    // ENTREGÁVEL/APROVAÇÃO: por isso a task real saía com os três em
    // [CONFIRMAR] apesar do pedido estar, literalmente, ali do lado.
    const b = composeBriefing(inputSemFatos);
    expect(b.missing).toContain('Objetivo principal');
    expect(b.missing).toContain('Peças/arquivos esperados');
    expect(b.missing).toContain('O que define que está pronto');
  });

  it('depois de interpretar o pedido (mesmo pipeline do guard), o conteúdo semântico sobrevive', () => {
    const gaps = pendingCriticalFields(inputSemFatos);
    // Simula a resposta do LLM ao prompt do guard: só os campos pendentes,
    // só o que o pedido determina, no formato "chave: valor".
    const respostaSimuladaDoLLM = [
      'objetivo: dar boas-vindas a Pedro Gabriel ao Desigual OS e reconhecer o esforço dele',
      'entregaveis: mensagem de boas-vindas e reconhecimento enviada a Pedro Gabriel',
      'aprovacao: Pedro Gabriel recebeu e leu a mensagem',
    ].join('\n');
    expect(gaps.map((g) => g.key)).toEqual(expect.arrayContaining(['objetivo', 'entregaveis', 'aprovacao']));

    const interpretados = extractLabeledFacts(respostaSimuladaDoLLM, 'pedido do usuário (interpretado)');
    expect(interpretados.map((f) => f.field)).toEqual(expect.arrayContaining(['objetivo', 'entregaveis', 'aprovacao']));

    const b = composeBriefing({ ...inputSemFatos, facts: mergeFacts(inputSemFatos.facts, interpretados) });
    expect(b.markdown).toMatch(/boas.?vindas/i);
    expect(b.markdown).toMatch(/desigual os/i);
    expect(b.markdown).toMatch(/esfor[çc]o|reconhec/i);
    // Situação (o pedido cru) continua presente — nada foi REMOVIDO, só preenchido.
    expect(b.markdown).toContain(PEDIDO);
    // Cliente e responsável, resolvidos por fato do turno, continuam corretos.
    expect(b.markdown).toContain('Cliente Teste 7');
    expect(b.markdown).toContain('Pedro Gabriel');
    // Nenhum dos três campos que o pedido determinava pode sobrar como pendência.
    expect(b.missing).not.toContain('Objetivo principal');
    expect(b.missing).not.toContain('Peças/arquivos esperados');
    expect(b.missing).not.toContain('O que define que está pronto');
  });

  it('GUARD NÃO SOBRESCREVE: fato já resolvido (ex: por comentário real da task) vence sobre a interpretação do LLM', () => {
    const fatoJaResolvido = [{ field: 'objetivo', value: 'objetivo real vindo do comentário da task', source: 'comentário da task' }];
    const interpretados = extractLabeledFacts('objetivo: um objetivo inventado que não deveria aparecer', 'pedido do usuário (interpretado)');
    // mergeFacts: primeiro grupo vence — o fato já resolvido tem que vir ANTES.
    const b = composeBriefing({ ...inputSemFatos, facts: mergeFacts(fatoJaResolvido, interpretados) });
    expect(b.markdown).toContain('objetivo real vindo do comentário da task');
    expect(b.markdown).not.toContain('um objetivo inventado');
  });

  it('MISSING DATA GENUÍNA: campo que o pedido de fato não determina continua [CONFIRMAR], só ELE', () => {
    // O LLM não devolve linha pra "aprovacao" porque o pedido não fala disso.
    const respostaParcial = ['objetivo: dar boas-vindas a Pedro Gabriel ao Desigual OS'].join('\n');
    const interpretados = extractLabeledFacts(respostaParcial, 'pedido do usuário (interpretado)');
    const b = composeBriefing({ ...inputSemFatos, facts: mergeFacts(inputSemFatos.facts, interpretados) });
    expect(b.markdown).toMatch(/boas.?vindas/i);
    // aprovação e entregáveis continuam pendentes — SÓ eles, não o briefing inteiro.
    expect(b.missing).toContain('O que define que está pronto');
    expect(b.missing).toContain('Peças/arquivos esperados');
    expect(b.missing).not.toContain('Objetivo principal');
    expect(b.markdown).toContain('PENDENTE DE CONFIRMAÇÃO');
  });
});
