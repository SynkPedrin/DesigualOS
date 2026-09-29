import {
  addChecklistItem,
  addTaskDependency,
  addTaskToList,
  addTaskTag,
  registrarTempo,
  updateTaskWatchers,
  createChecklist,
  getTask,
  listCustomFields,
  listStatusesForTask,
  removeTaskTag,
  resolveMemberByName,
  setCustomFieldValue,
  updateTask,
  uploadTaskAttachment,
  type ClickUpConfig,
  type TaskDetail,
} from '@desigual-os/tool-gateway';
import { ehFalhaDeCampo, explicarFalhaDeCampo, resolverCampoPersonalizado } from './bento-field-values';
import type { ExecuteResponse } from '@desigual-os/node-protocol';
import type { Logger } from '@desigual-os/logging';
import type { ExecutionRecord } from './execution-record';
import type { TaskAttachment } from './multi-create-executor';

/**
 * bento-update-executor.ts — UPDATE DE TASK EXISTENTE, multi-campo.
 *
 * A regra de ouro desta missão (25/09/2026, incidente D. Carvalho): task
 * existente + verbo de edição NUNCA vira create. Este módulo é a prova
 * estrutural: ele NÃO IMPORTA createTask. Não existe caminho aqui que crie
 * task — nem em erro, nem em fallback, nem em ambiguidade.
 *
 * Contrato:
 *   1. LÊ a task real antes (estado atual é a fonte da verdade);
 *   2. pula campos que JÁ estão como pedido (idempotência: repetir "altere a
 *      data pra 28/09" depois do sucesso responde "já estava", sem reescrever);
 *   3. escreve os campos mudados num PUT só (assignee/prazo/prioridade/status/
 *      título), briefing em acréscimo separado (nunca sobrescreve descrição);
 *   4. RELÊ e confere campo a campo antes de confirmar;
 *   5. falha = relatada, sem task substituta.
 */

export interface TaskUpdateFields {
  dueDate?: number;
  personName?: string;
  priority?: 1 | 2 | 3 | 4;
  statusHint?: string;
  newTitle?: string;
  briefAddition?: string;
  /** "apaga o briefing" — esvazia a descrição da MESMA task (a task fica). */
  clearDescription?: boolean;
  /** "apaga e coloca esse texto" — substitui; o texto é GERADO quando o pedido é "crie um texto de...". */
  replaceDescription?: string;
  /** "remove o prazo dela". */
  clearDueDate?: boolean;
  /** "remove o Pedro dela" ('' = remove todos os responsáveis atuais). */
  removePersonName?: string;
  /**
   * "troca o responsável pra Sofia" (assigneeOperation 'replace' do core novo):
   * adiciona a pessoa indicada e remove TODOS os outros responsáveis atuais,
   * num PUT só. Diferente de personName (só adiciona) + removePersonName: ''
   * (removeria inclusive ela se já estivesse atribuída — medido no desenho
   * da correção F-17, 26/09/2026).
   */
  replacePersonName?: string;
  /** "crie um título pra task" — gerado do conteúdo pedido. */
  generateTitle?: boolean;
  /** "coloca a imagem nela" — anexo da conversa na MESMA task. */
  attachImage?: boolean;
  /* --- 28/09/2026: o resto do ClickUp --- */
  /** Data de INÍCIO (epoch ms), separada do vencimento. */
  startDate?: number;
  /** Estimativa em ms (já convertida de "2h" pela camada de cima). */
  timeEstimate?: number;
  /** Tags a aplicar/tirar. Precisam existir no space. */
  addTags?: string[];
  removeTags?: string[];
  /** Campos personalizados por NOME, como a pessoa falou. */
  customFields?: Record<string, string>;
  /** Checklist novo na task. */
  checklistName?: string;
  checklistItems?: string[];
  /** Dependência: esta task espera a outra / a outra espera esta. */
  dependsOnTaskId?: string;
  dependencyOfTaskId?: string;
  /* --- 28/09/2026, conferido endpoint a endpoint contra o ClickUp real --- */
  /** Nomes de quem passa a SEGUIR a task (notificação sem virar responsável). */
  addWatcherNames?: string[];
  removeWatcherNames?: string[];
  /**
   * Lista onde a task passa a aparecer TAMBÉM. Não é mover: o ClickUp v2 não
   * move, e recusa (400) remover a task da lista de origem — ver
   * addTaskToList em clickup-client.ts.
   */
  addToListId?: string;
  addToListName?: string;
  /** Apontamento de horas: {inicioMs, duracaoMs}. */
  tempo?: { inicioMs: number; duracaoMs: number; descricao?: string };
}

interface FieldOutcome {
  field: string;
  label: string;
  changed: boolean;
  skippedAsAlready: boolean;
  verified: boolean;
  error: string | null;
  /** Checagem de read-back DESTE campo (nunca array paralelo: PUT que falha no
   * meio desalinha índice e marca verificado o campo errado). */
  check?: (relida: TaskDetail) => boolean;
}

function mesmoDia(a: number, b: number): boolean {
  const f = (ms: number) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
  return f(a) === f(b);
}

