import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectionSnapshot } from '@desigual-os/context-engine';

/**
 * FASE B.4 — MATRIZ DO REGEX-GUARD (forense, 25/09/2026).
 *
 * Nasceu como sonda de comportamento; a partir da Etapa 1 da convergência
 * (26/09/2026, ADR-bento-core-convergence) virou REGRESSÃO dos dois P0:
 *
 *   antes (F-01): 16/31 phrasings UPDATE-intent caíam no fallback externo
 *     via `return null` do portão 1 — o bento-qa (credencial real de escrita,
 *     sem idempotência) decidia no escuro.
 *   antes (F-02): "adiciona o Matheus também" virava CREATE local real
 *     (createTask=1) via `criacaoPadrao`.
 *   depois: kill switch `BENTO_EXTERNAL_WRITE_ENABLED=false` (default) faz o
 *     guard responder esclarecimento/bloqueio em vez de devolver null, e o
 *     checkpoint `assertNotUpdateMisroutedAsCreate` proíbe create quando há
 *     recurso existente + sinal de mutação sem sinal explícito de criação.
 *
 * Sonda de comportamento: NÃO altera nenhum arquivo de produção. Importa as
 * funções REAIS de detecção (classifyActionIntent -> classifyIntent ->
 * decideFallbackIntent -> tryBentoActionGuard) e mocka APENAS I/O:
 * ClickUp (tool-gateway), banco (database/drizzle) e handoff Jarbas.
 *
 * Cenário simulado (o da missão): conversa com UMA task recém-criada em foco,
 * task_id "qa9foco001" conhecido — presente no recibo do turno anterior do
 * assistente (URL única -> loadConversationContext resolve lastTaskId) E no
 * snapshot de seleção gravado na metadata (focusTaskId). Cliente ativo
 * "Cliente Teste 7" (client-qa / org-1), usuário com permissão clickup:write.
 *
 * Para cada frase registramos:
 *   (a) portão 1 (classifyActionIntent real): autorizou escrita?
 *   (b) classifyIntent real: qual intenção/regex casou;
 *   (c) branch executado de verdade por tryBentoActionGuard (metadata.action);
 *   (d) se o guard devolveu null (= cai no fallback cego do agente remoto
 *       bento-qa, que tem ferramenta de escrita própria e pode CRIAR);
 *   (e) se o resultado foi UPDATE na task existente ou CREATE de task nova
 *       (contadores reais de createTask/updateTask no boundary de I/O).
 *
 * Reproduzir:  pnpm --filter @desigual-os/worker exec vitest run src/processors/bento-guard-matrix.test.ts
 * Saída:       tabela markdown no stdout + artifacts/forensic-2026-09-25/bento-guard-matrix.json
 */

const FOCUS_TASK_ID = 'qa9foco001';
const FOCUS_TASK_URL = `https://app.clickup.com/t/${FOCUS_TASK_ID}`;
const CLIENT_ID = 'client-qa';
const ORG_ID = 'org-1';
const LIST_ID = 'lista-qa';

/** Contadores no boundary de I/O — a prova de UPDATE vs CREATE. */
const chamadas = {
  createTask: 0,
  updateTask: [] as Array<{ taskId: string; params: Record<string, unknown> }>,
  createTaskComment: 0,
  deleteTask: 0,
  uploadTaskAttachment: 0,
};

/** Estado mutável da task focada — o read-back reflete o que o PUT escreveu. */
let taskState: {
  id: string; name: string; status: string; priority: number; dueDate: number | null;
  listId: string; assignees: Array<{ id: number; username: string }>; description: string;
  attachments: Array<{ title: string }>;
};

function resetTaskState() {
  taskState = {
    id: FOCUS_TASK_ID,
    name: 'Demanda Foco QA',
    status: 'aberto',
    priority: 3,
    dueDate: null,
    listId: LIST_ID,
    assignees: [],
    description: 'Briefing original da demanda.',
    attachments: [],
  };
}

