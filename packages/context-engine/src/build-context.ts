import { and, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AgentName } from '@desigual-os/types';

export interface RecentMessage {
  role: string;
  agent: string | null;
  content: string;
  attachmentUrl: string | null;
  attachmentFilename: string | null;
  attachmentType: string | null;
}

export interface ProjectFileContext {
  filename: string;
  kind: string;
  textContent: string | null;
}

export interface ExecutionContext {
  userName: string | null;
  clientName: string | null;
  clientToneOfVoice: string | null;
  /** Dossiê do cliente (memórias kind 'client.profile', registro mais recente). */
  clientProfile: string | null;
  /** Arquivos de texto anexados ao projeto da conversa, quando houver. */
  projectFiles: ProjectFileContext[];
  recentMessages: RecentMessage[];
  /**
   * Aprendizados recentes do AGENTE que vai responder (memories.kind !=
   * 'client.profile', gravados por recordLearning em
   * packages/orchestrator/src/learning.ts). Até 08/09/2026 essa tabela era
   * escrita mas nunca lida de volta por nenhuma execução - o agente nunca
   * sabia o que já tinha aprendido sobre o próprio trabalho.
   */
  recentLearnings: string[];
}

const RECENT_MESSAGES_LIMIT = 5;
const CLIENT_PROFILE_MAX_CHARS = 3000;
const PROJECT_FILES_LIMIT = 5;
const PROJECT_FILE_MAX_CHARS = 2000;
const RECENT_LEARNINGS_LIMIT = 3;
const LEARNING_MAX_CHARS = 300;
/** kind reservado ao dossiê do cliente (já tratado à parte acima); nunca deve duplicar aqui. */
const CLIENT_PROFILE_KIND = 'client.profile';

/**
 * Corte limpo: se houver um espaço razoavelmente perto do limite, corta nele
 * pra não quebrar uma palavra no meio; senão corta seco mesmo.
 */
function truncateClean(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/**
 * Contexto mínimo por execução (seção 6.4): não busca conhecimento do
 * agente aqui (isso é sob demanda, local ao Node, Fase 04), só o que o
 * Orchestrator já tem à mão sem ir a lugar nenhum: quem é o usuário, qual
 * cliente, e as últimas mensagens da conversa (nunca a conversa inteira).
 */
export async function buildContext(params: {
  userId: string;
  clientId: string | null;
  conversationId: string | null;
  projectId?: string | null;
  /** Agente que vai responder, quando já decidido (chat/routes.ts roda o Router antes de montar o contexto). Sem isso, sem aprendizados recentes no contexto - não dá pra saber de qual agente buscar. */
  agent?: AgentName | null;
}): Promise<ExecutionContext> {
  // As buscas abaixo não dependem uma da outra; rodar em paralelo
  // (Promise.all) em vez de sequencial corta essa chamada, que acontece em
  // TODO chat/execução, de vários round-trips ao banco pra 1.
  //
  // As duas buscas novas (memória do cliente e arquivos do projeto) têm
  // .catch próprio: uma falha nelas (ex: tabela project_files ainda não
  // migrada num ambiente velho) não pode derrubar o resto do contexto,
  // que é o mínimo pra qualquer resposta.
  const agentRow = params.agent
    ? await db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(eq(schema.agents.name, params.agent))
    : [];
  const agentId = agentRow[0]?.id ?? null;

  const [userRow, clientRows, recentRows, profileRows, fileRows, learningRows] = await Promise.all([
    db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, params.userId)),
    params.clientId
      ? Promise.all([
          db
            .select({ name: schema.clients.name })
            .from(schema.clients)
            .where(eq(schema.clients.id, params.clientId)),
          db
            .select({ toneOfVoice: schema.clientBrandKits.toneOfVoice })
            .from(schema.clientBrandKits)
            .where(eq(schema.clientBrandKits.clientId, params.clientId)),
        ])
      : null,
    params.conversationId
      ? db
          .select({
            role: schema.messages.role,
            agent: schema.messages.agent,
            content: schema.messages.content,
            attachmentUrl: schema.messages.attachmentUrl,
            attachmentFilename: schema.messages.attachmentFilename,
            attachmentType: schema.messages.attachmentType,
          })
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, params.conversationId))
          .orderBy(desc(schema.messages.createdAt))
          .limit(RECENT_MESSAGES_LIMIT)
      : Promise.resolve([]),
    params.clientId
      ? db
          .select({ content: schema.memories.content })
          .from(schema.memories)
          .where(
            and(
              eq(schema.memories.clientId, params.clientId),
              eq(schema.memories.kind, CLIENT_PROFILE_KIND),
              // Só fato ATIVO. Sem isto, memória aposentada (status 'superseded') e fato
              // vencido (expires_at no passado) continuavam entrando no prompt — o que
              // anularia toda a supersessão do memory-engine, porque quem monta o contexto
              // é esta consulta e não a recuperação de lá.
              eq(schema.memories.status, 'active'),
              or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`),
            ),
          )
          .orderBy(desc(schema.memories.updatedAt))
          .limit(1)
          .catch(() => [] as { content: string }[])
      : Promise.resolve([]),
    params.projectId
      ? db
          .select({
            filename: schema.projectFiles.filename,
            kind: schema.projectFiles.kind,
            textContent: schema.projectFiles.textContent,
          })
          .from(schema.projectFiles)
          .where(
            and(
              eq(schema.projectFiles.projectId, params.projectId),
              isNotNull(schema.projectFiles.textContent),
            ),
          )
          .limit(PROJECT_FILES_LIMIT)
          .catch(() => [] as ProjectFileContext[])
      : Promise.resolve([]),
    agentId
      ? db
          .select({ content: schema.memories.content })
          .from(schema.memories)
          .where(
            and(
              eq(schema.memories.agentId, agentId),
              ne(schema.memories.kind, CLIENT_PROFILE_KIND),
              eq(schema.memories.status, 'active'),
              or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`),
              // ESCOPO DE CLIENTE (16/09/2026). Antes, o filtro era só por
              // agente: os 3 aprendizados mais importantes do Otto entravam em
              // TODO turno, de qualquer cliente. Medido ao vivo: um episódio de
              // avaliação sobre "campanha de aniversário de loja de tênis"
              // entrou num pedido sobre a campanha Europa V (Cosentino) e o
              // modelo ancorou no cliente errado, escrevendo para o Top Tennis
              // Club. Aprendizado de outro cliente dentro do turno é vazamento
              // entre contas, não memória.
              params.clientId
                ? or(eq(schema.memories.clientId, params.clientId), isNull(schema.memories.clientId))
                : isNull(schema.memories.clientId),
            ),
          )
          // Importância primeiro: com orçamento de 3 aprendizados, o que entra deve ser o
          // que mais importa, não só o mais recente.
          .orderBy(sql`COALESCE(${schema.memories.importance}, 0.5) DESC`, desc(schema.memories.updatedAt))
          .limit(RECENT_LEARNINGS_LIMIT)
          .catch(() => [] as { content: string }[])
      : Promise.resolve([]),
  ]);

  const [user] = userRow;
  const [clientRow, brandKitRow] = clientRows ?? [[], []];

  return {
    userName: user?.name ?? null,
    clientName: clientRow[0]?.name ?? null,
    clientToneOfVoice: brandKitRow[0]?.toneOfVoice ?? null,
    clientProfile: profileRows[0]
      ? truncateClean(profileRows[0].content, CLIENT_PROFILE_MAX_CHARS)
      : null,
    projectFiles: fileRows.map((file) => ({
      filename: file.filename,
      kind: file.kind,
      textContent:
        file.textContent === null ? null : truncateClean(file.textContent, PROJECT_FILE_MAX_CHARS),
    })),
    recentMessages: recentRows.reverse(),
    recentLearnings: learningRows.map((row) => truncateClean(soEstrategia(row.content), LEARNING_MAX_CHARS)),
  };
}

