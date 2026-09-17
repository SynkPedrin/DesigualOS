import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import {
  buildContext,
  formatContextForPrompt,
  resolveClientFromText,
  resolveDefaultProjectForClient,
} from '@desigual-os/context-engine';
import { route, type RouterDecision } from '@desigual-os/router';
import { dispatchChatMessage } from '@desigual-os/orchestrator';
import {
  AGENT_NAMES,
  STUDIO_BRAND_PLACEMENTS,
  STUDIO_REFERENCE_FIDELITY,
  STUDIO_REFERENCE_ROLES,
  type AgentName,
} from '@desigual-os/types';
import { requireAuth, requirePermission } from '../auth/middleware';
import { claimIdempotency, fulfillIdempotency, idempotencyKey, releaseIdempotency } from '../lib/idempotency';
import { formatOperationalContextForPrompt, resolveOperationalTurn } from '../lib/operational-context';
import {
  agenteAceitaBlocoNaMensagem,
  contextoGeralVaiNaMensagem,
  operacionalPorCampoApartado,
} from './message-assembly';

const AGENT_HINTS = ['AUTO', ...AGENT_NAMES.map((agent) => agent.toUpperCase())] as [
  string,
  ...string[],
];

const chatAttachmentSchema = z.object({
  url: z.string().url(),
  filename: z.string(),
  contentType: z.string(),
  role: z.enum(STUDIO_REFERENCE_ROLES).optional(),
  fidelity: z.enum(STUDIO_REFERENCE_FIDELITY).optional(),
  instruction: z.string().min(1).optional(),
  placement: z.enum(STUDIO_BRAND_PLACEMENTS).optional(),
});

const chatRequestSchema = z.object({
  message: z.string().min(1),
  client_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  agent_hint: z.enum(AGENT_HINTS).default('AUTO'),
  // Anexo já hospedado (upload feito antes via storage); aqui só referência.
  attachment: chatAttachmentSchema.optional(),
  // Múltiplos anexos (2026-09): substitui `attachment`, mantido acima só para
  // compatibilidade com clientes antigos. Ver normalização em `attachments`
  // logo abaixo do parse.
  attachments: z.array(chatAttachmentSchema).max(10).optional(),
});

