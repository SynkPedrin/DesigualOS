import type { Logger } from '@desigual-os/logging';
import { uploadTaskAttachment, type ClickUpConfig } from '@desigual-os/tool-gateway';
import { classifyDeliveryType, composeBriefing, pendingCriticalFields } from './briefing-composer';
import { extractLabeledFacts, mergeFacts } from './briefing-facts';
import { retrieveBriefingContext } from './briefing-retrieval';
import { evaluateBriefing } from './briefing-quality';
import { costurar, elaborarBriefingSenior } from './briefing-senior';
import type { DeliveryType } from './briefing-schema';

/**
 * bento-task-briefing.ts — o briefing profissional do caminho NOVO.
 *
 * O core (`bento-openai-core.ts`) criava task com o `description` curto que o
 * planner devolvia: título + uma linha. Quem ia executar não recebia objetivo,
 * público, formato, entregável nem critério de aprovação — exatamente a
 * queixa da operação ("o Bento não está fazendo o básico"). O caminho LEGADO
 * já tinha a cadeia certa (recuperação de contexto real do cliente ->
 * briefing por tipo de entrega -> preenchimento das lacunas a partir do
 * próprio pedido -> QA), só que presa lá dentro.
 *
 * Este módulo é essa mesma cadeia, extraída para ser chamada de qualquer
 * caminho. NÃO duplica regra: reusa `retrieveBriefingContext`,
 * `composeBriefing`, `pendingCriticalFields` e `evaluateBriefing` como estão.
 *
 * Regra que não muda: o que não foi recuperado de uma fonte real não entra.
 * Campo sem fonte vira pendência declarada, nunca invenção — é o que separa
 * um briefing executável de um formulário preenchido no automático.
 */

export interface TaskAttachmentInput {
  url: string;
  filename: string;
  contentType?: string | null;
}