vi.mock('@desigual-os/tool-gateway', () => ({
  createTask: vi.fn(async () => {
    chamadas.createTask += 1;
    return { id: 'nova-qa-create', url: 'https://app.clickup.com/t/novaqacreate' };
  }),
  createVerifiedSeniorTask: vi.fn(async () => {
    chamadas.createTask += 1;
    return { id: 'nova-qa-create', url: 'https://app.clickup.com/t/novaqacreate' };
  }),
  createAttributedTask: vi.fn(async () => {
    chamadas.createTask += 1;
    return { id: 'nova-qa-create', url: 'https://app.clickup.com/t/novaqacreate' };
  }),
  updateTask: vi.fn(async (_c: unknown, taskId: string, params: Record<string, unknown>) => {
    chamadas.updateTask.push({ taskId, params });
    if (params.dueDate !== undefined) taskState.dueDate = params.dueDate as number | null;
    if (params.priority !== undefined) taskState.priority = params.priority as number;
    if (params.status !== undefined) taskState.status = params.status as string;
    if (params.name !== undefined) taskState.name = params.name as string;
    if (params.description !== undefined) taskState.description = params.description as string;
    if (Array.isArray(params.addAssignees)) {
      for (const id of params.addAssignees as number[]) {
        if (!taskState.assignees.some((a) => a.id === id)) taskState.assignees.push({ id, username: id === 501 ? 'Matheus' : id === 502 ? 'Sofia' : `membro-${id}` });
      }
    }
    if (Array.isArray(params.removeAssignees)) {
      taskState.assignees = taskState.assignees.filter((a) => !(params.removeAssignees as number[]).includes(a.id));
    }
  }),
  getTask: vi.fn(async (_c: unknown, taskId: string) => ({ ...taskState, id: taskId })),
  getTaskListId: vi.fn(async () => LIST_ID),
  listStatusesForTask: vi.fn(async () => ['aberto', 'em andamento', 'pronto']),
  resolveMemberByName: vi.fn(async (_c: unknown, name: string) =>
    /matheus/i.test(name)
      ? { status: 'resolved', member: { id: 501, username: 'Matheus', email: 'matheus@x.com' }, matchedBy: 'first_name' }
      : /sofia/i.test(name)
        ? { status: 'resolved', member: { id: 502, username: 'Sofia', email: 'sofia@x.com' }, matchedBy: 'first_name' }
        : { status: 'not_found', candidates: [] },
  ),
  findMemberByName: vi.fn(async (_c: unknown, name: string) =>
    /matheus/i.test(name) ? { id: 501, username: 'Matheus' } : /sofia/i.test(name) ? { id: 502, username: 'Sofia' } : null,
  ),
  getTaskComments: vi.fn(async () => []),
  createTaskComment: vi.fn(async () => {
    chamadas.createTaskComment += 1;
    return { id: 'c1', text: '', date: null };
  }),
  deleteTask: vi.fn(async () => {
    chamadas.deleteTask += 1;
  }),
  uploadTaskAttachment: vi.fn(async () => {
    chamadas.uploadTaskAttachment += 1;
    return { id: 'att-1' };
  }),
  verifyTaskState: vi.fn(() => ({ ok: true, mismatches: [] })),
  findDuplicateTask: vi.fn(() => null),
  normalizeTaskName: vi.fn((s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()),
  queryOperationTasks: vi.fn(async () => ({ tasks: [], truncated: false, pagesFetched: 0 })),
  listTasks: vi.fn(async () => ({ tasks: [], truncated: false, pagesFetched: 0 })),
  WriteScopeError: class WriteScopeError extends Error {},
}));

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  desc: (c: unknown) => c,
  inArray: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
}));

const SNAPSHOT: SelectionSnapshot = {
  version: 1,
  reason: 'task_created',
  reasonLabel: 'task recém-criada em foco',
  source: 'clickup_operational_tasks',
  capturedAt: new Date().toISOString(),
  focusTaskId: FOCUS_TASK_ID,
  tasks: [
    {
      id: FOCUS_TASK_ID,
      title: 'Demanda Foco QA',
      clientName: 'Cliente Teste 7',
      listId: LIST_ID,
      assignees: [],
      dueDate: null,
      status: 'aberto',
      priority: null,
      url: FOCUS_TASK_URL,
    },
  ],
};

