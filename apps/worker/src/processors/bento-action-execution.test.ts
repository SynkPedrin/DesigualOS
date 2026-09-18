import { describe, expect, it, vi } from 'vitest';
import { classifyActionIntent } from './action-intent';
import { buildOperationalActionPlan } from './operational-action-plan';
import { chavesDoCliente, mensagemCitaCliente } from './write-target';
import { blocoDeReferencias, createOneTask, createManyTasks, type CreateDeps, type CreateOneInput, type TaskAttachment } from './multi-create-executor';
import { bentoWriteAllowlist, podeEscreverNoCanary } from './bento-action-guard';
import { afirmaTerEscrito, houveEscritaBemSucedida } from './agentic-dispatch';
import type { PlannedTask } from './operational-action-plan';

vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));

/**
 * REGRESSÃO DO CASO REAL (Tammy, 17/09/2026, conversa ebbe9509).
 *
 * Ela colou a solicitação de placas do cliente e escreveu, três vezes:
 * "Bento, tenho a solicitação acima. Preciso que separe a demanda e lance pro
 * Gui a criação do layout, no Clickup, na lista da D Carvalho."
 *
 * O trace de produção mostrou o plano com o passo "executar a escrita no
 * ClickUp" CONCLUÍDO, `actions: []`, e uma única tool chamada no turno:
 * `agent:bento`. A resposta inventou uma fila de vagas e não criou nada. Estes
 * testes travam cada elo dessa cadeia.
 */

const CASO_REAL = `precisamos desenvolver algumas placas seguindo o padrão visual e as diretrizes do MIV, que também vou encaminhar para vocês utilizarem como base na criação.
Precisamos das seguintes placas:
Placa “Estacione de Ré”;
Placa “Estacionamento Clientes”;
Placa “Estacionamento Diretoria”;
Placa de orientação em formato de mapa, utilizando como base o mapa encaminhado em arquivo.

Bento, tenho a solicitação acima. Preciso que separe a demanda e lance pro Gui a criação do layout, no Clickup, na lista da D Carvalho.`;

