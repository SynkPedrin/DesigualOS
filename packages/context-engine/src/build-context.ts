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
/**
 * Quantos registros de perfil entram por cliente. Três cobre o caso real
 * medido (brain + dossiê + importação antiga) com folga de um.
 */
const PERFIS_POR_CLIENTE_LIMIT = 3;

/**
 * O TETO DO PERFIL, agora somado entre as fontes e não por fonte.
 *
 * Era 3000 por registro, com um registro só chegando. Medido: 23 dos 101
 * perfis passam de 3000 chars, e o do Cosentino tem 6692 — 55% ia fora antes
 * de qualquer corte de fonte.
 *
 * 7000 foi escolhido contra o dado, não por gosto: cobre inteiro o brain
 * mediano somado ao dossiê, que é o par que o produto promete entregar junto.
 * Custa cerca de 1.750 tokens por turno com cliente selecionado, contra ~750
 * antes. Perfil gigante (11k+) continua sendo cortado — e agora o corte é
 * ANUNCIADO no texto, para o modelo saber que existe mais e não afirmar
 * completude sobre o que leu.
 */
const CLIENT_PROFILE_MAX_CHARS = 7000;
const PROJECT_FILES_LIMIT = 5;
const PROJECT_FILE_MAX_CHARS = 2000;
/**
 * APRENDIZADOS POR TURNO: 3 -> 8.
 *
 * O 3 vinha de quando o filtro era só por AGENTE: sem recorte de cliente, os
 * "3 mais importantes do Otto" entravam em todo turno, de qualquer conta, e
 * três era o teto seguro para uma lista que podia estar falando de outro
 * cliente. Esse recorte foi corrigido em 16/09 — hoje só entra aprendizado do
 * cliente da conversa ou da agência.
 *
 * Com o escopo certo, 3 virou um teto herdado de um problema que não existe
 * mais. Medido: o Cosentino tem 35 aprendizados elegíveis, e 32 nunca
 * chegavam. Oito cobre o volume típico sem transformar o prompt num despejo —
 * e a ordenação por importância continua decidindo QUEM entra.
 */
const RECENT_LEARNINGS_LIMIT = 8;
const LEARNING_MAX_CHARS = 300;
/** kind reservado ao dossiê do cliente (já tratado à parte acima); nunca deve duplicar aqui. */
const CLIENT_PROFILE_KIND = 'client.profile';

/**
 * Corte limpo: se houver um espaço razoavelmente perto do limite, corta nele
 * pra não quebrar uma palavra no meio; senão corta seco mesmo.
 */
/**
 * O rótulo de cada fonte, tirado do `subject` que o importador grava.
 *
 * Existe porque as duas fontes dizem coisas de natureza diferente e o modelo
 * precisa saber qual está lendo: o brain é o registro CRIATIVO (tom, público,
 * o que a marca não faz) e o dossiê é o OPERACIONAL (pendência, conta de
 * mídia, quem decide). Colar os dois num bloco sem nome faria uma restrição
 * criativa parecer regra operacional, e vice-versa.
 */
function rotuloDaFonte(metadata: unknown): string {
  const subject = (metadata as { subject?: unknown } | null)?.subject;
  const texto = typeof subject === 'string' ? subject : '';
  if (texto.endsWith(':brain')) return 'Perfil criativo (brain)';
  if (texto.endsWith(':dossie')) return 'Ficha operacional (dossiê)';
  if (texto.includes(':aprendizado:')) return 'Aprendido com a equipe';
  return 'Registro do cliente';
}

/**
 * Junta os registros do cliente num bloco só, com procedência e sem mentir
 * sobre o que coube.
 *
 * O orçamento é COMPARTILHADO e gasto na ordem em que os registros vêm (mais
 * recente primeiro). Quando um registro não cabe inteiro, ele é cortado e o
 * corte é ANUNCIADO — um modelo que lê um dossiê truncado sem aviso responde
 * com a confiança de quem leu tudo, que é o defeito mais caro que este produto
 * já teve.
 */
