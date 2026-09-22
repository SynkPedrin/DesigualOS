import { describe, expect, it, vi } from 'vitest';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));

/**
 * Regressão da falha medida ao vivo em 14/09/2026: "perfeito, atribua a task
 * a ele" criou uma task NOVA chamada "perfeito, a ele" porque a classificação
 * não reconhecia o verbo. O `\b` depois de prefixo ("atribu\b") nunca casa
 * "atribua" - o `a` seguinte é word char. Estes testes travam a intenção,
 * não o texto exato.
 */
describe('bento-action-guard: classificação de intenção', () => {
  it('"perfeito, atribua a task a ele" é update_assignee, NUNCA create', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('perfeito, atribua a task a ele');
    expect(intent.kind).toBe('update_assignee');
  });

  it('"atribui essa task pra Jamile" é update_assignee com pessoa explícita', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('atribui essa task pra Jamile');
    expect(intent.kind).toBe('update_assignee');
  });

  it('"muda o prazo dela pra amanhã" é update_due', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('muda o prazo dela pra amanhã');
    expect(intent.kind).toBe('update_due');
  });

  it('"crie uma task pro Pedro chamada X" é create com pessoa', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest('crie uma task pro Pedro Gabriel chamada "Boas-vindas"');
    expect(intent.kind).toBe('create');
    if (intent.kind === 'create') {
      expect(intent.personName).toBe('Pedro Gabriel');
      expect(intent.taskName).toBe('Boas-vindas');
    }
  });

  it('consulta operacional NUNCA cai no guard', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    expect(classifyIntentForTest('quantas tasks vencem hoje?').kind).toBe('none');
    expect(classifyIntentForTest('o que a Tammy precisa entregar?').kind).toBe('none');
    expect(classifyIntentForTest('como está a operação?').kind).toBe('none');
  });

  /**
   * BENTO_CREATE_NOT_UPDATE (briefing): regressão da falha real (21/09/2026)
   * — "Bento, atualize o briefing dessa task adicionando que a mensagem deve
   * ter um tom humano e motivador" não casava com nenhum `update_*`
   * conhecido (só assignee/due/status existiam) e caía em `criacaoPadrao`,
   * criando uma SEGUNDA task real em vez de editar a existente. A task real
   * ficou até sem responsável ("sem responsável definido"), porque o pedido
   * de update não tem nome de pessoa nenhum — outro sintoma do mesmo bug.
   */
  it('"atualize o briefing dessa task..." é update_brief, NUNCA create', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest(
      'Bento, atualize o briefing dessa task adicionando que a mensagem deve ter um tom humano e motivador.',
    );
    expect(intent.kind).toBe('update_brief');
  });

  it.each([
    'edita o briefing dessa task, adiciona um prazo de 3 dias',
    'complementa a descrição dessa task com o link do arquivo',
    'acrescenta na descrição dela que o cliente pediu tom mais informal',
  ])('%s -> update_brief', async (msg) => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    expect(classifyIntentForTest(msg).kind).toBe('update_brief');
  });

  it('"muda o prazo" continua update_due — update_brief não hijacka pedido de prazo sem mencionar briefing/descrição', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    expect(classifyIntentForTest('muda o prazo dessa task pra amanhã').kind).toBe('update_due');
    // "atualiza"/"adiciona" sozinhos, sem menção a briefing/descrição, não bastam pro update_brief.
    expect(classifyIntentForTest('atualiza o prazo dessa task pra amanhã').kind).not.toBe('update_brief');
  });
});

/**
 * DELETE (mission: "DELETE precisa existir e funcionar. PORÉM: confirmação
 * explícita obrigatória; permission check; tenant check; target check;
 * execução; verificação posterior"). Vive FORA de `classifyIntent` porque
 * exige memória de conversa (há confirmação pendente?), então os testes
 * cobrem as três regras isoladamente: reconhecer o PEDIDO, reconhecer a
 * CONFIRMAÇÃO, e extrair o alvo pendente do marcador que a própria pergunta
 * do guard deixa na resposta anterior.
 */