describe('explicit_create_request_generates_action_plan', () => {
  it('o caso real autoriza escrita — era READ_ONLY em produção', () => {
    const i = classifyActionIntent(CASO_REAL);
    expect(i.writeAuthorized).toBe(true);
    expect(i.kind).toBe('ACTION_REQUEST');
  });

  it('previous_request_above_is_recovered: a ordem está no ÚLTIMO parágrafo', () => {
    // O classificador lia só o primeiro parágrafo (texto colado do cliente).
    const soOTextoDoCliente = CASO_REAL.split('\n\n')[0]!;
    expect(classifyActionIntent(soOTextoDoCliente).writeAuthorized).toBe(false);
    expect(classifyActionIntent(CASO_REAL).writeAuthorized).toBe(true);
  });

  it('create_task_intent_does_not_become_analysis', () => {
    const plano = buildOperationalActionPlan(CASO_REAL);
    expect(plano.tasks.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * MUDANÇA DE COMPORTAMENTO (Action Intent V2): a solicitação enumera quatro
   * placas, então o plano tem QUATRO demandas, não uma chamada "placas".
   * Uma task só pelas quatro esconde progresso parcial, impede dividir entre
   * pessoas e faz uma placa travada travar as outras três.
   */
  it('as quatro placas do caso real viram quatro ações', () => {
    const plano = buildOperationalActionPlan(CASO_REAL);
    expect(plano.tasks).toHaveLength(4);
    expect(plano.tasks.every((t) => t.assigneeName === 'Gui')).toBe(true);
    expect(plano.tasks.map((t) => t.item)).toEqual([
      'Placa “Estacione de Ré”',
      'Placa “Estacionamento Clientes”',
      'Placa “Estacionamento Diretoria”',
      'Placa de orientação em formato de mapa, utilizando como base o mapa encaminhado em arquivo.',
    ]);
  });
});

describe('explicit_assignee_is_resolved / does_not_become_missing_assignee', () => {
  it('"lance pro Gui" carrega o responsável no plano', () => {
    const plano = buildOperationalActionPlan(CASO_REAL);
    expect(plano.tasks[0]!.assigneeName).toBe('Gui');
  });

  it('o nome do CLIENTE não vira candidato a responsável', () => {
    // "na lista da D Carvalho" é destino de lista, não pessoa.
    const plano = buildOperationalActionPlan('lance pro Gui o layout, na lista da D Carvalho');
    expect(plano.tasks.map((t) => t.assigneeName)).toEqual(['Gui']);
  });

  it.each([
    ['essa fica pra Sofia', 'Sofia'],
    ['essa demanda é do Matheus', 'Matheus'],
    ['deixa pro Gui tocar', 'Gui'],
    ['coloca pro Gui', 'Gui'],
  ])('%s -> responsável %s', (msg, esperado) => {
    expect(classifyActionIntent(msg).writeAuthorized).toBe(true);
    expect(buildOperationalActionPlan(msg).tasks[0]!.assigneeName).toBe(esperado);
  });
});

describe('explicit_client_resolves_from_message', () => {
  it.each(['na lista da D Carvalho', 'na lista da D. Carvalho', 'joga na d carvalho', 'na lista da DCarvalho'])(
    '%s casa com o cliente cadastrado "D. Carvalho"',
    (msg) => {
      expect(mensagemCitaCliente(msg, 'D. Carvalho')).toBe(true);
    },
  );

  it('a chave sem espaço só existe pra nome composto', () => {
    expect(chavesDoCliente('D. Carvalho')).toContain('dcarvalho');
    expect(chavesDoCliente('Elite')).toEqual(['elite']);
  });

  it('não casa cliente parecido por acidente', () => {
    expect(mensagemCitaCliente('relatório da Colpar', 'D. Carvalho')).toBe(false);
  });
});

describe('tammy_language: o vocabulário real da operação vira ação', () => {
  it.each([
    'cria isso pro Gui',
    'separa e lança pro Gui',
    'faz uma task disso',
    'essa fica pra Sofia',
    'joga isso na D Carvalho',
    'faz o briefing e cria lá',
    'essa demanda é do Matheus',
    'cria uma pro layout e outra pro texto',
    'o arquivo eu mando depois, já cria',
    'deixa pro Gui tocar',
    'coloca isso no ClickUp',
    'separa essa demanda',
    'lança isso no ClickUp',
    'faz o briefing',
    'cria uma demanda pra isso',
    'joga na lista da D Carvalho',
  ])('%s -> AÇÃO', (m) => {
    expect(classifyActionIntent(m).writeAuthorized).toBe(true);
  });

  it.each([
    'quantas tarefas o Gui tem?',
    'quem está sobrecarregado?',
    'analisa essas peças',
    'me diga se devemos criar uma task pra isso',
    'vale a pena criar uma task pra isso?',
    'me faz uma análise',
    'dá uma olhada nas peças e me fala',
  ])('%s -> ANÁLISE, nunca escrita', (m) => {
    expect(classifyActionIntent(m).writeAuthorized).toBe(false);
  });
});

describe('multi_action_request_generates_multiple_actions', () => {
  it('layout pro Gui e texto pra Sofia geram DUAS tasks', () => {
    const p = buildOperationalActionPlan('Separa essa demanda. Layout fica com Gui e texto com Sofia. Cria os dois com briefing.');
    expect(p.tasks).toHaveLength(2);
    expect(p.tasks.map((t) => [t.deliverable, t.assigneeName])).toEqual([
      ['layout', 'Gui'],
      ['texto', 'Sofia'],
    ]);
  });

  it('"briefing" não é uma task separada: é conteúdo da task', () => {
    const p = buildOperationalActionPlan('cria o layout pro Gui com briefing');
    expect(p.tasks.map((t) => t.deliverable)).toEqual(['layout']);
  });

  it('o mesmo par dito duas vezes é UMA demanda', () => {
    const p = buildOperationalActionPlan('cria o layout pro Gui. o layout é do Gui mesmo.');
    expect(p.tasks).toHaveLength(1);
  });
});

describe('missing_asset_does_not_block_task_creation', () => {
  it('"o arquivo eu mando depois" vira pendência, não recusa', () => {
    const p = buildOperationalActionPlan('Pode criar pro Gui. O arquivo da arte eu mando depois.');
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]!.assigneeName).toBe('Gui');
    expect(p.pendencies.length).toBeGreaterThan(0);
  });

  it('o caso real declara pendência de material e mesmo assim planeja as tasks', () => {
    const p = buildOperationalActionPlan(CASO_REAL);
    expect(p.pendencies.length).toBeGreaterThan(0);
    expect(p.tasks).toHaveLength(4);
    expect(p.items.length).toBe(4);
  });
});

describe('workload_does_not_block_without_policy', () => {
  it('não existe no plano nenhum bloqueio derivado de carga', () => {
    const p = buildOperationalActionPlan('cria essa pro Gui');
    expect(p.tasks).toHaveLength(1);
    // O plano é derivado do PEDIDO; carga do responsável não é insumo dele.
    expect(JSON.stringify(p)).not.toMatch(/fila|vaga|capacidade|limite/i);
  });
});

describe('complete/close/resolve são NEGADOS', () => {
  it.each([
    'marca como concluído',
    'conclui essa task',
    'finaliza isso',
    'fecha a task do Gui',
    'dá como pronto',
  ])('%s -> FORBIDDEN_ACTION', (m) => {
    const i = classifyActionIntent(m);
    expect(i.kind).toBe('FORBIDDEN_ACTION');
    expect(i.writeAuthorized).toBe(false);
  });

  it('perguntar se deve fechar continua sendo pergunta, não recusa', () => {
    expect(classifyActionIntent('devemos fechar essa task?').kind).toBe('SUGGESTION');
  });

  it('"marca como urgente" NÃO é conclusão: segue sendo escrita normal', () => {
    expect(classifyActionIntent('marca essa task como urgente').kind).toBe('ACTION_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// EXECUTOR: permissão, idempotência, read-back e execução parcial.
// ---------------------------------------------------------------------------

const CONFIG = { apiKey: 'k', teamId: 't' };
const REQUESTER = { name: 'tammy', clickUpEmail: null };
const PLANNED: PlannedTask = { deliverable: 'layout', assigneeName: 'Gui', excerpt: 'criação do layout' };

function entrada(over: Partial<CreateOneInput> = {}): CreateOneInput {
  return { planned: PLANNED, title: 'Criar layout das placas — D. Carvalho', briefing: null, description: 'd', dueDate: null, ...over };
}

function deps(over: Partial<CreateDeps> = {}): CreateDeps {
  return {
    resolveMember: vi.fn(async () => ({ status: 'resolved' as const, member: { id: 7, email: 'g@x', username: 'Gui Silva', profilePicture: null, initials: null, color: null }, matchedBy: 'first_name' as const })),
    listTasks: vi.fn(async () => ({ tasks: [] })),
    createTask: vi.fn(async () => ({ id: 'abc123', url: 'https://app.clickup.com/t/abc123', assigned: false })),
    assign: vi.fn(async () => undefined),
    comment: vi.fn(async () => ({ id: 'c1' })),
    readTask: vi.fn(async () => ({ id: 'abc123', name: 'Criar layout das placas — D. Carvalho', status: 'aberto', assignees: [{ id: 7, username: 'Gui Silva' }], dueDate: null, description: '', attachments: [] })),
    uploadAttachment: vi.fn(async () => ({ id: 'att1' })),
    readComments: vi.fn(async () => [{ id: 'c1', text: 'briefing' }]),
    readListId: vi.fn(async () => 'L1'),
    ...over,
  } as unknown as CreateDeps;
}

describe('create_task_requires_readback', () => {
  it('cria, atribui e CONFIRMA por leitura', async () => {
    const d = deps();
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('created');
    expect(r.verified).toBe(true);
    expect(r.listAsserted).toBe(true);
    expect(r.assigneeUsername).toBe('Gui Silva');
    expect(d.readTask).toHaveBeenCalled();
  });

  it('failed_readback_does_not_claim_success: divergência aparece nos mismatches', async () => {
    const d = deps({
      readTask: vi.fn(async () => ({ id: 'abc123', name: 'OUTRO NOME', status: 'aberto', assignees: [], dueDate: null })) as unknown as CreateDeps['readTask'],
    });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.verified).toBe(false);
    expect(r.mismatches.length).toBeGreaterThan(0);
  });

  it('read-back que nem consegue ler NÃO vira confirmação', async () => {
    const d = deps({ readTask: vi.fn(async () => { throw new Error('502'); }) as unknown as CreateDeps['readTask'] });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.verified).toBe(false);
  });
});

describe('create_task_is_idempotent', () => {
  it('task com o mesmo nome já aberta na lista NÃO duplica', async () => {
    const d = deps({
      listTasks: vi.fn(async () => ({ tasks: [{ id: 'ja1', name: 'Criar layout das placas — D. Carvalho', createdAt: Date.now() - 60_000 }] })) as unknown as CreateDeps['listTasks'],
    });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('duplicate');
    expect(r.taskId).toBe('ja1');
    expect(d.createTask).not.toHaveBeenCalled();
  });
});

describe('assignee resolution bloqueia por motivo REAL', () => {
  it('pessoa não encontrada bloqueia a task e diz por quê', async () => {
    const d = deps({ resolveMember: vi.fn(async () => ({ status: 'not_found' as const, candidates: [] })) as unknown as CreateDeps['resolveMember'] });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('blocked');
    expect(r.blockedBy).toBe('PERSON_NOT_FOUND');
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it('pessoa ambígua devolve os candidatos, não escolhe', async () => {
    const d = deps({
      resolveMember: vi.fn(async () => ({
        status: 'ambiguous' as const,
        candidates: [{ id: 1, username: 'Gui Silva' }, { id: 2, username: 'Gui Ramos' }],
      })) as unknown as CreateDeps['resolveMember'],
    });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.blockedBy).toBe('PERSON_AMBIGUOUS');
    expect(r.candidates).toEqual(['Gui Silva', 'Gui Ramos']);
  });

  it('sem pessoa citada, cria sem responsável em vez de travar', async () => {
    const d = deps();
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ planned: { ...PLANNED, assigneeName: null } }), d);
    expect(r.status).toBe('created');
    expect(r.assigneeId).toBeNull();
    expect(d.resolveMember).not.toHaveBeenCalled();
  });
});

describe('partial_execution_executes_safe_actions', () => {
  it('uma resolvida e uma ambígua: a primeira é CRIADA, a segunda vira pergunta', async () => {
    const resolveMember = vi.fn(async (_c: unknown, nome: string) =>
      nome === 'Gui'
        ? { status: 'resolved' as const, member: { id: 7, username: 'Gui Silva' }, matchedBy: 'first_name' as const }
        : { status: 'ambiguous' as const, candidates: [{ id: 1, username: 'Sofia A' }, { id: 2, username: 'Sofia B' }] },
    );
    const d = deps({ resolveMember: resolveMember as unknown as CreateDeps['resolveMember'] });
    const r = await createManyTasks(CONFIG, 'L1', REQUESTER, [
      entrada({ planned: { deliverable: 'layout', assigneeName: 'Gui', excerpt: 'x' }, title: 'Criar layout — X' }),
      entrada({ planned: { deliverable: 'texto', assigneeName: 'Sofia', excerpt: 'y' }, title: 'Criar texto — X' }),
    ], d);
    expect(r[0]!.status).toBe('created');
    expect(r[1]!.status).toBe('blocked');
    expect(r[1]!.blockedBy).toBe('PERSON_AMBIGUOUS');
  });
});

describe('falha do ClickUp não vira "criei"', () => {
  it('erro na criação devolve failed com o motivo', async () => {
    const d = deps({ createTask: vi.fn(async () => { throw new Error('ClickUp recusou (400)'); }) as unknown as CreateDeps['createTask'] });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('ClickUp recusou');
    expect(r.taskId).toBeNull();
  });
});

describe('a resposta não pode AFIRMAR escrita sem escrita', () => {
  it.each(['Criei a task pro Gui.', 'Task criada e atribuída.', 'Já lancei no ClickUp.'])('%s afirma escrita', (t) => {
    expect(afirmaTerEscrito(t)).toBe(true);
  });

  it.each(['Posso criar essa task pro Gui.', 'Seria bom criar uma task.', 'Vou criar assim que confirmar.'])(
    '%s NÃO é afirmação de fato',
    (t) => {
      expect(afirmaTerEscrito(t)).toBe(false);
    },
  );

  it('só tool de escrita bem-sucedida conta como escrita', () => {
    expect(houveEscritaBemSucedida([{ tool: 'agent:bento', ok: true }])).toBe(false);
    expect(houveEscritaBemSucedida([{ tool: 'clickup.create_task', ok: false }])).toBe(false);
    expect(houveEscritaBemSucedida([{ tool: 'clickup.create_task', ok: true }])).toBe(true);
  });
});

/**
 * O outro lado da moeda: ampliar o vocabulário de ação NÃO pode transformar
 * texto colado de cliente em ordem. A regra do trecho de instrução é o que
 * separa as duas coisas — o parágrafo que endereça o agente manda.
 */
describe('texto colado não vira ordem', () => {
  const EMAIL = 'O cliente mandou: precisamos criar 3 posts essa semana.';

  it('e-mail colado sem endereçar ninguém não autoriza escrita', () => {
    expect(classifyActionIntent(`${EMAIL}\n\nAtenciosamente, Marina`).writeAuthorized).toBe(false);
  });

  it('e-mail colado + PERGUNTA ao Bento continua análise', () => {
    expect(classifyActionIntent(`${EMAIL}\n\nBento, o que você acha dessa demanda?`).writeAuthorized).toBe(false);
  });

  it('e-mail colado + ORDEM ao Bento autoriza escrita', () => {
    expect(classifyActionIntent(`${EMAIL}\n\nBento, lança isso pro Gui no ClickUp.`).writeAuthorized).toBe(true);
  });

  it.each([
    'quantas demandas a Alicia tem pra hoje?',
    'quem é o atendimento responsável pela conta da D Carvalho?',
    'quando se encerra o contrato da DCarvalho?',
    'ontem eu criei uma task pro Gui e ele já entregou',
  ])('%s -> consulta, nunca escrita', (m) => {
    expect(classifyActionIntent(m).writeAuthorized).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FASE 1 — CONTINUIDADE DE ANEXO.
// A Tammy manda print. O arquivo chegava na mensagem e morria ali: a task
// nascia sem o único material que o designer precisava abrir.
// ---------------------------------------------------------------------------

const PRINT: TaskAttachment = {
  url: 'https://storage.example/chat-uploads/1789672634699-Captura.png',
  filename: 'Captura de Tela 2026-09-17.png',
  contentType: 'image/png',
};
const MIV: TaskAttachment = { url: 'https://storage.example/miv.pdf', filename: 'MIV.pdf', contentType: 'application/pdf' };

/** Task relida que reflete o corpo escrito e os anexos que o ClickUp aceitou. */
function readTaskCom(descricao: string, anexos: Array<{ title: string }> = []) {
  return vi.fn(async () => ({
    id: 'abc123',
    name: 'Criar layout das placas — D. Carvalho',
    status: 'aberto',
    assignees: [{ id: 7, username: 'Gui Silva' }],
    dueDate: null,
    description: descricao,
    attachments: anexos.map((a) => ({ id: 'x', title: a.title, url: 'u' })),
  })) as unknown as CreateDeps['readTask'];
}

describe('attachment_url_is_present_in_description_or_comment', () => {
  it('o bloco de referências nomeia arquivo e URL', () => {
    const bloco = blocoDeReferencias([PRINT, MIV]);
    expect(bloco).toContain('REFERÊNCIAS / MATERIAIS');
    expect(bloco).toContain(PRINT.url);
    expect(bloco).toContain(MIV.filename);
  });

  it('material de turno anterior é marcado como tal', () => {
    expect(blocoDeReferencias([{ ...PRINT, fromPreviousTurn: true }])).toContain('enviado na solicitação anterior');
  });

  it('a descrição da task criada carrega a URL', async () => {
    const d = deps();
    await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ attachments: [PRINT] }), d);
    const body = (d.createTask as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { description: string };
    expect(body.description).toContain(PRINT.url);
  });
});

describe('previous_attachment_is_preserved_in_created_task', () => {
  it('anexo do turno anterior chega na task', async () => {
    const anterior: TaskAttachment = { ...PRINT, fromPreviousTurn: true };
    const d = deps({ readTask: readTaskCom(`x\n\n${blocoDeReferencias([anterior])}`) });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ attachments: [anterior] }), d);
    expect(r.attachments[0]!.referenced).toBe(true);
  });
});

describe('multiple_attachments_are_preserved', () => {
  it('os dois materiais aparecem e são conferidos um a um', async () => {
    const d = deps({ readTask: readTaskCom(blocoDeReferencias([PRINT, MIV]), [{ title: PRINT.filename }, { title: MIV.filename }]) });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ attachments: [PRINT, MIV] }), d);
    expect(r.attachments).toHaveLength(2);
    expect(r.attachments.every((a) => a.referenced && a.uploaded)).toBe(true);
  });
});