export function juntarPerfis(registros: ReadonlyArray<{ content: string; metadata: unknown }>): string | null {
  if (registros.length === 0) return null;

  const partes: string[] = [];
  let restante = CLIENT_PROFILE_MAX_CHARS;

  for (const r of registros) {
    if (restante <= 200) {
      // Menos de 200 chars não cabe nem um parágrafo útil: em vez de um toco
      // sem sentido, diz que existe mais e para por aqui.
      partes.push(`[${rotuloDaFonte(r.metadata)}: existe, mas não coube neste turno.]`);
      break;
    }
    const cabe = r.content.length <= restante;
    const texto = cabe ? r.content : truncateClean(r.content, restante);
    partes.push(
      `--- ${rotuloDaFonte(r.metadata)}${cabe ? '' : ' (cortado por tamanho — há mais registrado)'} ---\n${texto}`,
    );
    restante -= texto.length;
  }

  return partes.join('\n\n');
}

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
  /**
   * Ambiente do turno (F-12, auditoria de 26/09/2026): sem este filtro, memória
   * de QA entrava no contexto de produção pelas duas queries de `memories`
   * abaixo. Quando omitido, é RESOLVIDO do cliente do turno (a query de cliente
   * já acontece de qualquer jeito) — nunca assumido cegamente. O fallback
   * 'production' só é alcançado quando não há cliente de onde resolver, e
   * coincide com o default do resto da stack de cognição.
   */
  environment?: string;
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

  // O ambiente viaja com o cliente: a query de cliente já existia no lote,
  // então resolver custa zero round-trips a mais — basta selecionar a coluna.
  const clientRowsPromise = params.clientId
    ? Promise.all([
        db
          .select({ name: schema.clients.name, environment: schema.clients.environment })
          .from(schema.clients)
          .where(eq(schema.clients.id, params.clientId)),
        db
          .select({ toneOfVoice: schema.clientBrandKits.toneOfVoice })
          .from(schema.clientBrandKits)
          .where(eq(schema.clientBrandKits.clientId, params.clientId)),
      ])
    : null;
  const ambientePromise: Promise<string> = params.environment
    ? Promise.resolve(params.environment)
    : clientRowsPromise
      ? clientRowsPromise.then(
          ([clientes]) => clientes[0]?.environment ?? 'production',
          // Sem cliente legível, o lado seguro do isolamento é produção:
          // memória de QA fica de fora, nunca o contrário.
          () => 'production',
        )
      : Promise.resolve('production');

  const [userRow, clientRows, recentRows, profileRows, fileRows, learningRows] = await Promise.all([
    db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, params.userId)),
    clientRowsPromise,
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
      ? (async () => {
          const ambiente = await ambientePromise;
          return db
            .select({ content: schema.memories.content, metadata: schema.memories.metadata })
            .from(schema.memories)
            .where(
              and(
                eq(schema.memories.clientId, params.clientId!),
                eq(schema.memories.kind, CLIENT_PROFILE_KIND),
                /**
                 * SÓ REGISTRO COM PROCEDÊNCIA.
                 *
                 * Os importadores de hoje (sync-brains.mts, sync-dossies.mts)
                 * sempre marcam `metadata.subject` — `cliente:<id>:brain` ou
                 * `:dossie`. Existe no banco uma terceira linha por cliente, sem
                 * subject, de 12 mil caracteres: resíduo de um importador
                 * ANTERIOR (`import-client-memories.ts`) que fazia upsert por
                 * clientId+kind e nunca foi limpo quando o sistema novo entrou.
                 *
                 * Não é duplicata do mesmo processo — é uma versão velha do
                 * mesmo cliente, que pode CONTRADIZER o brain atual. Deixá-la
                 * disputar orçamento é pagar tokens para o modelo ler duas
                 * verdades diferentes sobre a mesma conta e escolher uma.
                 *
                 * (Achado pela outra sessão ao corrigir o mesmo defeito no
                 * `get_client_context` do MCP; filtro igual dos dois lados.)
                 */
                sql`${schema.memories.metadata}->>'subject' is not null`,
                // Só fato ATIVO. Sem isto, memória aposentada (status 'superseded') e fato
                // vencido (expires_at no passado) continuavam entrando no prompt — o que
                // anularia toda a supersessão do memory-engine, porque quem monta o contexto
                // é esta consulta e não a recuperação de lá.
                eq(schema.memories.status, 'active'),
                or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`),
                // ISOLAMENTO DE AMBIENTE (F-12): dossiê de homologação (QA) não
                // entra num turno de produção, nem dossiê real num turno de QA.
                eq(schema.memories.environment, ambiente),
              ),
            )
            .orderBy(desc(schema.memories.updatedAt))
            /**
             * TODOS OS REGISTROS, não só o mais recente.
             *
             * Era `.limit(1)`, e isso contradizia uma regra escrita do projeto.
             * O CLAUDE.md diz, sobre o registro criativo (brain) e o
             * operacional (dossiê): "Cada cliente tem até dois registros, que
             * NÃO SE SUBSTITUEM". No código, o mais recente substituía o outro
             * em silêncio.
             *
             * Medido no Cosentino em 30/09/2026: três perfis ativos — brain
             * (6692 chars, 17/09), dossiê (2766, 16/09) e um terceiro de
             * importação (11983, 08/09). Só o brain chegava. O dossiê, que é
             * onde mora pendência, conta de mídia e dado comercial, nunca
             * entrou num turno.
             *
             * O teto continua existindo, agora em `PERFIL_TETO_TOTAL` — o que
             * não pode existir é uma FONTE inteira sumir por ser um dia mais
             * velha que a outra.
             */
            .limit(PERFIS_POR_CLIENTE_LIMIT)
            .catch(() => [] as Array<{ content: string; metadata: unknown }>);
        })()
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
      ? (async () => {
          const ambiente = await ambientePromise;
          return db
            .select({ content: schema.memories.content })
            .from(schema.memories)
            .where(
              and(
                eq(schema.memories.agentId, agentId),
                ne(schema.memories.kind, CLIENT_PROFILE_KIND),
                eq(schema.memories.status, 'active'),
                or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`),
                // Mesmo isolamento de ambiente do dossiê (F-12): aprendizado
                // gravado em homologação não vaza pro turno real.
                eq(schema.memories.environment, ambiente),
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
            .catch(() => [] as { content: string }[]);
        })()
      : Promise.resolve([]),
  ]);

  const [user] = userRow;
  const [clientRow, brandKitRow] = clientRows ?? [[], []];

  return {
    userName: user?.name ?? null,
    clientName: clientRow[0]?.name ?? null,
    clientToneOfVoice: brandKitRow[0]?.toneOfVoice ?? null,
    clientProfile: juntarPerfis(profileRows),
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
    lines.push('O que sabemos deste cliente:');
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