const RECIBO_CRIACAO =
  'Separei a demanda e criei a task na Cliente Teste 7. Reli no ClickUp pra confirmar:\n' +
  `- "Demanda Foco QA" — sem responsável definido\n  ${FOCUS_TASK_URL}`;

/** Mensagens da conversa (desc por createdAt): a frase atual + o recibo de criação. */
let messageRows: unknown[] = [];

function montarConversa(fraseAtual: string) {
  messageRows = [
    { role: 'user', agent: null, content: fraseAtual, attachmentUrl: null, attachmentType: null, attachmentFilename: null, metadata: {} },
    { role: 'assistant', agent: 'bento', content: RECIBO_CRIACAO, attachmentUrl: null, attachmentType: null, attachmentFilename: null, metadata: { selecao: SNAPSHOT } },
  ];
}

const messagesTable = { __t: 'messages' };
const clientsTable = { __t: 'clients' };
const CLIENT_ROWS = [{ id: CLIENT_ID, name: 'Cliente Teste 7', listId: LIST_ID, clickupListId: LIST_ID, organizationId: ORG_ID, deletedAt: null }];

vi.mock('@desigual-os/database', () => {
  function chain(rows: unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    (c as { _rows: unknown[] })._rows = rows;
    c.from = (t: unknown) => chain(t === messagesTable ? messageRows : t === clientsTable ? CLIENT_ROWS : rows);
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => c;
    c.catch = (fn: (e: unknown) => unknown) => Promise.resolve((c as { _rows: unknown[] })._rows).catch(fn);
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve((c as { _rows: unknown[] })._rows).then(res, rej);
    return c;
  }
  return {
    db: { select: () => chain([]) },
    schema: { messages: messagesTable, clients: clientsTable, memories: {} },
  };
});