describe('missing_attachment_does_not_block_create', () => {
  it('pedido sem material nenhum cria normalmente', async () => {
    const d = deps();
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('created');
    expect(r.attachments).toEqual([]);
    expect(d.uploadAttachment).not.toHaveBeenCalled();
  });
});

describe('broken_attachment_reference_does_not_claim_upload', () => {
  it('upload falhou mas a referência ficou: uploaded=false, referenced=true', async () => {
    const d = deps({
      uploadAttachment: vi.fn(async () => { throw new Error('Download do anexo falhou (404)'); }) as unknown as CreateDeps['uploadAttachment'],
      readTask: readTaskCom(blocoDeReferencias([PRINT])),
    });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ attachments: [PRINT] }), d);
    expect(r.status).toBe('created');
    expect(r.attachments[0]!.uploaded).toBe(false);
    expect(r.attachments[0]!.referenced).toBe(true);
    expect(r.attachments[0]!.error).toContain('404');
  });

  it('upload que o ClickUp não confirma na releitura NÃO conta como anexo', async () => {
    // O POST "deu certo", mas a task relida não tem o anexo. O que vale é a leitura.
    const d = deps({ readTask: readTaskCom(blocoDeReferencias([PRINT]), []) });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ attachments: [PRINT] }), d);
    expect(r.attachments[0]!.uploaded).toBe(false);
  });
});