/**
 * O aprendizado existe pra carregar COMO o agente resolveu, não SOBRE O QUE era
 * o pedido anterior. O conteúdo do episódio começa com "Objetivo: <pedido do
 * usuário daquela vez>", e era justamente esse trecho que plantava o assunto de
 * um turno antigo dentro de um turno novo — inclusive com nome de outro cliente
 * e de outra campanha. A estratégia fica; o enunciado alheio sai.
 */
function soEstrategia(conteudo: string): string {
  const semObjetivo = conteudo.replace(/^Objetivo:.*?(?=Estrat[ée]gia vencedora:)/is, '').trim();
  return semObjetivo.length > 0 ? semObjetivo : conteudo;
}

/** Formata o contexto como um bloco de texto curto pra anexar ao prompt. */
export function formatContextForPrompt(context: ExecutionContext): string {
  const lines: string[] = [];
  // buildContext já busca isso do banco (comentário logo acima: "quem é o
  // usuário" faz parte do contexto mínimo), mas nunca chegava a entrar no
  // texto formatado, então o agente nunca sabia com quem estava falando.
  if (context.userName) lines.push(`Usuário: ${context.userName}`);
  if (context.clientName) lines.push(`Cliente: ${context.clientName}`);
  if (context.clientToneOfVoice) lines.push(`Tom de voz do cliente: ${context.clientToneOfVoice}`);
  if (context.clientProfile) {
    lines.push('Dossiê do cliente (memória):');
    lines.push(context.clientProfile);
  }
  if (context.projectFiles.length > 0) {
    lines.push('Arquivos do projeto:');
    for (const file of context.projectFiles) {
      const preview = file.textContent
        ? truncateClean(file.textContent, 500)
        : '(sem texto extraído)';
      lines.push(`- [${file.kind}] ${file.filename}: ${preview}`);
    }
  }
  if (context.recentLearnings.length > 0) {
    lines.push('Aprendizados recentes seus (registrados em execuções anteriores):');
    for (const learning of context.recentLearnings) {
      lines.push(`- ${learning}`);
    }
  }
  if (context.recentMessages.length > 0) {
    lines.push('Histórico recente da conversa:');
    for (const message of context.recentMessages) {
      const speaker = message.role === 'user' ? 'Usuário' : (message.agent ?? 'Assistente');
      // Sem isto, um anexo subido no composer (imagem, PDF, texto) ficava
      // salvo no banco mas nunca chegava ao agente de nenhuma forma - o
      // usuário via o arquivo anexado na própria mensagem, o agente nunca
      // soube que ele existia. Isto não dá visão real da imagem pro agente
      // (nenhum dos backends fala multimodal hoje), mas pelo menos ele sabe
      // que existe um arquivo e onde buscar, em vez de silêncio total.
      const attachment = message.attachmentUrl
        ? ` [anexo: ${message.attachmentFilename ?? 'arquivo'} (${message.attachmentType ?? 'tipo desconhecido'}) - ${message.attachmentUrl}]`
        : '';
      lines.push(`- ${speaker}: ${message.content}${attachment}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '';
}