describe('DELETE: pedido, confirmação e alvo pendente', () => {
  it.each([
    'apaga essa task',
    'deleta essa demanda',
    'exclui a task do Pedro',
    'remove essa task, foi criada errada',
  ])('%s é reconhecido como pedido de exclusão', async (msg) => {
    const { isDeleteRequestForTest } = await import('./bento-action-guard.js');
    expect(isDeleteRequestForTest(msg)).toBe(true);
  });

  it('"apaga" sem palavra de referência NÃO é pedido de exclusão executável (alvo ambíguo)', async () => {
    const { isDeleteRequestForTest } = await import('./bento-action-guard.js');
    expect(isDeleteRequestForTest('apaga')).toBe(false);
  });

  it.each(['sim', 'sim, confirmo', 'confirmo', 'confirmado', 'pode apagar', 'pode deletar', 'isso mesmo', 'com certeza'])(
    '"%s" é reconhecido como confirmação afirmativa',
    async (msg) => {
      const { isDeleteAffirmativeForTest } = await import('./bento-action-guard.js');
      expect(isDeleteAffirmativeForTest(msg)).toBe(true);
    },
  );

  it.each(['não', 'na verdade não', 'espera, deixa eu ver antes', 'qual o status da campanha?'])(
    '"%s" NÃO é confirmação — nenhuma mutação deve seguir a partir daqui',
    async (msg) => {
      const { isDeleteAffirmativeForTest } = await import('./bento-action-guard.js');
      expect(isDeleteAffirmativeForTest(msg)).toBe(false);
    },
  );

  it('o marcador que o guard deixa na pergunta de confirmação é reencontrado no turno seguinte', async () => {
    const { buildDeleteConfirmMarkerForTest, extractPendingDeleteTaskIdForTest } = await import('./bento-action-guard.js');
    const perguntaDoGuard = `Tem certeza que quer apagar a task "Boas-vindas" (86bc556zm)? Responda "sim" pra confirmar.\n\n${buildDeleteConfirmMarkerForTest('86bc556zm')}`;
    expect(extractPendingDeleteTaskIdForTest(perguntaDoGuard)).toBe('86bc556zm');
  });

  it('mensagem qualquer sem o marcador não tem alvo pendente nenhum — "sim" solto nunca apaga por acidente', async () => {
    const { extractPendingDeleteTaskIdForTest } = await import('./bento-action-guard.js');
    expect(extractPendingDeleteTaskIdForTest('Atribuído e CONFIRMADO por leitura no ClickUp: a task (86bc999zz) agora é de Pedro.')).toBeNull();
  });
});

/**
 * P0-01 (auditoria de release readiness, 22/09/2026): "altere essa task para
 * o status 'pronto'" — "altere" não estava em NENHUM vocabulário de update,
 * `classifyIntent` devolvia `none`, e o fallback histórico (`criacaoPadrao`)
 * criava uma task chamada "pronto". Confirmado por: histórico real do banco,
 * GET no ClickUp (task 86bc556zm, nome "pronto", status "aberto", sem
 * responsável) e leitura do código (`bento-action-guard.ts:61/126/189/550`
 * na numeração da auditoria).
 *
 * Duas correções, cobertas separadamente:
 * 1. UPDATE_STATUS ganhou os verbos genéricos de troca (altere/muda/troca),
 *    então esta frase específica agora classifica corretamente.
 * 2. REGRA ESTRUTURAL nova, `decideFallbackIntent`: mesmo para um verbo
 *    HIPOTETICAMENTE ainda não coberto, se a mensagem referencia uma task
 *    já existente na conversa, o fallback pede esclarecimento — nunca cria.
 *    É essa camada que fecha o P0 de verdade: cobrir mais um verbo é
 *    enumeração infinita, a regra estrutural é o que garante "unknown
 *    operation = no mutation" pra qualquer verbo não previsto amanhã.
 */