describe('attachment_reference_survives_readback', () => {
  it('corpo sem a URL NÃO é dado como referenciado', async () => {
    const d = deps({ readTask: readTaskCom('descrição sem nenhum link') });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ attachments: [PRINT] }), d);
    expect(r.attachments[0]!.referenced).toBe(false);
  });

  it('read-back que falha não inventa referência nem anexo', async () => {
    const d = deps({ readTask: vi.fn(async () => { throw new Error('502'); }) as unknown as CreateDeps['readTask'] });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ attachments: [PRINT] }), d);
    expect(r.attachments[0]!.referenced).toBe(false);
    expect(r.attachments[0]!.uploaded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FASE 7 — ALLOWLIST DO CANARY.
// ---------------------------------------------------------------------------

describe('canary allowlist', () => {
  it('sem allowlist, todo mundo escreve (comportamento normal do produto)', () => {
    expect(bentoWriteAllowlist({})).toEqual(new Set());
    expect(podeEscreverNoCanary('qualquer@x.com', {})).toBe(true);
  });

  it('com allowlist, só quem está nela escreve', () => {
    const env = { BENTO_WRITE_ALLOWLIST: 'tammy@institutoalmada.org' };
    expect(podeEscreverNoCanary('tammy@institutoalmada.org', env)).toBe(true);
    expect(podeEscreverNoCanary('TAMMY@InstitutoAlmada.org', env)).toBe(true);
    expect(podeEscreverNoCanary('outra@institutoalmada.org', env)).toBe(false);
  });

  it('usuário sem e-mail nunca passa por uma allowlist ativa', () => {
    expect(podeEscreverNoCanary(null, { BENTO_WRITE_ALLOWLIST: 'tammy@institutoalmada.org' })).toBe(false);
  });

  it('allowlist aceita mais de um e-mail (expansão gradual)', () => {
    const env = { BENTO_WRITE_ALLOWLIST: 'tammy@x.org, pedro@x.org ' };
    expect(podeEscreverNoCanary('pedro@x.org', env)).toBe(true);
    expect(podeEscreverNoCanary('gui@x.org', env)).toBe(false);
  });
});

describe('observabilidade do canary', () => {
  it('a chave de idempotência é lista + título normalizado', async () => {
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), deps());
    expect(r.idempotencyKey).toBe('L1:criar layout das placas — d. carvalho');
  });

  it('a mesma demanda na MESMA lista tem a mesma chave, com caixa diferente', async () => {
    const a = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), deps());
    const b = await createOneTask(CONFIG, 'L1', REQUESTER, entrada({ title: '  CRIAR LAYOUT DAS PLACAS — D. CARVALHO ' }), deps());
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
  });

  it('a mesma demanda em OUTRA lista é outra chave: cliente diferente, task diferente', async () => {
    const a = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), deps());
    const b = await createOneTask(CONFIG, 'L2', REQUESTER, entrada(), deps());
    expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it('task bloqueada por pessoa também carrega a chave, pro trace explicar a decisão', async () => {
    const d = deps({ resolveMember: vi.fn(async () => ({ status: 'not_found' as const, candidates: [] })) as unknown as CreateDeps['resolveMember'] });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('blocked');
    expect(r.idempotencyKey).toContain('L1:');
  });
});