vi.mock('./jarbas-handoff.js', () => ({ tryJarbasHandoff: async () => null }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

/** A bateria da missão + variações naturais de operação (typo, abreviação, imperativo informal). */
const BATERIA: Array<{ frase: string; intencaoHumana: string }> = [
  { frase: 'atualiza essa task e coloca pra sexta', intencaoHumana: 'UPDATE prazo' },
  { frase: 'muda o prazo dela pra amanhã', intencaoHumana: 'UPDATE prazo' },
  { frase: 'coloca o Matheus nela', intencaoHumana: 'UPDATE responsável' },
  { frase: 'adiciona o Matheus também', intencaoHumana: 'UPDATE responsável' },
  { frase: 'troca o responsável pra Sofia', intencaoHumana: 'UPDATE responsável' },
  // Casos obrigatórios do checkpoint anti UPDATE→CREATE (F-02, 26/09/2026):
  { frase: 'coloca isso', intencaoHumana: 'UPDATE (campo vago)' },
  { frase: 'muda aquilo', intencaoHumana: 'UPDATE (campo vago)' },
  { frase: 'corrige a anterior', intencaoHumana: 'UPDATE (campo vago)' },
  { frase: 'nessa mesma task', intencaoHumana: 'UPDATE (referente solto, sem verbo)' },
  { frase: 'adiciona isso no briefing', intencaoHumana: 'UPDATE briefing' },
  { frase: 'nessa mesma task coloca prioridade alta', intencaoHumana: 'UPDATE prioridade' },
  { frase: 'altera aquilo que acabamos de criar', intencaoHumana: 'UPDATE (campo vago)' },
  { frase: 'na task anterior coloca terça', intencaoHumana: 'UPDATE prazo' },
  { frase: 'não, tira o Matheus dela', intencaoHumana: 'UPDATE remove responsável' },
  { frase: 'coloca essa observação naquela demanda', intencaoHumana: 'UPDATE briefing/comentário' },
  { frase: 'corrige a task que você acabou de criar', intencaoHumana: 'UPDATE (campo vago)' },
  { frase: 'bota pra terça', intencaoHumana: 'UPDATE prazo' },
  { frase: 'muda isso', intencaoHumana: 'UPDATE (campo vago)' },
  { frase: 'faz ela pra amanhã', intencaoHumana: 'UPDATE prazo' },
  { frase: 'coloca fulano lá', intencaoHumana: 'UPDATE responsável (nome minúsculo)' },
  { frase: 'nessa aí', intencaoHumana: 'referência solta (sem ordem)' },
  { frase: 'naquela de ontem', intencaoHumana: 'referência solta (sem ordem)' },
  { frase: 'não cria outra, só atualiza', intencaoHumana: 'UPDATE (negação de create)' },
  { frase: 'edita a anterior', intencaoHumana: 'UPDATE (campo vago)' },
  { frase: 'corrige o briefing dela', intencaoHumana: 'UPDATE briefing' },
  // Variações naturais de operador real:
  { frase: 'atuliza essa task e coloca pra sexta', intencaoHumana: 'UPDATE prazo (typo)' },
  { frase: 'muda o prazo dela pra amanha', intencaoHumana: 'UPDATE prazo (sem acento)' },
  { frase: 'coloca prioridade alta nela', intencaoHumana: 'UPDATE prioridade' },
  { frase: 'passa ela pro Matheus', intencaoHumana: 'UPDATE responsável' },
  { frase: 'marca essa como urgente', intencaoHumana: 'UPDATE prioridade' },
  { frase: 'atualiza o brief dessa task', intencaoHumana: 'UPDATE briefing (abreviação)' },
  { frase: 'muda o status dela pra em andamento', intencaoHumana: 'UPDATE status' },
  { frase: 'joga pra sexta-feira', intencaoHumana: 'UPDATE prazo' },
  { frase: 'empurra ela pra semana que vem', intencaoHumana: 'UPDATE prazo (verbo fora do vocabulário)' },
  { frase: 'dela, muda o responsável', intencaoHumana: 'UPDATE responsável (sem nome)' },
  { frase: 'reagenda pra segunda', intencaoHumana: 'UPDATE prazo' },
  { frase: 'incrementa o briefing com isso', intencaoHumana: 'UPDATE briefing (verbo fora do vocabulário)' },
  // CONTROLE: criação nova explícita, sem referente — TEM que criar normal,
  // mesmo numa conversa com task recém-criada em foco (sinal explícito de
  // criação vence o checkpoint, ver assertNotUpdateMisroutedAsCreate).
  { frase: 'cria uma task de revisão do carrossel', intencaoHumana: 'CREATE nova task (sem referente)' },
];

/** Rótulo da regex/função que casou, com a linha do arquivo de produção. */
function regexDaIntencao(kind: string): string {
  switch (kind) {
    case 'update_assignee': return 'UPDATE_ASSIGNEE :69 / UPDATE_ASSIGNEE_RESP :71';
    case 'update_due': return 'UPDATE_DUE :79';
    case 'update_status': return 'UPDATE_STATUS :93';
    case 'update_brief': return 'UPDATE_BRIEF :105';
    case 'update_title': return 'UPDATE_TITLE :114';
    case 'update_priority': return 'UPDATE_PRIORITY :115 / PRIORITY_DIRECT :117 / PRIORITY_REMOVE :119';
    case 'update_multi': return 'collectFieldUpdates :342 (2+ campos)';
    case 'comment': return 'COMMENT_REQUEST :121';
    case 'create': return 'CREATE_TASK :122 (ou criacaoPadrao :524)';
    default: return 'nenhuma';
  }
}

interface Linha {
  frase: string;
  intencaoHumana: string;
  portao1: string;
  intentClassificado: string;
  regexDetectou: string;
  branch: string;
  caiuNoFallbackExterno: boolean;
  resultado: string;
  seguro: string;
}

describe('FASE B.4 — matriz do regex-guard (task recém-criada em foco)', () => {
  beforeEach(() => {
    chamadas.createTask = 0;
    chamadas.updateTask.length = 0;
    chamadas.createTaskComment = 0;
    chamadas.deleteTask = 0;
    chamadas.uploadTaskAttachment = 0;
    resetTaskState();
    process.env.CLICKUP_API_KEY = 'teste';
    process.env.CLICKUP_TEAM_ID = 'team';
    delete process.env.BENTO_WRITE_ALLOWLIST;
    delete process.env.BENTO_ACTION_INTENT_V2;
    delete process.env.BENTO_MULTI_ACTION_WRITE;
    // Default da flag é false = kill switch LIGADO (é o comportamento de
    // produção da Etapa 1); os testes de rollback setam explicitamente.
    delete process.env.BENTO_EXTERNAL_WRITE_ENABLED;
  });

  it('classifica a bateria inteira pelo caminho real do guard', async () => {
    const { tryBentoActionGuard, classifyIntentForTest, decideFallbackIntent } = await import('./bento-action-guard.js');
    const { classifyActionIntent } = await import('./action-intent.js');

    const linhas: Linha[] = [];

    for (const { frase, intencaoHumana } of BATERIA) {
      montarConversa(frase);
      chamadas.createTask = 0;
      chamadas.updateTask.length = 0;
      chamadas.createTaskComment = 0;
      chamadas.deleteTask = 0;
      resetTaskState();

      const acao = classifyActionIntent(frase);
      const classificado = classifyIntentForTest(frase);

      const res = await tryBentoActionGuard({
        message: frase,
        conversationId: 'conv-qa-faseb4',
        userName: 'Operador QA',
        userClickUpEmail: 'operador@x.com',
        userEmail: 'operador@x.com',
        seniorToolContext: {
          agent: 'bento',
          organizationId: ORG_ID,
          permissions: [{ resource: 'clickup', action: 'write' }],
        } as never,
        agencyListId: 'lista-agencia',
        briefingWriter: async () => null,
        clientId: CLIENT_ID,
        clientName: 'Cliente Teste 7',
        logger,
      });

      const meta = (res?.metadata ?? {}) as Record<string, unknown>;
      const branch = res === null
        ? 'return null → agente remoto bento-qa'
        : String(meta.action ?? meta.reason ?? 'resposta_sem_metadata');

      let resultado: string;
      if (res === null) resultado = 'EXTERNO: bento-qa decide (pode CRIAR)';
      else if (chamadas.createTask > 0) resultado = 'CREATE de task nova';
      else if (chamadas.updateTask.length > 0) resultado = `UPDATE na task ${chamadas.updateTask[0]!.taskId}`;
      else if (chamadas.createTaskComment > 0) resultado = 'COMENTÁRIO na task existente';
      else if (chamadas.deleteTask > 0) resultado = 'DELETE';
      else resultado = 'NENHUMA mutação';

      // Seguro = a mutação resultante corresponde à intenção humana (UPDATE no
      // recurso existente), ou o guard se recusou honestamente SEM criar nada.
      // Não seguro = CREATE quando o humano pediu UPDATE, ou fallback externo
      // cego sobre uma intenção de UPDATE (o remoto pode criar).
      const querUpdate = intencaoHumana.startsWith('UPDATE');
      let seguro: string;
      if (res === null) seguro = querUpdate ? 'NÃO (cego: remoto pode criar)' : 'neutro (sem ordem reconhecida)';
      else if (chamadas.createTask > 0) seguro = querUpdate ? 'NÃO (criou task nova)' : 'sim (create pedido)';
      else if (querUpdate && chamadas.updateTask.length === 0 && chamadas.createTaskComment === 0) seguro = 'sim (sem mutação — esclarecimento/bloqueio honesto)';
      else seguro = 'sim';

      const fallbackUsado = classificado.kind === 'none' ? decideFallbackIntent(frase, FOCUS_TASK_ID) : null;

      linhas.push({
        frase,
        intencaoHumana,
        portao1: `${acao.kind}${acao.writeAuthorized ? ' (write OK)' : ''}${acao.negated ? ' [negado]' : ''}`,
        intentClassificado: classificado.kind + (fallbackUsado ? ` → fallback:${fallbackUsado.kind === 'ask_clarification' ? 'ask_clarification' : fallbackUsado.intent.kind}` : ''),
        regexDetectou: regexDaIntencao(classificado.kind),
        branch,
        caiuNoFallbackExterno: res === null,
        resultado,
        seguro,
      });
    }

    // Tabela markdown no stdout.
    const header = '| Frase | Intenção humana | Regex detectou? | Branch | Cai no fallback? | UPDATE ou CREATE resultante | Seguro? |';
    const sep = '|---|---|---|---|---|---|---|';
    const corpo = linhas.map((l) =>
      `| ${l.frase} | ${l.intencaoHumana} | ${l.intentClassificado} | ${l.branch} | ${l.caiuNoFallbackExterno ? 'SIM' : 'não'} | ${l.resultado} | ${l.seguro} |`,
    );
    console.log(['', header, sep, ...corpo, ''].join('\n'));

    const updateIntent = linhas.filter((l) => l.intencaoHumana.startsWith('UPDATE'));
    const updateNoFallback = updateIntent.filter((l) => l.caiuNoFallbackExterno);
    const pct = ((updateNoFallback.length / updateIntent.length) * 100).toFixed(1);
    console.log(`UPDATE-intent no fallback externo: ${updateNoFallback.length}/${updateIntent.length} = ${pct}%`);

    const dir = join(__dirname, '..', '..', '..', '..', 'artifacts', 'forensic-2026-09-25');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'bento-guard-matrix.json'),
      JSON.stringify({ geradoEm: new Date().toISOString(), cenario: { focusTaskId: FOCUS_TASK_ID, clientId: CLIENT_ID, orgId: ORG_ID }, resumo: { updateIntent: updateIntent.length, updateNoFallback: updateNoFallback.length, pctFallback: pct }, linhas }, null, 2),
    );

    expect(linhas.length).toBe(BATERIA.length);
    // Sanity: a frase-canônico do incidente D. Carvalho continua UPDATE local.
    const canonica = linhas.find((l) => l.frase === 'muda o prazo dela pra amanhã')!;
    expect(canonica.resultado).toContain('UPDATE');
    expect(canonica.caiuNoFallbackExterno).toBe(false);

    /**
     * REGRESSÃO DOS DOIS P0 (Etapa 1 da convergência, 26/09/2026).
     * antes: 16/31 UPDATE-intent no fallback externo (F-01) e "adiciona o
     * Matheus também" virando CREATE local (F-02) — 54,8% inseguros.
     * depois: INV-008 (fallback de escrita externo proibido) + INV-001
     * (UPDATE nunca cria sem autorização) — ambos têm que ser ZERO.
     */
    const updateIntentLinhas = linhas.filter((l) => l.intencaoHumana.startsWith('UPDATE'));
    const noFallback = updateIntentLinhas.filter((l) => l.caiuNoFallbackExterno);
    const virouCreate = updateIntentLinhas.filter((l) => l.resultado === 'CREATE de task nova');
    expect(noFallback.map((l) => l.frase)).toEqual([]);
    expect(virouCreate.map((l) => l.frase)).toEqual([]);

    // CONTROLE: criação explícita sem referente segue criando normal, mesmo
    // com task em foco na conversa — o checkpoint não pode virar bloqueio
    // de create legítimo.
    const controle = linhas.find((l) => l.frase === 'cria uma task de revisão do carrossel')!;
    expect(controle.resultado).toBe('CREATE de task nova');
    expect(controle.caiuNoFallbackExterno).toBe(false);
  });

  /**
   * F-02 — os casos obrigatórios do checkpoint, um a um, com o contador de
   * createTask como prova. NENHUM pode criar; todos respondem aqui mesmo
   * (nunca null = nunca externo).
   */
  describe('F-02 — checkpoint anti UPDATE→CREATE: casos obrigatórios', () => {
    const PROIBIDOS = [
      'adiciona o Matheus também',
      'coloca isso',
      'muda aquilo',
      'corrige a anterior',
      'nessa mesma task',
      'altera aquilo que acabamos de criar',
    ];

    for (const frase of PROIBIDOS) {
      it(`"${frase}" NÃO cria e NÃO cai no externo`, async () => {
        const { tryBentoActionGuard } = await import('./bento-action-guard.js');
        montarConversa(frase);
        chamadas.createTask = 0;
        chamadas.updateTask.length = 0;
        resetTaskState();

        const res = await tryBentoActionGuard({
          message: frase,
          conversationId: 'conv-qa-faseb4',
          userName: 'Operador QA',
          userClickUpEmail: 'operador@x.com',
          userEmail: 'operador@x.com',
          seniorToolContext: {
            agent: 'bento',
            organizationId: ORG_ID,
            permissions: [{ resource: 'clickup', action: 'write' }],
          } as never,
          agencyListId: 'lista-agencia',
          briefingWriter: async () => null,
          clientId: CLIENT_ID,
          clientName: 'Cliente Teste 7',
          logger,
        });

        expect(chamadas.createTask, `"${frase}" criou task nova`).toBe(0);
        expect(chamadas.updateTask.length, `"${frase}" escreveu na task existente sem campo claro`).toBe(0);
        expect(res, `"${frase}" caiu no fallback externo`).not.toBeNull();
        const meta = (res?.metadata ?? {}) as Record<string, unknown>;
        expect(
          // update_single/update_multi entram quando o portão 1 autoriza e a
          // frase casa o vocabulário de update — o executor responde honesto
          // sem escrever (prova: contadores zerados acima).
          ['blocked_update_never_create', 'blocked_external_write_fallback', 'unknown_operation_on_existing_reference', 'update_sem_alvo_resolvivel', 'update_single', 'update_multi'].includes(
            String(meta.action ?? meta.reason ?? ''),
          ),
          `"${frase}" caiu num branch inesperado: ${String(meta.action ?? meta.reason)}`,
        ).toBe(true);
      });
    }
  });

  /**
   * F-01 — kill switch: com a flag no default (false), o portão 1 NUNCA mais
   * devolve null pra mensagem com potencial de escrita; com true (rollback
   * operacional), o comportamento legado volta byte a byte.
   */
  describe('F-01 — kill switch de escrita externa', () => {
    it('flag ausente (default false): "coloca o Matheus nela" vira bloqueio explícito, não null', async () => {
      const { tryBentoActionGuard } = await import('./bento-action-guard.js');
      montarConversa('coloca o Matheus nela');
      resetTaskState();

      const res = await tryBentoActionGuard({
        message: 'coloca o Matheus nela',
        conversationId: 'conv-qa-faseb4',
        userName: 'Operador QA',
        userClickUpEmail: 'operador@x.com',
        userEmail: 'operador@x.com',
        seniorToolContext: {
          agent: 'bento',
          organizationId: ORG_ID,
          permissions: [{ resource: 'clickup', action: 'write' }],
        } as never,
        agencyListId: 'lista-agencia',
        briefingWriter: async () => null,
        clientId: CLIENT_ID,
        clientName: 'Cliente Teste 7',
        logger,
      });

      expect(res).not.toBeNull();
      const meta = (res?.metadata ?? {}) as Record<string, unknown>;
      expect(meta.action).toBe('blocked_external_write_fallback');
      expect(meta.write_authorized).toBe(false);
      // Trace estruturado: intent classificado, razão e sinais presentes.
      expect(meta.intent_classification).toBeTruthy();
      expect(Array.isArray(meta.signals)).toBe(true);
      expect(chamadas.createTask).toBe(0);
    });

    it('flag true (rollback): o mesmo pedido volta a devolver null (comportamento legado)', async () => {
      process.env.BENTO_EXTERNAL_WRITE_ENABLED = 'true';
      const { tryBentoActionGuard } = await import('./bento-action-guard.js');
      montarConversa('coloca o Matheus nela');
      resetTaskState();

      const res = await tryBentoActionGuard({
        message: 'coloca o Matheus nela',
        conversationId: 'conv-qa-faseb4',
        userName: 'Operador QA',
        userClickUpEmail: 'operador@x.com',
        userEmail: 'operador@x.com',
        seniorToolContext: {
          agent: 'bento',
          organizationId: ORG_ID,
          permissions: [{ resource: 'clickup', action: 'write' }],
        } as never,
        agencyListId: 'lista-agencia',
        briefingWriter: async () => null,
        clientId: CLIENT_ID,
        clientName: 'Cliente Teste 7',
        logger,
      });

      expect(res).toBeNull();
    });

    it('leitura clara continua seguindo pro externo (kill switch não bloqueia pergunta)', async () => {
      const { tryBentoActionGuard } = await import('./bento-action-guard.js');
      montarConversa('quais tasks vencem hoje?');
      resetTaskState();

      const res = await tryBentoActionGuard({
        message: 'quais tasks vencem hoje?',
        conversationId: 'conv-qa-faseb4',
        userName: 'Operador QA',
        userClickUpEmail: 'operador@x.com',
        userEmail: 'operador@x.com',
        seniorToolContext: {
          agent: 'bento',
          organizationId: ORG_ID,
          permissions: [{ resource: 'clickup', action: 'write' }],
        } as never,
        agencyListId: 'lista-agencia',
        briefingWriter: async () => null,
        clientId: CLIENT_ID,
        clientName: 'Cliente Teste 7',
        logger,
      });

      expect(res).toBeNull();
    });
  });

  /**
   * QA 28/09/2026 (achado ao vivo no teste de aceite da missão de release):
   * "agora apaga ela" não bate em NENHUM padrão de classifyActionIntent
   * (não é update/comment/create reconhecido) — o kill switch de escrita
   * não-autorizada respondia esclarecimento genérico ("blocked_external_
   * write_fallback") ANTES da detecção real de delete (isTaskDeleteRequest,
   * mais abaixo no dispatcher) ter a chance de rodar. Regressão: um pedido
   * de exclusão puramente pronominal precisa abrir a confirmação de delete,
   * nunca cair no fallback de "não reconheci".
   */
  describe('DELETE puramente pronominal ("agora apaga ela") abre confirmação — não cai no kill switch genérico', () => {
    beforeEach(() => {
      chamadas.createTask = 0;
      chamadas.updateTask.length = 0;
      chamadas.createTaskComment = 0;
      chamadas.deleteTask = 0;
      resetTaskState();
      process.env.CLICKUP_API_KEY = 'teste';
      process.env.CLICKUP_TEAM_ID = 'team';
      delete process.env.BENTO_EXTERNAL_WRITE_ENABLED;
    });

    it.each(['agora apaga ela', 'deleta isso', 'exclui essa'])('"%s" abre delete_pending_confirmation', async (frase) => {
      const { tryBentoActionGuard } = await import('./bento-action-guard.js');
      montarConversa(frase);

      const res = await tryBentoActionGuard({
        message: frase,
        conversationId: 'conv-qa-faseb4',
        userName: 'Operador QA',
        userClickUpEmail: 'operador@x.com',
        userEmail: 'operador@x.com',
        seniorToolContext: {
          agent: 'bento',
          organizationId: ORG_ID,
          permissions: [{ resource: 'clickup', action: 'write' }],
        } as never,
        agencyListId: 'lista-agencia',
        briefingWriter: async () => null,
        clientId: CLIENT_ID,
        clientName: 'Cliente Teste 7',
        logger,
      });

      expect(res).not.toBeNull();
      const meta = (res?.metadata ?? {}) as Record<string, unknown>;
      expect(meta.action).toBe('delete_pending_confirmation');
      expect(meta.action).not.toBe('blocked_external_write_fallback');
      expect(chamadas.deleteTask).toBe(0); // primeira volta só pergunta, nunca apaga
    });
  });
});