export interface BuildTaskBriefingParams {
  /** Pedido bruto do humano — a fonte de maior autoridade. */
  message: string;
  taskTitle: string;
  clientId: string | null;
  clientName: string | null;
  assigneeName: string | null;
  dueDateMs: number | null;
  requestedBy: string;
  /** Sem config o briefing ainda é montado: só não lê comentário de task. */
  config: ClickUpConfig | null;
  /**
   * Completador de texto SEM ferramenta nenhuma (`completeTextSafely`). Usado
   * só para ler o PRÓPRIO pedido e preencher campo crítico que o parser de
   * rótulo não pega por estar escrito em prosa. Nunca inventa dado de cliente.
   */
  briefingWriter?: ((prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>) | undefined;
  attachments?: TaskAttachmentInput[] | undefined;
  logger: Logger;
}

export interface BuiltTaskBriefing {
  /** O briefing FACTUAL, pronto agora. É com ele que a task nasce. */
  markdown: string;
  /**
   * O mesmo briefing com a LEITURA SÊNIOR costurada, quando ela chegar (20-30s).
   * Sai como promessa porque a pessoa que pediu a task quer o link; a análise é
   * pra quem vai executar, e essa abre a task depois. Ver o comentário no corpo.
   */
  comLeituraSenior: Promise<string>;
  deliveryType: DeliveryType;
  missingCritical: string[];
  sourcesConsulted: string[];
  /** 0..1 — vai pro trace, não bloqueia a criação. */
  score: number;
  executable: boolean;
}

/** O pedido em uma linha: é a SITUAÇÃO que originou a demanda. */
function resumoDoPedido(message: string): string {
  const turno = (message.split(/\n-{3,}\n/)[0] ?? message).split(/\n\s*\n/)[0] ?? message;
  return turno.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function rotuloDePrazo(dueDateMs: number | null): string | null {
  if (dueDateMs === null) return null;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(dueDateMs));
}

/**
 * Monta o briefing da task a partir do contexto REAL (pedido, comentários,
 * memória e dossiê do cliente vindos do vault) e declara o que não encontrou.
 */
export async function buildTaskBriefing(params: BuildTaskBriefingParams): Promise<BuiltTaskBriefing> {
  const contexto = await retrieveBriefingContext({
    clientId: params.clientId,
    requestText: params.message,
    taskId: null,
    config: params.config,
  }).catch((error: unknown) => {
    params.logger.warn({ error }, '[bento-task-briefing] recuperação de contexto falhou; briefing segue com o que o pedido traz');
    return { facts: [], references: [], sourcesConsulted: ['pedido do usuário'] };
  });

  const referencias = [...contexto.references];
  for (const anexo of params.attachments ?? []) {
    referencias.push(`${anexo.filename} (${anexo.url})`);
  }

  const composeInput = {
    taskName: params.taskTitle,
    clientName: params.clientName,
    deliveryType: classifyDeliveryType(params.message, params.taskTitle),
    facts: contexto.facts,
    references: referencias,
    requestedBy: params.requestedBy,
    dueDateLabel: rotuloDePrazo(params.dueDateMs),
    assignee: params.assigneeName,
    requestSummary: resumoDoPedido(params.message),
  };

  let composto = composeBriefing(composeInput);

  /**
   * LACUNA DE FORMATO, não de informação: o parser lê "Rótulo: valor", e um
   * pedido em prosa ("um carrossel pra explicar o serviço novo, foco em
   * empresário que já investe em tráfego") tem objetivo e público escritos,
   * só que não rotulados. Pergunta ao completador SÓ pelos campos críticos
   * que faltam, SÓ a partir do próprio pedido, no formato que o parser já lê.
   */
  const lacunas = pendingCriticalFields(composeInput);
  if (lacunas.length > 0 && params.briefingWriter) {
    const molde = lacunas.map((l) => `${l.key}: `).join('\n');
    const resposta = await params
      .briefingWriter(
        [
          'Leia o PEDIDO abaixo. Preencha o MOLDE copiando ou parafraseando SÓ o que o pedido determina explicitamente — nunca invente, nunca deduza além do que está escrito.',
          'Regras: responda usando EXATAMENTE as chaves do molde, uma por linha, "chave: valor". Se o pedido não determinar aquele campo, apague a linha inteira dele — não deixe "chave:" vazio, não escreva "não informado".',
          '',
          `MOLDE:\n${molde}`,
          '',
          `PEDIDO: ${params.message}`,
        ].join('\n'),
      )
      .catch(() => null);
    if (resposta) {
      const interpretados = extractLabeledFacts(resposta, 'pedido do usuário (interpretado)');
      if (interpretados.length > 0) {
        composto = composeBriefing({ ...composeInput, facts: mergeFacts(composeInput.facts, interpretados) });
      }
    }
  }

  /**
   * A LEITURA SÊNIOR DA DEMANDA (28/09/2026). Até aqui o briefing é a ficha:
   * fatos apurados, com procedência. Um sênior não precisa da ficha, precisa
   * do que ela implica — ver briefing-senior.ts. Fato e leitura ficam
   * separados de propósito: o de cima tem fonte, o de baixo tem raciocínio, e
   * o raciocínio não pode afirmar fato novo.
   */
  /**
   * A leitura sênior sai COMO PROMESSA, não como espera (29/09/2026).
   *
   * Medido: ela custa 20-30s, e somava direto no tempo que a pessoa fica
   * olhando "pensando" — criação passou de ~50s pra ~80s. Quem pede uma task
   * quer o link; a análise é pra quem vai executar, e essa pessoa vai abrir a
   * task depois.
   *
   * Então o briefing FACTUAL volta na hora e a elaboração continua correndo.
   * Quem chamou decide o que fazer com ela: o caminho de criação usa isso pra
   * criar a task com os fatos e completar a descrição em seguida, sem ninguém
   * esperando na frente do chat.
   */
  const elaboracaoPendente = params.briefingWriter
    ? elaborarBriefingSenior({
        composto,
        mensagem: params.message,
        clientName: params.clientName,
        escritor: params.briefingWriter,
        logger: params.logger,
      }).catch(() => null)
    : Promise.resolve(null);

  const qa = evaluateBriefing(composto, { clientName: params.clientName });
  params.logger.info(
    {
      task: params.taskTitle,
      tipo: composto.deliveryType,
      score: qa.score,
      executavel: qa.executable,
      fontes: contexto.sourcesConsulted,
      lacunas_criticas: composto.missingCritical,

    },
    '[bento-task-briefing] briefing montado',
  );

  return {
    markdown: composto.markdown,
    /**
     * O MESMO briefing, com a leitura sênior costurada — quando ela chegar.
     * Quem cria a task escreve o factual agora e completa a descrição depois;
     * quem só quer o texto pode esperar aqui.
     */
    comLeituraSenior: elaboracaoPendente.then((e) => {
      if (e) params.logger.info({ task: params.taskTitle, tentativas: e.tentativas }, '[bento-task-briefing] leitura sênior pronta');
      return costurar(composto, e);
    }),
    deliveryType: composto.deliveryType,
    missingCritical: composto.missingCritical,
    sourcesConsulted: contexto.sourcesConsulted,
    score: qa.score,
    executable: qa.executable,
  };
}

export interface AttachResult {
  filename: string;
  ok: boolean;
  error?: string;
}

/**
 * Anexa na task os materiais que vieram com o pedido (print, arquivo, imagem
 * gerada). Best-effort por desenho: o anexo já aparece como REFERÊNCIA no
 * briefing, então falha de upload degrada a task, não invalida a criação —
 * mas cada falha volta nomeada, nunca silenciosa.
 */
export async function attachMaterials(
  config: ClickUpConfig,
  taskId: string,
  attachments: TaskAttachmentInput[],
  logger: Logger,
): Promise<AttachResult[]> {
  const resultados: AttachResult[] = [];
  for (const anexo of attachments) {
    try {
      await uploadTaskAttachment(config, taskId, anexo.url, anexo.filename);
      resultados.push({ filename: anexo.filename, ok: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn({ error: detail, taskId, filename: anexo.filename }, '[bento-task-briefing] anexo não subiu; segue como referência no briefing');
      resultados.push({ filename: anexo.filename, ok: false, error: detail });
    }
  }
  return resultados;
}