describe('idempotência tem JANELA, não é eterna', () => {
  it('mesmo título criado HORAS atrás é demanda nova, não duplicata', async () => {
    const d = deps({
      listTasks: vi.fn(async () => ({
        tasks: [{ id: 'velha', name: 'Criar layout das placas — D. Carvalho', createdAt: Date.now() - 26 * 60 * 60 * 1000 }],
      })) as unknown as CreateDeps['listTasks'],
    });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('created');
    expect(d.createTask).toHaveBeenCalled();
  });

  it('mesmo título criado AGORA é duplicata (retry/reenvio)', async () => {
    const d = deps({
      listTasks: vi.fn(async () => ({
        tasks: [{ id: 'nova', name: 'Criar layout das placas — D. Carvalho', createdAt: Date.now() - 10 * 60 * 1000 }],
      })) as unknown as CreateDeps['listTasks'],
    });
    const r = await createOneTask(CONFIG, 'L1', REQUESTER, entrada(), d);
    expect(r.status).toBe('duplicate');
    expect(d.createTask).not.toHaveBeenCalled();
  });
});

describe('solicitação anterior alimenta a demanda', () => {
  it('itens e pendências vêm do turno anterior quando o pedido referencia "acima"', () => {
    const anterior = 'O cliente pediu 4 totens:\n- Totem "Entrada Norte"\n- Totem "Saída Sul"\nO MIV eu encaminho depois.';
    const ordem = 'Bento, tenho a solicitação acima. Separa e lança pro Gui a criação do layout.';
    const combinado = `${ordem}\n\n[Solicitação anterior]\n${anterior}`;
    const p = buildOperationalActionPlan(combinado);
    // Os itens da solicitação aparecem no plano…
    expect(p.items.length).toBeGreaterThanOrEqual(2);
    // …a pendência do MIV é registrada…
    expect(p.pendencies.length).toBeGreaterThan(0);
    // …e a ordem continua mandando pro Gui.
    expect(p.tasks.every((t) => t.assigneeName === 'Gui')).toBe(true);
  });

  it('sem referência a "acima", nada muda: o plano lê só a mensagem', () => {
    const p = buildOperationalActionPlan('cria isso pro Gui');
    expect(p.tasks).toHaveLength(1);
    expect(p.pendencies).toEqual([]);
  });
});