/**
 * ── AS TRÊS COMPARAÇÕES DO READ-BACK ──────────────────────────────────────
 *
 * Extraídas como funções puras em 29/09/2026 porque as três erravam na MESMA
 * direção: o verificador era mais estrito que o armazenamento do ClickUp, e o
 * Bento acusava "escrito, mas a releitura não confirmou" sobre escrita que
 * tinha funcionado. Três relatos reais no leitor de saúde, num dia só.
 *
 * Os campos que sempre passaram (prazo, nome, status, prioridade, responsável)
 * comparam com TOLERÂNCIA — dia, caixa, pertencimento por id. Os que falhavam
 * comparavam com igualdade estrita de epoch ou de string. Não eram escritas
 * mais frágeis; era verificação mais rígida que o provedor.
 */

/** Início confere? Por DIA, como o prazo — o ClickUp normaliza a hora. */
export function inicioConfere(relidaStartDate: number | null, alvo: number): boolean {
  return relidaStartDate !== null && mesmoDia(relidaStartDate, alvo);
}

/**
 * Seguidor confere? `null` = o ClickUp não devolveu o campo nesta resposta, e
 * aí a resposta honesta é aceitar: afirmar que falhou sem ter olhado é pior do
 * que admitir que não deu pra olhar. `[]` é diferente — devolveu e não há
 * ninguém, o que É uma reprovação legítima.
 */
export function seguidorConfere(watchers: Array<{ id: number }> | null, seguidorId: number): boolean {
  if (watchers === null) return true;
  return watchers.some((w) => w.id === seguidorId);
}