function manualDecision(agent: AgentName): RouterDecision {
  return {
    intent: 'manual_override',
    primary_agent: agent,
    required_tools: [],
    context: [],
    estimated_complexity: 'medium',
    workflow: null,
    confidence: 1,
    source: 'manual',
  };
}

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/chat',
    { preHandler: [requireAuth, requirePermission('chat', 'write')] },
    async (request, reply) => {
      const body = chatRequestSchema.parse(request.body);
      // Normaliza os dois formatos aceitos pelo wire (array novo, singular
      // legado) num único array; o resto da rota só enxerga `attachments`.
      const attachments = body.attachments ?? (body.attachment ? [body.attachment] : []);
      const user = request.authUser;
      if (!user) {
        reply.code(401);
        return { error: 'Not authenticated' };
      }

      // Idempotência de intenção (auditoria 11/09/2026: double submit criava
      // 2 conversas, 2 mensagens e 2 execuções). A janela de 15s cobre clique
      // duplo e retry de rede sem impedir mandar o mesmo texto de propósito
      // depois. Se o primeiro request ainda está em voo ('pending'), o
      // duplicado recebe 409 em vez de uma segunda execução.
      const idemKey = idempotencyKey('chat', [
        user.id,
        body.conversation_id ?? 'new',
        body.project_id ?? '',
        body.message,
        ...attachments.map((a) => a.url),
      ]);
      const existing = await claimIdempotency(idemKey);
      if (existing !== null) {
        if (existing !== 'pending') {
          try {
            const replay = JSON.parse(existing) as { execution_id: string | null; conversation_id: string | null; agent: string };
            reply.code(202);
            return { ...replay, status: 'queued', deduplicated: true };
          } catch {
            // valor corrompido: cai no 409 abaixo
          }
        }
        reply.code(409);
        return { error: 'Esta mensagem já está sendo processada. Aguarde a resposta antes de reenviar.' };
      }
      // Se qualquer coisa falhar daqui pra frente, o retry legítimo do
      // usuário não pode ficar bloqueado pela chave: libera no throw.
      try {

      // Conversa nova puxando o client_id do projeto (tela de Projeto no chat,
      // "abrir um novo chat dentro desse projeto"): quem manda a mensagem não
      // escolheu cliente nenhum no seletor, mas o projeto já sabe qual é.
      let effectiveClientId = body.client_id ?? null;
      let effectiveProjectId = body.project_id ?? null;
      if (body.project_id) {
        const [project] = await db
          .select({ clientId: schema.projects.clientId })
          .from(schema.projects)
          .where(eq(schema.projects.id, body.project_id));
        if (!project) {
          reply.code(404);
          return { error: `Project '${body.project_id}' not found` };
        }
        // client_id e project_id são independentes no payload; se os dois vierem
        // e apontarem pra clientes diferentes, o contexto misturaria dados de
        // dois clientes na mesma execução. Recusa em vez de escolher um dos dois
        // silenciosamente.
        if (effectiveClientId && project.clientId && effectiveClientId !== project.clientId) {
          reply.code(400);
          return { error: `client_id does not match the client of project '${body.project_id}'` };
        }
        if (!effectiveClientId) effectiveClientId = project.clientId;
      }

      // Conversation Context (seção 6.4): continua uma conversa existente ou
      // abre uma nova. User -> Conversation -> Execution (seção 6.3).
      let conversationId = body.conversation_id ?? null;
      if (conversationId) {
        const [existing] = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId));
        if (!existing) {
          reply.code(404);
          return { error: `Conversation '${conversationId}' not found` };
        }
        // Conversa privada (2026-09-04): só o dono (ou master) continua nela.
        // Pública continua aberta pra qualquer colaborador, como antes.
        if (
          existing.visibility === 'private' &&
          existing.userId !== user.id &&
          !user.roles.includes('master')
        ) {
          reply.code(403);
          return { error: 'This conversation is private' };
        }
        // Uma conversa já pertence a um único cliente/projeto; um client_id ou
        // project_id divergente no payload não pode sobrescrever isso (evita
        // que o contexto de outro cliente vaze pra dentro desta conversa).
        if (existing.clientId && effectiveClientId && effectiveClientId !== existing.clientId) {
          reply.code(400);
          return { error: "client_id does not match this conversation's client" };
        }
        if (existing.projectId && body.project_id && body.project_id !== existing.projectId) {
          reply.code(400);
          return { error: "project_id does not match this conversation's project" };
        }
        effectiveClientId = existing.clientId ?? effectiveClientId;
        effectiveProjectId = existing.projectId ?? effectiveProjectId;
        // Resolução por nome só entra quando a conversa AINDA não tem cliente vinculado. Se já
        // tem, a citação de outro nome de cliente numa mensagem de acompanhamento é ignorada de
        // propósito — nunca gera o erro 400 de divergência (isso é pro seletor da UI, não pra
        // menção incidental em texto) e nunca troca o cliente da conversa no meio do caminho.
        if (!effectiveClientId) {
          const detectado = await resolveClientFromText(body.message);
          if (detectado) effectiveClientId = detectado.id;
        }
        // Projeto "casa" do cliente (ver resolveDefaultProjectForClient): sem isto, uma conversa
        // com clientId mas sem projectId nunca aparece na pasta do cliente na barra lateral —
        // ela agrupa por projectId, não por clientId direto. Só entra quando a conversa ainda não
        // tem projeto (nunca troca um projeto já vinculado).
        if (effectiveClientId && !effectiveProjectId) {
          effectiveProjectId = await resolveDefaultProjectForClient(effectiveClientId);
        }
        // Bug real (09/09/2026, achado em teste ao vivo): as duas resoluções acima só viravam
        // variável local, usada pra montar o contexto DESTE turno - a conversa em si nunca era
        // atualizada. A barra lateral agrupa por `conversations.projectId` (ver
        // resolveDefaultProjectForClient), então uma conversa cujo cliente só foi detectado por
        // TEXTO (nunca pelo seletor da UI) nunca aparecia na pasta do cliente, nem depois de a
        // detecção funcionar perfeitamente na resposta do agente. Só grava o que ainda faltava -
        // nunca sobrescreve um clientId/projectId que a conversa já tinha (mesmo princípio de
        // isolamento das checagens de divergência acima).
        const clientMudou = effectiveClientId && effectiveClientId !== existing.clientId;
        const projetoMudou = effectiveProjectId && effectiveProjectId !== existing.projectId;
        if (clientMudou || projetoMudou) {
          await db
            .update(schema.conversations)
            .set({
              ...(clientMudou ? { clientId: effectiveClientId } : {}),
              ...(projetoMudou ? { projectId: effectiveProjectId } : {}),
            })
            .where(eq(schema.conversations.id, conversationId));
        }
      } else {
        // Cliente citado no NOME da mensagem, sem seletor da UI ("Jarbas, como estão as
        // campanhas da 3NET hoje?" sem clicar em "3Net" no seletor, que é opcional). Gap real
        // medido em 09/09/2026: não existia nenhum mecanismo de extrair nome de cliente de texto
        // livre neste repo, então o agente recebia zero contexto de cliente sempre que o usuário
        // não usasse o seletor. Só entra quando client_id/project_id não resolveram nada — nunca
        // sobrescreve uma escolha explícita.
        if (!effectiveClientId) {
          const detectado = await resolveClientFromText(body.message);
          if (detectado) effectiveClientId = detectado.id;
        }
        // Mesma resolução de projeto "casa" do cliente do outro ramo (conversa existente) —
        // aqui cobre tanto o client_id explícito quanto o detectado agora por texto.
        if (effectiveClientId && !effectiveProjectId) {
          effectiveProjectId = await resolveDefaultProjectForClient(effectiveClientId);
        }

        const [conversation] = await db
          .insert(schema.conversations)
          .values({
            userId: user.id,
            clientId: effectiveClientId,
            projectId: effectiveProjectId,
            title: body.message.slice(0, 80),
          })
          .returning();
        conversationId = conversation?.id ?? null;
      }

      if (!conversationId) {
        // Só chega aqui se o insert da nova conversa acima não retornou
        // linha nenhuma (ex: constraint bloqueando); antes disso virava
        // `conversationId: ''` no insert de messages.conversationId, uma
        // coluna uuid NOT NULL, e o Postgres respondia com um 500 cru de
        // "invalid input syntax" em vez de um erro claro.
        reply.code(500);
        return { error: 'Failed to create conversation' };
      }

      /**
       * ESTADO DO TURNO ANTERIOR desta conversa, lido ANTES de inserir a
       * mensagem nova (senão a "anterior" seria ela mesma).
       *
       * Conversa é stateful e a pessoa não repete o contexto: depois de ver o
       * panorama ela pergunta "e se eu só puder três?". Sem isto, essa frase
       * não tinha sinal operacional nenhum, a consulta ao ClickUp não
       * acontecia, e a resposta era "os dados não estão disponíveis neste
       * turno" — logo depois de o próprio agente ter mostrado a operação
       * inteira. Medido no navegador em 17/09/2026.
       */
      const anteriores = (await db
        .execute(
          sql`select metadata from messages
              where conversation_id = ${conversationId}::uuid and role = 'user'
              order by created_at desc limit 1`,
        )
        .catch(() => [] as unknown[])) as unknown as Array<{ metadata: Record<string, unknown> | null }>;
      const escopoAnterior =
        (anteriores[0]?.metadata as { escopo?: { kind: string; operational: boolean } } | null)?.escopo ?? null;

      const [userMessage] = await db
        .insert(schema.messages)
        .values({
          conversationId,
          role: 'user',
          content: body.message,
          // Colunas legadas seguem guardando só o primeiro anexo (schema não
          // migrado ainda); a lista completa vai em `metadata.attachments`.
          attachmentUrl: attachments[0]?.url ?? null,
          attachmentType: attachments[0]?.contentType ?? null,
          attachmentFilename: attachments[0]?.filename ?? null,
          metadata: attachments.length ? { attachments } : {},
        })
        .returning();

      const decision =
        body.agent_hint === 'AUTO'
          ? await route(body.message, request.log)
          : manualDecision(body.agent_hint.toLowerCase() as AgentName);

      // As duas montagens são independentes (a de contexto lê o banco pela
      // decision; a operacional lê mensagem+usuário e às vezes o ClickUp).
      // Com o Postgres remoto a ~130ms de RTT, rodar em série somava os dois
      // tempos no ack do chat (medido ~3s na auditoria de 11/09/2026).
      const [context, operationalTurn] = await Promise.all([
        buildContext({
          userId: user.id,
          clientId: effectiveClientId,
          conversationId,
          projectId: effectiveProjectId,
          agent: decision.primary_agent,
        }),
        resolveOperationalTurn(
          body.message,
          user,
          new Date(),
          escopoAnterior ? { kind: escopoAnterior.kind as never, operational: escopoAnterior.operational } : null,
        ),
      ]);
      const contextBlock = formatContextForPrompt(context);
      // O Bento NÃO recebe o bloco de contexto, e isso é deliberado.
      //
      // O bento-qa usa a mensagem INTEIRA como consulta vetorial (retrieveChunks em
      // packages/bento-qa/src/qa.js). Tudo que a gente gruda aqui entra no embedding da busca, e o
      // bloco de contexto é grande: nome do usuário, dossiê do cliente, arquivos do projeto (500
      // chars cada), aprendizados e o histórico recente inteiro da conversa. Medido ao vivo em
      // 09/09/2026, a pergunta "Quem cuida do trafego pago dos clientes da agencia?":
      //   consulta limpa    -> 03_Equipe/jarbas-de-andrade-persona.md no rank 2 (documento CERTO)
      //   consulta com bloco -> aprendizados-consolidacao, enxame-estado, site-institucional (zero)
      // O sintoma pro usuário era pior que resposta ruim: o Bento respondia com CITAÇÃO de
      // documento irrelevante (afirmou "a Alicia é responsável pelo tráfego pago" citando o arquivo
      // de um cliente onde ela é a atendente), e chegou a abrir resposta com "Olá super!" porque o
      // `Usuário: <nome>` do bloco entrava no prompt como se fosse parte da pergunta.
      //
      // O custo assumido é perder histórico de conversa nas perguntas ao Bento (follow-up tipo "e o
      // segundo ponto?" não tem o fio). Vale a troca: resposta errada COM fonte destrói a confiança
      // no agente inteiro, que é justamente o que ele existe pra sustentar. Pra recuperar o
      // histórico sem reenvenenar a busca, o /ask do bento-qa precisa de um campo separado de
      // contexto, usado só na síntese e nunca na consulta vetorial.
      //
      // Os outros agentes seguem recebendo: Jarbas e Suzy não fazem busca vetorial na mensagem
      // (Jarbas detecta cliente por nome e puxa da Meta API), e o Otto faz RAG no Brain dele mas
      // com peso muito menor na resposta final.
      //
      // Regra extraída para ./message-assembly.ts (testável; portão do Jarbas, Onda 0).

      // DADO OPERACIONAL AO VIVO (10/09/2026). Antes disto, uma pergunta como "quantas
      // tasks vencem amanhã?" chegava ao agente sem NENHUM dado: não existia primitiva de
      // consulta na operação inteira (só por lista de um cliente), então o agente não tinha
      // como fazer outra coisa além de perguntar "de qual cliente?". Agora o escopo é
      // resolvido aqui (GLOBAL / CLIENTE / MULTI / AMBÍGUO), a janela temporal sai do
      // relógio real, e o dado vem do ClickUp na hora — com precedência declarada sobre
      // memória. Falha de integração vira instrução de admitir a falha, nunca número
      // chutado. Ver packages/context-engine/src/resolve-scope.ts.
      // Briefing tem precedência sobre a lista crua: quando o pedido é "me monte um
      // briefing", mandar as duas coisas duplicaria o mesmo dado no prompt.
      // O escopo resolvido fica GRAVADO no turno: é o que o próximo follow-up
      // elíptico herda. Falha aqui não derruba o chat — perde-se a herança do
      // turno seguinte, não a resposta deste.
      if (userMessage?.id) {
        void db
          .update(schema.messages)
          .set({
            metadata: {
              ...(userMessage.metadata ?? {}),
              escopo: { kind: operationalTurn.scope.kind, operational: operationalTurn.scope.operational },
            },
          })
          .where(eq(schema.messages.id, userMessage.id))
          .catch(() => undefined);
      }

      const operationalBlock =
        operationalTurn.briefingBlock ?? formatOperationalContextForPrompt(operationalTurn.context);

      const partesDaMensagem = [body.message];
      if (contextBlock && contextoGeralVaiNaMensagem(decision.primary_agent)) {
        partesDaMensagem.push(`---\nContexto:\n${contextBlock}`);
      }
      // O Bento agora tem CAMPO SEPARADO pro dado operacional (`operational_context` no
      // /ask dele, implantado em 10/09/2026). Anexar na mensagem era o que fazia o detector
      // de ClickUp dele interceptar com "de qual cliente?" — medido: recusa em 23ms com 10
      // tarefas reais já em mãos. Os outros agentes não têm esse campo, então pra eles o
      // bloco continua indo anexado.
      //
      // O Otto entrou no mesmo caminho em 17/09/2026, por outro motivo: no
      // worker ele tem ContextPack projetado por intenção, e o bloco colado na
      // mensagem entrava por fora dessa projeção. Vindo por campo, o dado ao
      // vivo vira um bloco de fonte como os outros — chega no turno
      // operacional e fica de fora do pedido criativo.
      const operacionalApartado = operacionalPorCampoApartado(decision.primary_agent)
        ? (operationalBlock ?? undefined)
        : undefined;
      // O bloco operacional vai TAMBÉM pro Bento, ao contrário do bloco de contexto geral.
      // Motivo: o problema documentado do Bento é a consulta vetorial ser poluída por texto
      // genérico (nome de usuário, dossiê, histórico) que puxa documento errado do vault. O
      // bloco operacional é diferente em espécie — é resposta factual já pronta, com nome de
      // cliente e de tarefa reais, exatamente os termos que a pergunta operacional deveria
      // buscar. E sem ele o Bento continua sendo o único agente incapaz de responder sobre a
      // operação, que é justamente o papel dele. Se medição futura mostrar degradação de
      // citação no Bento por causa disto, o caminho certo é o campo separado no /ask do
      // bento-qa (usado só na síntese), não voltar a esconder o dado dele.
      // NUNCA anexar o bloco operacional na MENSAGEM do Jarbas/Suzy. Medido em produção
      // 10/09/2026: o serviço deles classifica a mensagem inteira, e um bloco grande com
      // nomes de cliente e palavras como "campanha"/"relatório" dispara o edge case
      // `job_via_whatsapp` (">100 chars" + palavra de job), que responde "recebi seu
      // briefing da <cliente em cache>, tive um problema técnico" e ignora a pergunta.
      // Só o Bento recebe o dado, e por CAMPO SEPARADO (operational_context).
      // Regra extraída para ./message-assembly.ts (testável; portão do Jarbas, Onda 0).
      if (operationalBlock && !operacionalApartado && agenteAceitaBlocoNaMensagem(decision.primary_agent)) {
        partesDaMensagem.push(`---\n${operationalBlock}`);
      }
      const messageWithContext = partesDaMensagem.join('\n\n');

      const result = await dispatchChatMessage({
        message: messageWithContext,
        userId: user.id,
        clientId: effectiveClientId,
        conversationId,
        decision,
        ...(attachments.length ? { attachments } : {}),
        ...(operacionalApartado ? { operationalContext: operacionalApartado } : {}),
      });

      if (result.status === 'unavailable') {
        reply.code(503);
        return { error: result.error };
      }

      request.log.info({ conversationId, messageId: userMessage?.id }, 'Chat message dispatched');

      // Sucesso: registra o resultado pra um reenvio idêntico dentro da
      // janela receber a MESMA execução em vez de criar outra.
      await fulfillIdempotency(
        idemKey,
        JSON.stringify({ execution_id: result.executionId, conversation_id: conversationId, agent: result.agent }),
      );

      reply.code(202);
      return {
        execution_id: result.executionId,
        status: result.status,
        agent: result.agent,
        conversation_id: conversationId,
      };
      } catch (error) {
        // Falha no meio do caminho: libera a chave pra não punir o retry
        // legítimo do usuário com um 409 fantasma.
        await releaseIdempotency(idemKey);
        throw error;
      }
    },
  );
}