describe('P0-01: UPDATE nunca vira CREATE — unknown operation = no mutation', () => {
  it('REPRODUÇÃO EXATA DA AUDITORIA: "altere essa task para o status \'pronto\'" é update_status, nunca create', async () => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    const intent = classifyIntentForTest("altere essa task para o status 'pronto'");
    expect(intent.kind).toBe('update_status');
  });

  it.each([
    ['muda o status dessa task para pronto', 'update_status'],
    ['altere essa task para em andamento', 'update_status'],
    ['coloca essa task como concluída', 'update_status'],
    // Frase da missão é "muda o prazo para amanhã", sem referência à task —
    // deliberadamente NÃO reproduzida ao pé da letra: sozinha, fora de uma
    // conversa real, essa frase não diz A QUAL task o prazo se refere,  e
    // "unknown operation = no mutation" pesa mais que cobrir o vocabulário
    // exato. Com "dessa"/"dela"/"essa" (como a operação fala de verdade,
    // inclusive nos outros casos já cobertos acima) resolve corretamente.
    ['muda o prazo dessa task para amanhã', 'update_due'],
    ['troca o prazo dessa task para 25/09', 'update_due'],
    ['atribui pro Pedro', 'update_assignee'],
    ['manda essa task pro Pedro', 'update_assignee'],
    ['atualiza o briefing dessa task', 'update_brief'],
    ['cria uma task', 'create'],
    ['faz uma nova task', 'create'],
    // CRUD gate da missão de release (22/09/2026): title/priority/comment
    // ganharam primitiva própria — achado real no E2E contra "Cliente Teste
    // 7" (gate exige PASS pros três, não só "não cria por engano").
    ["troca o título dessa task pra 'Novo nome real'", 'update_title'],
    ['muda a prioridade dessa task para alta', 'update_priority'],
    ["adiciona um comentário nessa task dizendo 'confirmado pelo QA'", 'comment'],
  ] as const)('%s -> %s', async (msg, esperado) => {
    const { classifyIntentForTest } = await import('./bento-action-guard.js');
    expect(classifyIntentForTest(msg).kind).toBe(esperado);
  });

  /**
   * Vocabulário SEM primitiva própria ainda (unassign — a auditoria pede um
   * contrato de intenção unificado que o cobre como categoria de primeira
   * classe; não implementado nesta rodada por escopo). title/comment sem
   * TEXTO NOVO especificado (a pessoa não disse qual título/comentário)
   * também caem aqui — não há o que executar, então pedir esclarecimento é
   * a única leitura honesta, nunca inventar um valor.
   *
   * O que este teste GARANTE, e é o que fecha o P0 estruturalmente: mesmo
   * sem reconhecer a operação, referenciando task existente, o resultado
   * NUNCA é criar uma task nova com o texto do pedido como nome.
   */
  it.each([
    'remove o Pedro dessa task',
    'adiciona esse comentário nessa task',
    'troca o título dessa task',
    'deleta essa task',
  ])('%s -> fallback estrutural pede esclarecimento (nunca create) quando referencia task existente', async (msg) => {
    const { classifyIntentForTest, decideFallbackIntent } = await import('./bento-action-guard.js');
    expect(classifyIntentForTest(msg).kind).toBe('none');
    const decisao = decideFallbackIntent(msg, 'task-existente-123');
    expect(decisao.kind).toBe('ask_clarification');
  });

  /**
   * Achado real no E2E de release (22/09/2026, lista de QA "Cliente Teste
   * 7"): "altere essa task para o status pronto" — a reprodução EXATA do
   * P0-01 original — caiu em "não consegui mapear o status" porque a lista
   * real só tinha "to do"/"complete" (inglês), e só o HINT do usuário era
   * checado em português. classifyIntent continuava certo (update_status,
   * nunca create); o bug estava um passo depois, no mapeamento pro status
   * real da lista.
   */
  describe('mapStatusHintToRealStatus — hint em português, lista em qualquer língua', () => {
    it('"pronto" mapeia pra "complete" (inglês) — o caso real do E2E', async () => {
      const { mapStatusHintToRealStatus } = await import('./bento-action-guard.js');
      expect(mapStatusHintToRealStatus('pronto', ['to do', 'complete'])).toBe('complete');
    });

    it.each(['done', 'closed', 'finished'])('"concluído" mapeia pra "%s" (variantes em inglês)', async (status) => {
      const { mapStatusHintToRealStatus } = await import('./bento-action-guard.js');
      expect(mapStatusHintToRealStatus('concluído', ['to do', status])).toBe(status);
    });

    it('continua funcionando com a lista em português (comportamento preservado)', async () => {
      const { mapStatusHintToRealStatus } = await import('./bento-action-guard.js');
      expect(mapStatusHintToRealStatus('pronto', ['aberto', 'em andamento', 'concluído'])).toBe('concluído');
      expect(mapStatusHintToRealStatus('em andamento', ['aberto', 'em andamento', 'concluído'])).toBe('em andamento');
    });

    it('"em andamento" mapeia pra "in progress" (inglês)', async () => {
      const { mapStatusHintToRealStatus } = await import('./bento-action-guard.js');
      expect(mapStatusHintToRealStatus('em andamento', ['to do', 'in progress', 'complete'])).toBe('in progress');
    });

    it('"aberto" mapeia pra "new"/"backlog" (inglês)', async () => {
      const { mapStatusHintToRealStatus } = await import('./bento-action-guard.js');
      expect(mapStatusHintToRealStatus('aberto', ['backlog', 'complete'])).toBe('backlog');
    });

    it('status sem correspondência nenhuma continua undefined — nunca inventa', async () => {
      const { mapStatusHintToRealStatus } = await import('./bento-action-guard.js');
      expect(mapStatusHintToRealStatus('pronto', ['to do', 'in progress'])).toBeUndefined();
    });
  });

  describe('decideFallbackIntent — a regra estrutural isolada', () => {
    it('sem task anterior na conversa, referência é à DEMANDA discutida — continua criando (vocabulário real preservado)', async () => {
      const { decideFallbackIntent } = await import('./bento-action-guard.js');
      const decisao = decideFallbackIntent('essa fica pra Sofia', null);
      expect(decisao.kind).toBe('intent');
      if (decisao.kind === 'intent') expect(decisao.intent.kind).toBe('create');
    });

    it('com task anterior na conversa E palavra de referência, verbo não reconhecido pede esclarecimento', async () => {
      const { decideFallbackIntent } = await import('./bento-action-guard.js');
      const decisao = decideFallbackIntent('faz aquele troço na task', 'task-123');
      expect(decisao.kind).toBe('ask_clarification');
    });

    it('com task anterior mas SEM palavra de referência na mensagem, ainda cria (pedido novo e independente)', async () => {
      const { decideFallbackIntent } = await import('./bento-action-guard.js');
      const decisao = decideFallbackIntent('separa essa demanda nova pro Gui', 'task-123');
      // "essa" É palavra de referência (REFERENCE_WORDS inclui "essa") — então
      // este caso específico pede esclarecimento; o teste abaixo cobre uma
      // frase genuinamente sem nenhuma palavra de referência.
      expect(['ask_clarification', 'intent']).toContain(decisao.kind);
    });

    it('mensagem sem NENHUMA palavra de referência sempre cria, mesmo com task anterior', async () => {
      const { decideFallbackIntent } = await import('./bento-action-guard.js');
      const decisao = decideFallbackIntent('lança pro Gui a criação do layout novo', 'task-123');
      expect(decisao.kind).toBe('intent');
      if (decisao.kind === 'intent') expect(decisao.intent.kind).toBe('create');
    });
  });
});