/** Dobra espaço e caixa: o conteúdo do item importa, o espaçamento do provedor não. */
function dobraItem(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Checklist confere? Nome e itens comparados normalizados, não por string exata. */
export function checklistConfere(
  checklists: Array<{ name: string; items: string[] }>,
  nome: string,
  itensAlvo: readonly string[],
): boolean {
  const alvos = itensAlvo.map(dobraItem);
  return checklists.some(
    (c) => dobraItem(c.name) === dobraItem(nome) && alvos.every((i) => c.items.some((atual) => dobraItem(atual) === i)),
  );
}

function dataBR(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
}

const PRIORIDADE_LABEL: Record<number, string> = { 1: 'urgente', 2: 'alta', 3: 'normal', 4: 'baixa' };

export async function executeTaskUpdate(params: {
  config: ClickUpConfig;
  taskId: string;
  knownTaskName: string | null;
  fields: TaskUpdateFields;
  /** Pessoa herdada da conversa ("atribua a ele") quando a frase não nomeia. */
  personFromContext?: string | null;
  /** Geração de texto/título (LLM sem ferramenta) quando o pedido é "crie um texto/título". */
  briefingWriter?: (prompt: string) => Promise<string | null>;
  /** Anexos disponíveis na conversa (turno atual + turnos anteriores). */
  attachments?: TaskAttachment[];
  /** O pedido original de turnos anteriores ("com oq eu pedi" aponta pra ele). */
  solicitacaoAnterior?: string | null;
  mapStatus: (hint: string, statuses: string[]) => string | undefined;
  logger: Logger;
}): Promise<ExecuteResponse> {
  const { config, taskId, logger } = params;
  const toolCalls: { tool: string; input_summary: string; ok: boolean; duration_ms: number; error?: string }[] = [];
  const startedAt = performance.now();
  const record = (tool: string, input: string, ok: boolean, error?: string) => {
    toolCalls.push({ tool, input_summary: input, ok, duration_ms: Math.round(performance.now() - startedAt), ...(error ? { error } : {}) });
  };
  const respond = (answer: string, ok: boolean, metadata: Record<string, unknown>): ExecuteResponse => ({
    execution_id: '',
    agent: 'bento',
    status: ok ? 'completed' : 'failed',
    answer,
    sources: [],
    tool_calls: toolCalls,
    usage: { input_tokens: 0, output_tokens: 0 },
    ...(ok ? {} : { error: answer }),
    metadata,
  });

  // 1. ESTADO ATUAL REAL — a fonte da verdade é o ClickUp, não a conversa.
  const atual: TaskDetail | null = await getTask(config, taskId).catch(() => null);
  if (!atual) {
    return respond(
      `❌ Não consegui ler a task (${taskId}) no ClickUp pra alterar com segurança. Não alterei nada — e não criei task nenhuma.`,
      false,
      { guard: 'bento-action', action: 'update_read_failed', task_id: taskId, verified: false, errorCode: 'CLICKUP_LOOKUP_FAILED' },
    );
  }
  const nomeTask = atual.name;
  const outcomes: FieldOutcome[] = [];
  const fields = params.fields;

  // 2. RESOLUÇÃO DE CADA CAMPO contra o estado atual (idempotência por campo).
  const put: Record<string, unknown> = {};

  let member: { id: number; username: string } | null = null;
  if (fields.personName !== undefined || fields.personName === '') {
    // '' = "atribua a ele": a pessoa vem do contexto da conversa.
  }
  const personName = fields.personName || params.personFromContext || null;
  if (fields.personName !== undefined) {
    if (!personName) {
      outcomes.push({ field: 'assignee', label: '👤 Responsável', changed: false, skippedAsAlready: false, verified: false, error: 'não identifiquei pra quem' });
    } else {
      const resolucao = await resolveMemberByName(config, personName).catch(() => null);
      if (!resolucao || resolucao.status === 'not_found') {
        outcomes.push({ field: 'assignee', label: '👤 Responsável', changed: false, skippedAsAlready: false, verified: false, error: `não encontrei "${personName}" entre os membros do ClickUp` });
      } else if (resolucao.status === 'ambiguous') {
        outcomes.push({ field: 'assignee', label: '👤 Responsável', changed: false, skippedAsAlready: false, verified: false, error: `"${personName}" casa com mais de uma pessoa (${resolucao.candidates.map((c) => c.username).join(', ')})` });
      } else {
        member = { id: resolucao.member.id, username: resolucao.member.username };
        if (atual.assignees.some((a) => a.id === member!.id)) {
          outcomes.push({ field: 'assignee', label: '👤 Responsável', changed: false, skippedAsAlready: true, verified: true, error: null });
        } else {
          put.addAssignees = [member.id];
          const memberId = member.id;
          outcomes.push({ field: 'assignee', label: '👤 Responsável', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.assignees.some((a) => a.id === memberId) });
        }
      }
    }
  }

  if (fields.dueDate !== undefined) {
    if (atual.dueDate !== null && mesmoDia(atual.dueDate, fields.dueDate)) {
      outcomes.push({ field: 'due', label: '📅 Prazo', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      put.dueDate = fields.dueDate;
      const alvo = fields.dueDate;
      outcomes.push({ field: 'due', label: '📅 Prazo', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.dueDate !== null && mesmoDia(relida.dueDate, alvo) });
    }
  }

  if (fields.startDate !== undefined) {
    if (atual.startDate === fields.startDate) {
      outcomes.push({ field: 'start', label: '🚦 Início', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      put.startDate = fields.startDate;
      const inicioAlvo = fields.startDate;
      /**
       * TOLERÂNCIA DE DIA, igual ao prazo (ver o `check` do campo `due` acima).
       *
       * Sem `check` nenhum, o read-back nunca confirmava — corrigido em
       * 28/09/2026. Mas o `check` nasceu com `===` de epoch, e o ClickUp
       * normaliza a hora do dia em campo de data: o início ENTRAVA, a
       * releitura trazia outro horário do MESMO dia, e o Bento continuava
       * dizendo "escrito, mas a releitura não confirmou". Terceira aparição do
       * mesmo defeito no mesmo campo.
       *
       * O prazo já tinha aprendido isso e comparava por dia. Aqui passa a
       * comparar igual — a data é o que a pessoa pediu; o horário é detalhe do
       * provedor.
       */
      outcomes.push({ field: 'start', label: '🚦 Início', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => inicioConfere(relida.startDate, inicioAlvo) });
    }
  }

  if (fields.timeEstimate !== undefined) {
    put.timeEstimate = fields.timeEstimate;
    const estimativaAlvo = fields.timeEstimate;
    /**
     * O ClickUp aceita `time_estimate` com 200 e IGNORA o campo quando o
     * ClickApp "Time Estimates" está desligado no space — conferido batendo
     * direto na API em 28/09/2026: PUT 200, releitura devolve null. É
     * exatamente o tipo de sucesso falso que este sistema existe pra não
     * repassar, então o read-back decide, e a explicação diz o que fazer.
     */
    outcomes.push({ field: 'estimate', label: '⏱️ Estimativa', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.timeEstimate === estimativaAlvo });
  }

  if (fields.priority !== undefined) {
    if (atual.priority === fields.priority) {
      outcomes.push({ field: 'priority', label: '⚠️ Prioridade', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      put.priority = fields.priority;
      const alvo = fields.priority;
      outcomes.push({ field: 'priority', label: '⚠️ Prioridade', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.priority === alvo });
    }
  }

  if (fields.statusHint !== undefined) {
    const statuses = await listStatusesForTask(config, taskId).catch(() => []);
    const wanted = params.mapStatus(fields.statusHint, statuses);
    if (!wanted) {
      outcomes.push({
        field: 'status',
        label: '🔄 Status',
        changed: false,
        skippedAsAlready: false,
        verified: false,
        error: `não consegui mapear o status pedido; os válidos nessa lista são: ${statuses.join(', ') || 'indisponíveis'}`,
      });
    } else if ((atual.status ?? '').toLowerCase() === wanted.toLowerCase()) {
      outcomes.push({ field: 'status', label: '🔄 Status', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      put.status = wanted;
      outcomes.push({ field: 'status', label: '🔄 Status', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => (relida.status ?? '').toLowerCase() === wanted.toLowerCase() });
    }
  }

  if (fields.newTitle !== undefined) {
    if (atual.name === fields.newTitle) {
      outcomes.push({ field: 'title', label: '✏️ Título', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      put.name = fields.newTitle;
      const alvo = fields.newTitle;
      outcomes.push({ field: 'title', label: '✏️ Título', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.name === alvo });
    }
  }

  /**
   * CONTEÚDO DA TASK (adendo 25/09/2026): "delete todo o briefing" edita a
   * descrição da MESMA task — a task NUNCA é apagada aqui (deleteTask não é
   * nem importado por este módulo). Texto pedido sem texto dado é GERADO pelo
   * briefingWriter (LLM sem ferramenta), com o pedido original da conversa
   * como fonte ("atualizar com oq eu pedi").
   */
  let escreveu = false;
  let textoGerado: string | null = null;
  if (fields.replaceDescription !== undefined || fields.generateTitle) {
    const fonte = [params.solicitacaoAnterior, params.fields.replaceDescription ?? ''].filter(Boolean).join('\n\n');
    textoGerado = params.briefingWriter
      ? await params
          .briefingWriter(
            [
              'Escreva o CONTEÚDO FINAL pedido abaixo, em português, pronto pra ir numa task do ClickUp.',
              'Regras: só o conteúdo, sem explicar o que você fez, sem aspas em volta, sem comentário meta.',
              '',
              `PEDIDO: ${fonte}`,
            ].join('\n'),
          )
          .catch(() => null)
      : null;
  }

  if (fields.clearDescription) {
    if (atual.description.trim() === '') {
      outcomes.push({ field: 'description', label: '📝 Briefing', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      put.description = '';
      outcomes.push({ field: 'description', label: '📝 Briefing', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.description.trim() === '' });
    }
  }
  if (fields.replaceDescription !== undefined) {
    if (!textoGerado) {
      outcomes.push({ field: 'description', label: '📝 Briefing', changed: false, skippedAsAlready: false, verified: false, error: 'não consegui gerar o texto agora — o conteúdo atual ficou intacto' });
    } else {
      put.description = textoGerado;
      const trecho = textoGerado.slice(0, 120);
      outcomes.push({ field: 'description', label: '📝 Briefing', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.description.includes(trecho) });
    }
  }

  if (fields.clearDueDate) {
    if (atual.dueDate === null) {
      outcomes.push({ field: 'due', label: '📅 Prazo', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      put.dueDate = null;
      outcomes.push({ field: 'due', label: '📅 Prazo', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.dueDate === null });
    }
  }

  if (fields.removePersonName !== undefined) {
    let idsARemover: number[] = [];
    let rotuloRemocao = 'responsável atual';
    if (fields.removePersonName === '') {
      idsARemover = atual.assignees.map((a) => a.id);
    } else {
      const resolucao = await resolveMemberByName(config, fields.removePersonName).catch(() => null);
      if (resolucao?.status === 'resolved') {
        idsARemover = [resolucao.member.id];
        rotuloRemocao = resolucao.member.username;
      } else {
        outcomes.push({ field: 'remove_assignee', label: '👤 Responsável', changed: false, skippedAsAlready: false, verified: false, error: `não encontrei "${fields.removePersonName}" entre os membros do ClickUp` });
      }
    }
    if (idsARemover.length > 0 || rotuloRemocao !== 'responsável atual') {
      if (idsARemover.length === 0) {
        outcomes.push({ field: 'remove_assignee', label: '👤 Responsável', changed: false, skippedAsAlready: true, verified: true, error: null });
      } else {
        put.removeAssignees = idsARemover;
        outcomes.push({ field: 'remove_assignee', label: `👤 Responsável (remover ${rotuloRemocao})`, changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => !relida.assignees.some((a) => idsARemover.includes(a.id)) });
      }
    }
  }

  if (fields.replacePersonName !== undefined) {
    const resolucao = await resolveMemberByName(config, fields.replacePersonName).catch(() => null);
    if (resolucao?.status !== 'resolved') {
      outcomes.push({ field: 'replace_assignee', label: '👤 Responsável', changed: false, skippedAsAlready: false, verified: false, error: `não encontrei "${fields.replacePersonName}" entre os membros do ClickUp` });
    } else {
      const novaPessoa = resolucao.member;
      const removidos = atual.assignees.filter((a) => a.id !== novaPessoa.id).map((a) => a.id);
      if (removidos.length === 0 && atual.assignees.some((a) => a.id === novaPessoa.id)) {
        outcomes.push({ field: 'replace_assignee', label: '👤 Responsável', changed: false, skippedAsAlready: true, verified: true, error: null });
      } else {
        put.addAssignees = [novaPessoa.id];
        if (removidos.length > 0) put.removeAssignees = removidos;
        const novaPessoaId = novaPessoa.id;
        outcomes.push({
          field: 'replace_assignee',
          label: `👤 Responsável (somente ${novaPessoa.username})`,
          changed: true,
          skippedAsAlready: false,
          verified: false,
          error: null,
          check: (relida) => relida.assignees.some((a) => a.id === novaPessoaId) && !relida.assignees.some((a) => removidos.includes(a.id)),
        });
      }
    }
  }

  if (fields.generateTitle) {
    const tituloGerado = textoGerado && textoGerado.length <= 90 && !textoGerado.includes('\n') ? textoGerado : null;
    const titulo = tituloGerado
      ?? (params.briefingWriter
        ? await params
            .briefingWriter(
              [
                'Crie um TÍTULO curto e operacional (máx 70 caracteres, uma linha, sem aspas) pra uma task com o pedido abaixo.',
                '',
                `PEDIDO: ${[params.solicitacaoAnterior, params.fields.replaceDescription ?? ''].filter(Boolean).join('\n\n') || '(sem detalhes)'}`,
              ].join('\n'),
            )
            .catch(() => null)
        : null);
    const limpo = titulo?.split('\n')[0]?.replace(/^["“]|["”]$/g, '').trim().slice(0, 90) || null;
    if (!limpo) {
      outcomes.push({ field: 'title', label: '✏️ Título', changed: false, skippedAsAlready: false, verified: false, error: 'não consegui gerar um título agora — o atual ficou intacto' });
    } else {
      put.name = limpo;
      outcomes.push({ field: 'title', label: '✏️ Título', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.name === limpo });
    }
  }

  // ANEXO na mesma task: só com imagem real da conversa; sem ela, falha de
  // CAMPO (as outras edições seguem) — nunca perde o resto do pedido.
  if (fields.attachImage) {
    const imagens = (params.attachments ?? []).filter((a) => a.contentType?.startsWith('image/'));
    const imagem = imagens.at(-1) ?? (params.attachments ?? []).at(-1);
    if (!imagem) {
      outcomes.push({ field: 'attachment', label: '🖼️ Imagem', changed: false, skippedAsAlready: false, verified: false, error: 'não encontrei nenhuma imagem nesta conversa — me envia a imagem que eu anexo nela' });
    } else if (atual.attachments.some((a) => a.title === imagem.filename)) {
      outcomes.push({ field: 'attachment', label: '🖼️ Imagem', changed: false, skippedAsAlready: true, verified: true, error: null });
    } else {
      const tituloArquivo = imagem.filename;
      try {
        await uploadTaskAttachment(config, taskId, imagem.url, imagem.filename);
        record('clickup.upload_attachment', `${imagem.filename} -> ${taskId}`, true);
        // Anexo é escrita de verdade: destrava o read-back abaixo mesmo sem PUT.
        escreveu = true;
        outcomes.push({
          field: 'attachment',
          label: '🖼️ Imagem',
          changed: true,
          skippedAsAlready: false,
          verified: false,
          error: null,
          check: (relida) => relida.attachments.some((a) => a.title === tituloArquivo),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        record('clickup.upload_attachment', `-> ${taskId}`, false, detail);
        outcomes.push({ field: 'attachment', label: '🖼️ Imagem', changed: false, skippedAsAlready: false, verified: false, error: `falha ao anexar: ${detail}` });
      }
    }
  }


  /* ------------------------------------------------------------------ *
   * 28/09/2026 — o que NÃO cabe no PUT /task: tag, dependência, campo
   * personalizado e checklist são endpoints próprios do ClickUp. Cada um
   * reporta seu próprio resultado, e falha de um não derruba os outros:
   * quem pediu três coisas prefere duas feitas e uma explicada a um "não".
   *
   * RODA ANTES do early-return de "já estava assim" logo abaixo, e isso não
   * é detalhe de ordem: medido no ClickUp real no mesmo dia, "marca essa task
   * com a tag qa-teste" chegava lá com `outcomes` vazio (nenhum campo de PUT
   * foi pedido) e era respondido "✅ Já estava assim" sem nunca ter tentado
   * aplicar a tag. Todo pedido precisa virar outcome ANTES de alguém concluir
   * que não havia pedido nenhum.
   * ------------------------------------------------------------------ */
  for (const tag of fields.addTags ?? []) {
    if (atual.tags.some((t) => t.toLowerCase() === tag.trim().toLowerCase())) {
      outcomes.push({ field: `tag:${tag}`, label: `🏷️ Tag "${tag}"`, changed: false, skippedAsAlready: true, verified: true, error: null });
      continue;
    }
    try {
      await addTaskTag(config, taskId, tag);
      record('clickup.add_tag', `${tag} -> ${taskId}`, true);
      escreveu = true;
      outcomes.push({ field: `tag:${tag}`, label: `🏷️ Tag "${tag}"`, changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.tags.some((t) => t.toLowerCase() === tag.trim().toLowerCase()) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      record('clickup.add_tag', `${tag} -> ${taskId}`, false, detail);
      outcomes.push({ field: `tag:${tag}`, label: `🏷️ Tag "${tag}"`, changed: false, skippedAsAlready: false, verified: false, error: detail });
    }
  }

  for (const tag of fields.removeTags ?? []) {
    try {
      await removeTaskTag(config, taskId, tag);
      record('clickup.remove_tag', `${tag} -> ${taskId}`, true);
      escreveu = true;
      outcomes.push({ field: `untag:${tag}`, label: `🏷️ Tag "${tag}" removida`, changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => !relida.tags.some((t) => t.toLowerCase() === tag.trim().toLowerCase()) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      record('clickup.remove_tag', `${tag} -> ${taskId}`, false, detail);
      outcomes.push({ field: `untag:${tag}`, label: `🏷️ Tag "${tag}" removida`, changed: false, skippedAsAlready: false, verified: false, error: detail });
    }
  }

  if (fields.customFields && Object.keys(fields.customFields).length > 0) {
    // Os campos são definidos POR LISTA — sem a lista da task não há o que
    // resolver, e inventar id de campo é exatamente o que não pode acontecer.
    const listaDaTask = atual.listId;
    const disponiveis = listaDaTask ? await listCustomFields(config, listaDaTask).catch(() => null) : null;
    for (const [nome, valor] of Object.entries(fields.customFields)) {
      if (!disponiveis) {
        outcomes.push({ field: `cf:${nome}`, label: `🧩 ${nome}`, changed: false, skippedAsAlready: false, verified: false, error: 'não consegui ler os campos personalizados dessa lista' });
        continue;
      }
      const resolvido = resolverCampoPersonalizado(disponiveis, nome, valor);
      if (ehFalhaDeCampo(resolvido)) {
        outcomes.push({ field: `cf:${nome}`, label: `🧩 ${nome}`, changed: false, skippedAsAlready: false, verified: false, error: explicarFalhaDeCampo(resolvido) });
        continue;
      }
      try {
        await setCustomFieldValue(config, taskId, resolvido.fieldId, resolvido.value);
        record('clickup.set_custom_field', `${resolvido.fieldName}=${resolvido.rotulo} -> ${taskId}`, true);
        escreveu = true;
        outcomes.push({ field: `cf:${nome}`, label: `🧩 ${resolvido.fieldName}`, changed: true, skippedAsAlready: false, verified: false, error: null });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        record('clickup.set_custom_field', `${resolvido.fieldName} -> ${taskId}`, false, detail);
        outcomes.push({ field: `cf:${nome}`, label: `🧩 ${resolvido.fieldName}`, changed: false, skippedAsAlready: false, verified: false, error: detail });
      }
    }
  }

  if (fields.checklistItems && fields.checklistItems.length > 0) {
    const nome = fields.checklistName?.trim() || 'Checklist';
    try {
      const checklistId = await createChecklist(config, taskId, nome);
      let criados = 0;
      for (const item of fields.checklistItems) {
        await addChecklistItem(config, checklistId, item).then(() => { criados += 1; }).catch(() => undefined);
      }
      record('clickup.create_checklist', `${nome} (${criados}/${fields.checklistItems.length}) -> ${taskId}`, true);
      escreveu = true;
      const itensAlvo = fields.checklistItems;
      outcomes.push({
        field: 'checklist',
        label: `☑️ Checklist "${nome}"`,
        changed: true,
        skippedAsAlready: false,
        verified: false,
        error: criados === itensAlvo.length ? null : `${criados}/${itensAlvo.length} itens criados`,
        // Confere na task relida, não na resposta da criação.
        /**
         * Comparação NORMALIZADA (29/09/2026). Era igualdade exata de string
         * por item, e o ClickUp devolve o item com espaçamento próprio — um
         * trim do lado dele reprovava um checklist que entrou inteiro. Dobra
         * espaço e caixa dos dois lados; o conteúdo é o que importa, não o
         * espaçamento com que o provedor devolveu.
         */
        check: (relida) => checklistConfere(relida.checklists, nome, itensAlvo),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      record('clickup.create_checklist', `${nome} -> ${taskId}`, false, detail);
      outcomes.push({ field: 'checklist', label: `☑️ Checklist "${nome}"`, changed: false, skippedAsAlready: false, verified: false, error: detail });
    }
  }

  for (const nome of fields.addWatcherNames ?? []) {
    const r = await resolveMemberByName(config, nome).catch(() => null);
    if (!r || r.status !== 'resolved') {
      outcomes.push({ field: `watcher:${nome}`, label: `👀 Seguidor "${nome}"`, changed: false, skippedAsAlready: false, verified: false, error: `não encontrei "${nome}" entre os membros do ClickUp` });
      continue;
    }
    try {
      await updateTaskWatchers(config, taskId, { add: [r.member.id] });
      record('clickup.add_watcher', `${r.member.username} -> ${taskId}`, true);
      escreveu = true;
      // Sem `check` o read-back nunca confirma e a resposta acusa falso
      // alarme: medido no ClickUp real — a Tammy ENTROU como seguidora e o
      // Bento respondeu "escrito, mas a releitura não confirmou".
      const seguidorId = r.member.id;
      /**
       * AUSENTE não é VAZIO (29/09/2026).
       *
       * O parse fazia `raw.watchers ?? []`, então "o ClickUp não devolveu o
       * campo" ficava indistinguível de "o seguidor não foi adicionado" — e o
       * Bento acusava "escrito, mas a releitura não confirmou" sobre escrita
       * que funcionou. Agora `watchers: null` quer dizer "não deu pra
       * conferir", e o check aceita: afirmar falha sem ter olhado é pior do que
       * admitir que não olhou.
       */
      outcomes.push({ field: `watcher:${nome}`, label: `👀 Seguidor`, changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => seguidorConfere(relida.watchers, seguidorId) });
    } catch (error) {
      const d = error instanceof Error ? error.message : String(error);
      record('clickup.add_watcher', `${nome} -> ${taskId}`, false, d);
      outcomes.push({ field: `watcher:${nome}`, label: `👀 Seguidor "${nome}"`, changed: false, skippedAsAlready: false, verified: false, error: d });
    }
  }

  if (fields.addToListId) {
    const destino = fields.addToListName ?? fields.addToListId;
    try {
      await addTaskToList(config, taskId, fields.addToListId);
      record('clickup.add_to_list', `${destino} -> ${taskId}`, true);
      escreveu = true;
      // "também" é a palavra certa: a task continua na lista de origem.
      outcomes.push({ field: 'lista', label: `📋 Também na lista "${destino}"`, changed: true, skippedAsAlready: false, verified: false, error: null });
    } catch (error) {
      const d = error instanceof Error ? error.message : String(error);
      record('clickup.add_to_list', `${destino} -> ${taskId}`, false, d);
      outcomes.push({ field: 'lista', label: `📋 Também na lista "${destino}"`, changed: false, skippedAsAlready: false, verified: false, error: d });
    }
  }

  if (fields.tempo) {
    try {
      await registrarTempo(config, config.teamId, { taskId, ...fields.tempo });
      record('clickup.time_entry', `${fields.tempo.duracaoMs}ms -> ${taskId}`, true);
      escreveu = true;
      outcomes.push({ field: 'tempo', label: '⏲️ Horas apontadas', changed: true, skippedAsAlready: false, verified: false, error: null });
    } catch (error) {
      const d = error instanceof Error ? error.message : String(error);
      record('clickup.time_entry', `-> ${taskId}`, false, d);
      outcomes.push({ field: 'tempo', label: '⏲️ Horas apontadas', changed: false, skippedAsAlready: false, verified: false, error: d });
    }
  }

  for (const [campo, rotulo, params] of [
    ['depends_on', '🔗 Depende de', { dependsOn: fields.dependsOnTaskId }],
    ['dependency_of', '🔗 Bloqueia', { dependencyOf: fields.dependencyOfTaskId }],
  ] as Array<[string, string, { dependsOn?: string; dependencyOf?: string }]>) {
    const alvo = params.dependsOn ?? params.dependencyOf;
    if (!alvo) continue;
    try {
      await addTaskDependency(config, taskId, params);
      record('clickup.add_dependency', `${campo}=${alvo} -> ${taskId}`, true);
      escreveu = true;
      outcomes.push({ field: campo, label: `${rotulo} ${alvo}`, changed: true, skippedAsAlready: false, verified: false, error: null });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      record('clickup.add_dependency', `${campo}=${alvo} -> ${taskId}`, false, detail);
      outcomes.push({ field: campo, label: `${rotulo} ${alvo}`, changed: false, skippedAsAlready: false, verified: false, error: detail });
    }
  }


  // 3. TUDO JÁ ESTAVA CERTO — não reescreve (idempotência, regra §8/§17).
  const mudancas = outcomes.filter((o) => o.changed);
  const falhasDeCampo = outcomes.filter((o) => o.error);
  const briefingPendente = fields.briefAddition !== undefined;
  if (mudancas.length === 0 && falhasDeCampo.length === 0 && !briefingPendente) {
    const linhas = ['✅ Já estava assim — não alterei novamente.', '', nomeTask, ''];
    for (const o of outcomes) {
      const valor =
        o.field === 'due' && fields.dueDate
          ? dataBR(fields.dueDate)
          : o.field === 'assignee' && member
            ? member.username
            : o.field === 'priority' && fields.priority
              ? PRIORIDADE_LABEL[fields.priority]
              : o.field === 'status'
                ? (atual.status ?? '')
                : '';
      linhas.push(`${o.label}: ${valor} (já era esse)`);
    }
    linhas.push('', `🔄 ClickUp: estado atual lido agora, sem nova escrita`);
    return respond(linhas.join('\n'), true, {
      guard: 'bento-action',
      action: 'update_idempotent_noop',
      task_id: taskId,
      verified: true,
      execucao: execucaoDe(taskId, nomeTask, true, member, fields, outcomes.map((o) => `${o.label}: ${valorDoCampo(o, fields, member, {})} (já era esse)`)),
    });
  }

  // 4. ESCRITA — um PUT com tudo que mudou; briefing é acréscimo separado.
  const CAMPOS_DO_PUT = new Set(['assignee', 'due', 'priority', 'status', 'title', 'description', 'remove_assignee', 'replace_assignee', 'start', 'estimate']);
  if (Object.keys(put).length > 0) {
    try {
      await updateTask(config, taskId, {
        ...(put.dueDate !== undefined ? { dueDate: put.dueDate as number | null } : {}),
        ...(put.priority !== undefined ? { priority: put.priority as 1 | 2 | 3 | 4 } : {}),
        ...(put.status !== undefined ? { status: put.status as string } : {}),
        ...(put.name !== undefined ? { name: put.name as string } : {}),
        ...(put.description !== undefined ? { description: put.description as string } : {}),
        ...(put.addAssignees !== undefined ? { addAssignees: put.addAssignees as number[] } : {}),
        ...(put.removeAssignees !== undefined ? { removeAssignees: put.removeAssignees as number[] } : {}),
        ...(put.startDate !== undefined ? { startDate: put.startDate as number } : {}),
        ...(put.timeEstimate !== undefined ? { timeEstimate: put.timeEstimate as number } : {}),
      });
      record('clickup.update_task', `${Object.keys(put).join('+')} -> ${taskId}`, true);
      escreveu = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      record('clickup.update_task', `-> ${taskId}`, false, detail);
      for (const o of outcomes.filter((o) => o.changed && CAMPOS_DO_PUT.has(o.field))) o.error = detail;
      logger.warn({ task_id: taskId, error: detail }, '[update] ClickUp recusou o PUT');
    }
  }

  if (briefingPendente && fields.briefAddition) {
    // ACÉRCIMO, nunca substituição (a regra do UPDATE_BRIEF original).
    const descricaoNova = `${atual.description}\n\n## ATUALIZAÇÃO\n${fields.briefAddition}`;
    try {
      await updateTask(config, taskId, { description: descricaoNova });
      record('clickup.update_task', `brief +${fields.briefAddition.length}c -> ${taskId}`, true);
      escreveu = true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      record('clickup.update_task', `brief -> ${taskId}`, false, detail);
      outcomes.push({ field: 'brief', label: '📝 Briefing', changed: true, skippedAsAlready: false, verified: false, error: detail });
    }
    if (!outcomes.some((o) => o.field === 'brief')) {
      const trecho = fields.briefAddition.slice(0, 120);
      outcomes.push({ field: 'brief', label: '📝 Briefing', changed: true, skippedAsAlready: false, verified: false, error: null, check: (relida) => relida.description.includes(trecho) });
    }
  }

  // 5. READ-BACK de tudo que foi escrito.
  if (escreveu) {
    const relida = await getTask(config, taskId).catch(() => null);
    record('clickup.get_task', `read-back ${taskId}`, relida !== null, relida === null ? 'não consegui reler' : undefined);
    if (relida) {
      // Verificação campo a campo: só marca verified quem passa na SUA regra.
      for (const o of outcomes) {
        if (!o.changed || o.error) continue;
        o.verified = o.check ? o.check(relida) : false;
      }
    }
  }

  const verificados = outcomes.filter((o) => (o.changed || o.skippedAsAlready) && o.verified);
  const comErro = outcomes.filter((o) => o.error || (o.changed && !o.verified));
  const tudoOk = comErro.length === 0 && (escreveu || outcomes.every((o) => o.verified));

  // 6. RECIBO HUMANO — hierarquia: veredito, nome, uma linha por campo.
  const linhas: string[] = [];
  if (tudoOk) {
    linhas.push('✅ Task atualizada');
  } else if (verificados.length > 0) {
    linhas.push('⚠️ Atualização parcial');
  } else {
    linhas.push('❌ Não consegui alterar essa task.');
  }
  linhas.push('', nomeTask, '');
  for (const o of outcomes) {
    if (o.error) {
      linhas.push(`❌ ${o.label}: ${o.error}`);
    } else if (o.skippedAsAlready) {
      linhas.push(`${o.label}: ${valorDoCampo(o, fields, member, put)} (já estava certo — não reescrevi)`);
    } else if (o.verified) {
      const valor = valorDoCampo(o, fields, member, put);
      linhas.push(`${o.label}: ${valor}`);
    } else {
      linhas.push(`⚠️ ${o.label}: escrito, mas a releitura não confirmou`);
    }
  }
  linhas.push('');
  linhas.push(tudoOk ? '🔄 ClickUp: alteração conferida por releitura' : '🔄 ClickUp: confira a task — nem tudo foi confirmado na releitura');
  // O link na resposta é o que mantém "dessa task" resolvível no turno
  // seguinte (o contexto da conversa lê a URL do recibo).
  linhas.push(`🔗 https://app.clickup.com/t/${taskId}`);

  logger.info(
    { task_id: taskId, campos: outcomes.map((o) => `${o.field}:${o.error ? 'erro' : o.verified ? 'ok' : 'pendente'}`) },
    '[update] atualização de task existente concluída',
  );

  return respond(linhas.join('\n'), tudoOk, {
    guard: 'bento-action',
    action: outcomes.length > 1 ? 'update_multi' : 'update_single',
    task_id: taskId,
    task_name: nomeTask,
    changed_fields: mudancas.map((o) => o.field),
    verified: tudoOk,
    execucao: execucaoDe(
      taskId,
      nomeTask,
      tudoOk,
      member,
      fields,
      outcomes.filter((o) => o.verified || o.skippedAsAlready).map((o) => `${o.label}: ${valorDoCampo(o, fields, member, put)}`),
    ),
  });
}

function valorDoCampo(o: FieldOutcome, fields: TaskUpdateFields, member: { id: number; username: string } | null, put: Record<string, unknown>): string {
  switch (o.field) {
    case 'due':
      return fields.clearDueDate ? 'removido' : fields.dueDate ? dataBR(fields.dueDate) : '';
    case 'assignee':
      return member?.username ?? '';
    case 'remove_assignee':
      return 'removido';
    case 'replace_assignee':
      return 'ficou como único responsável';
    case 'priority':
      return fields.priority ? PRIORIDADE_LABEL[fields.priority]! : '';
    case 'status':
      return String(put.status ?? '');
    case 'title':
      return String(put.name ?? (fields.generateTitle ? '(gerado)' : ''));
    case 'description':
      return fields.clearDescription ? 'removido' : 'substituído';
    case 'attachment':
      return 'anexada';
    default:
      return 'acrescentado';
  }
}

function execucaoDe(taskId: string, nome: string, ok: boolean, member: { id: number; username: string } | null, fields: TaskUpdateFields, changes: string[]): ExecutionRecord {
  return {
    executionId: `update:${taskId}:${new Date().toISOString()}`,
    operation: 'update',
    taskIds: [taskId],
    targetPerson: member ? { name: member.username, memberId: member.id, username: member.username } : null,
    successIds: ok ? [taskId] : [],
    failedIds: ok ? [] : [{ id: taskId, title: nome, reason: 'a releitura não confirmou todas as alterações' }],
    timestamp: new Date().toISOString(),
    verification: member ? [{ taskId, assigneeVerified: ok }] : [{ taskId }],
    titles: { [taskId]: nome },
    changes,
  };
}
