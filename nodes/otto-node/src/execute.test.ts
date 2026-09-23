import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTEXT_BLOCK_MARKER } from '@desigual-os/otto';
import {
  OttoLLMError,
  carouselPlanSchema,
  checkBrainHealth,
  creativePlanSchema,
  creativeStrategySchema,
  bigIdeaAndHooksSchema,
  criticEvaluationSchema,
  loadBrainIndex,
  productionSpecSchema,
  retrieveRelevantKnowledge,
  type BigIdeaAndHooks,
  type CreativeStrategy,
  type CriticEvaluation,
  type OttoLLMProvider,
  type ResearchProvider,
  type RetrieveOptions,
} from '@desigual-os/otto';
import { loadConfig } from './config.js';
import type { OttoNodeDeps } from './execute.js';
import { buildServer } from './server/index.js';

/**
 * Pipeline do turno ponta a ponta via HTTP (app.inject): auth, parse do
 * executeRequestSchema, retrieval no Brain real (tmpdir), provider de LLM
 * FAKE injetado e resposta no formato executeResponseSchema. Nada de rede,
 * nada de Ollama.
 */

const CLIENT_ID = '11111111-2222-4333-8444-555555555555';

const creativePlanFixture = {
  client: 'Cliente Teste',
  objective: 'Gerar demanda pro novo produto',
  audience: 'Donos de pizzaria',
  strategy: 'Prova visual do produto em preparo',
  concept: 'O forno como palco',
  narrative: 'Do disco cru à fatia esticando queijo',
  copy: 'A pizza que o feed inteiro sente o cheiro.',
  art_direction: {
    composition: 'Close centrado, regra dos terços',
    typography: 'Grotesque pesada, caixa alta',
    color: 'Paleta quente de forno a lenha',
    lighting: 'Luz lateral dura, sombras longas',
    photography: 'Macro de textura, vapor real',
    materials: 'Papel craft, cerâmica escura',
    atmosphere: 'Calor de cozinha à noite',
  },
  references: [],
  image_prompt: 'macro shot of pizza slice, cheese pull, dark ceramic, warm side light',
  negative_prompt: 'blurry, watermark, text artifacts',
  technical_specs: '1080x1350, PNG',
  production_requirements: 'Entregar 10 cards numerados',
  quality_criteria: [{ criterion: 'Apetite visual', description: 'A imagem precisa dar fome', weight: 1 }],
  delivery_format: 'Carrossel 1080x1350',
};

/**
 * Copy DISTINTA por slide, de propósito (Otto Senior V1, "Universal
 * Quality Floor" — carousel repetition linter): um texto genérico tipo
 * "Copy do slide N" teria o MESMO conjunto de palavras significativas em
 * todo slide ("copy", "slide" — o número é curto demais pra contar) e
 * dispararia falso positivo em `detectCarouselRepetition`, que julga por
 * vocabulário compartilhado, não pelo rótulo do fixture.
 */
const CAROUSEL_SLIDE_COPIES = [
  'O forno acende às 18h e a fila já começa antes disso.',
  'Cada disco de massa descansa 48 horas antes de ir ao forno.',
  'A farinha vem de um moinho de pedra a 40km daqui.',
  'O queijo derrete e estica porque é feito na hora, todo dia.',
  'Sexta-feira é o único dia com a fornada especial de calabresa.',
  'O cliente que chega primeiro escolhe a mesa da janela.',
  'Reservas só pelo WhatsApp, a partir de terça-feira.',
  'O molho leva seis horas de cozimento em fogo baixo.',
  'Cada mesa recebe uma azeitoneira própria da casa.',
  'Peça a sua pelo aplicativo e retire sem fila.',
];

function makeCarouselFixture(slideCount = 10) {
  const functions = ['hook', 'context', 'development', 'value', 'development', 'value', 'development', 'value', 'context', 'cta'];
  return {
    concept: 'O forno como palco',
    slide_count: slideCount,
    slides: functions.slice(0, slideCount).map((narrativeFunction, index) => ({
      index: index + 1,
      narrative_function: narrativeFunction,
      objective: `Objetivo do slide ${index + 1}`,
      copy: CAROUSEL_SLIDE_COPIES[index % CAROUSEL_SLIDE_COPIES.length],
      visual: `Visual do slide ${index + 1}`,
      composition: `Composição do slide ${index + 1}`,
      layout: `Layout do slide ${index + 1}`,
      image_prompt: `english prompt for slide ${index + 1}`,
    })),
  };
}

interface FakeProviderBehavior {
  /** `opts` recebe o OttoChatOptions do turno (temperature, suppressThinking). */
  chat?: (messages: unknown, opts?: unknown) => Promise<string>;
  chatJson?: (schema: unknown, messages: unknown, opts?: unknown) => Promise<unknown>;
  /**
   * Resposta do critic (Otto Elite Phase 2) quando o teste quer exercer o
   * critic especificamente. Sem isto, `makeDeps` intercepta
   * `criticEvaluationSchema` ANTES de chegar em `behavior.chatJson` e devolve
   * aprovação alta — testes que não são sobre o critic (a maioria) não
   * precisam saber que ele existe pra continuar passando.
   */
  critic?: (messages: unknown) => Promise<unknown>;
  /** Mesma ideia, pra quem quer exercer a camada de estratégia (Otto Elite) especificamente. */
  strategy?: (messages: unknown) => Promise<unknown>;
  bigIdea?: (messages: unknown) => Promise<unknown>;
}

const STRATEGY_ANGLE_SCORES = {
  objective_fit: 8, audience_fit: 8, brand_fit: 8, originality: 8,
  hook_potential: 8, visual_potential: 8, executability: 8, factual_safety: 8,
};

/** Estratégia padrão: 4 ângulos válidos, específicos o bastante pra passar no teste de genericidade. */
const STRATEGY_APPROVES: CreativeStrategy = {
  audience_insight: 'público já cansado de processos longos',
  tension: 'quer decidir rápido, mercado empurra burocracia',
  opportunity: 'ser a marca que remove a fricção',
  promise_or_message: 'abertura sem cadastro',
  communication_job: 'reduzir a objeção de burocracia antes da visita',
  emotional_direction: 'alívio',
  desired_reaction: 'agendar visita',
  reason_to_watch: 'a data está próxima',
  reason_to_believe: 'atendimento já está pronto',
  angles: [
    { name: 'Fricção removida', one_sentence_idea: 'A chave do Jardim Europa V entra sem fila de cadastro', hook_direction: 'pergunta direta', emotional_mechanism: 'alívio', why_it_fits_audience: 'x', why_it_fits_brand: 'x', visual_potential: 'porta abrindo', execution_risk: 'parecer genérico', scores: STRATEGY_ANGLE_SCORES },
    { name: 'Antecipação', one_sentence_idea: 'O dia 24 muda a forma de comprar casa na Cosentino', hook_direction: 'contagem regressiva', emotional_mechanism: 'expectativa', why_it_fits_audience: 'x', why_it_fits_brand: 'x', visual_potential: 'calendário', execution_risk: 'x', scores: STRATEGY_ANGLE_SCORES },
    { name: 'Prova social', one_sentence_idea: 'Quem já visitou o Jardim Europa V não esperou fila nenhuma', hook_direction: 'depoimento', emotional_mechanism: 'confiança', why_it_fits_audience: 'x', why_it_fits_brand: 'x', visual_potential: 'visitante satisfeito', execution_risk: 'x', scores: STRATEGY_ANGLE_SCORES },
    { name: 'Urgência', one_sentence_idea: 'As primeiras unidades do Jardim Europa V somem no primeiro dia', hook_direction: 'escassez', emotional_mechanism: 'urgência', why_it_fits_audience: 'x', why_it_fits_brand: 'x', visual_potential: 'planta baixa', execution_risk: 'x', scores: STRATEGY_ANGLE_SCORES },
  ],
};

const HOOK_SCORES = { stop_power: 8, specificity: 8, curiosity: 8, clarity: 8, believability: 8, brand_fit: 8, continuation_power: 8 };

const BIG_IDEA_APPROVES: BigIdeaAndHooks = {
  big_idea: 'A chave que nunca esperou por burocracia.',
  hooks: [
    { text: 'Sua chave já está pronta.', scores: HOOK_SCORES },
    { text: 'O cadastro que você não vai precisar preencher.', scores: HOOK_SCORES },
    { text: 'Dia 24, a porta já abre sem fila.', scores: HOOK_SCORES },
    { text: 'A casa própria sem o processo de sempre.', scores: HOOK_SCORES },
    { text: 'Você decide, a gente entrega.', scores: HOOK_SCORES },
  ],
};

/** Aprovação alta: passa o gate (overall 90, nenhuma dimensão crítica < 8, nenhum entregável faltando). */
const CRITIC_APPROVES: CriticEvaluation = {
  scores: {
    strategy: 9, concept: 9, hook: 9, specificity: 9, originality: 9,
    brand_fit: 9, copy: 9, retention: 9, platform_fit: 9, executability: 9,
  },
  flags: {
    missing_deliverables: [], genericity: false, unsupported_claims: [],
    weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
    ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
  },
  reasoning: 'fixture de teste: aprovado por padrão',
  root_cause: 'NONE',
};

/** Registro do que o pipeline pediu ao retrieval, pra checar a profundidade. */
interface RetrievalCall {
  query: string;
  options: RetrieveOptions;
}

function makeDeps(
  behavior: FakeProviderBehavior,
  brainPath: string,
  retrievalCalls: RetrievalCall[] = [],
  researchProvider: ResearchProvider | null = null,
): OttoNodeDeps {
  // Cast no objeto inteiro: chatJson é genérica no contrato real e a fake
  // despacha por identidade do schema, algo que o TS não consegue tipar sem
  // virar o teste num exercício de generics em vez de um teste de pipeline.
  const llm = {
    chat: (messages: unknown, opts?: unknown) =>
      behavior.chat ? behavior.chat(messages, opts) : Promise.reject(new OttoLLMError('chat not expected')),
    chatJson: (messages: unknown, schema: unknown, opts?: unknown) => {
      if (schema === criticEvaluationSchema) {
        return behavior.critic ? behavior.critic(messages) : Promise.resolve(CRITIC_APPROVES);
      }
      if (schema === creativeStrategySchema) {
        return behavior.strategy ? behavior.strategy(messages) : Promise.resolve(STRATEGY_APPROVES);
      }
      if (schema === bigIdeaAndHooksSchema) {
        return behavior.bigIdea ? behavior.bigIdea(messages) : Promise.resolve(BIG_IDEA_APPROVES);
      }
      return behavior.chatJson
        ? behavior.chatJson(schema, messages, opts)
        : Promise.reject(new OttoLLMError('chatJson not expected'));
    },
    healthCheck: () =>
      Promise.resolve({ status: 'ok', detail: 'fake', model: 'mistral', baseUrl: 'http://localhost:11434' }),
  } as unknown as OttoLLMProvider;
  return {
    llm,
    // Retrieval REAL (brain em tmpdir), mas registrando as options que o
    // pipeline escolheu: é assim que se verifica que o classificador de
    // profundidade muda o trabalho de fato, e não só a metadata.
    retrieveKnowledge: (query, options) => {
      retrievalCalls.push({ query, options });
      return retrieveRelevantKnowledge(loadBrainIndex(brainPath), query, options);
    },
    brainHealth: () => checkBrainHealth(brainPath),
    researchProvider,
  };
}

let brainDir: string;

beforeEach(() => {
  brainDir = mkdtempSync(join(tmpdir(), 'otto-node-exec-'));
  writeFileSync(
    join(brainDir, 'funil-de-demanda.md'),
    '---\ntitulo: Funil de demanda\n---\n# Funil de demanda\nCarrossel é formato de profundidade: hook, desenvolvimento e CTA.\n',
    'utf-8',
  );
});

afterEach(() => {
  rmSync(brainDir, { recursive: true, force: true });
});

/**
 * `logger: false` de propósito: sem ele cada caso subiria uma worker thread de
 * pino-pretty, e os `process.on('exit')` do pino se acumulavam antes de as
 * threads ficarem prontas (MaxListenersExceededWarning). Ver buildServer.
 */
function buildTestApp(deps: OttoNodeDeps) {
  return buildServer(loadConfig({ NODE_SECRET: 'segredo-teste' }), deps, false);
}

async function execute(app: ReturnType<typeof buildTestApp>, payload: Record<string, unknown>, secret = 'segredo-teste') {
  const response = await app.inject({
    method: 'POST',
    url: '/execute',
    headers: { authorization: `Bearer ${secret}` },
    payload,
  });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('POST /execute', () => {
  it('rejeita chamada sem o NODE_SECRET', async () => {
    const app = buildTestApp(makeDeps({}, brainDir));
    const { statusCode } = await execute(app, { execution_id: 'e1', message: 'oi' }, 'errado');
    expect(statusCode).toBe(401);
    await app.close();
  });

  it('pedido criativo gera plano + spec validados, com retrieval no Brain', async () => {
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
        },
        brainDir,
      ),
    );

    const { statusCode, body } = await execute(app, {
      execution_id: 'exe-1',
      message: 'Crie um carrossel sobre o funil de demanda pro cliente',
      context_refs: [`client:${CLIENT_ID}`],
    });

    expect(statusCode).toBe(200);
    expect(body.status).toBe('completed');
    expect(body.answer).toContain('O forno como palco');
    // Retrieval de verdade: o doc do funil casou com a query e virou source.
    expect(body.sources).toContain('funil-de-demanda.md');

    const plan = creativePlanSchema.parse(body.metadata.creative_plan);
    expect(plan.concept).toBe('O forno como palco');

    const spec = productionSpecSchema.parse(body.metadata.production_spec);
    expect(spec.job_type).toBe('carousel');
    expect(spec.client_id).toBe(CLIENT_ID);
    expect(spec.slides).toHaveLength(10);
    expect(spec.prompt).toContain('forno');
    expect(body.metadata.carousel_plan.slide_count).toBe(10);

    await app.close();
  });

  /**
   * Otto Elite, Blocker 5: a nota de fidelidade não pode ser a PRIMEIRA
   * coisa que a pessoa lê, dominando um pedido de conteúdo normal com um
   * aviso técnico antes de qualquer criação aparecer — vai no FIM, como
   * nota de produção curta.
   */
  it('nota de fidelidade vem no FIM da resposta, não no início (Blocker 5)', async () => {
    const planSemFidelidade = {
      ...creativePlanFixture,
      real_world_fidelity: { requires_reference: true, entity_type: 'location', entity_description: 'a fachada real da loja' },
    };
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(planSemFidelidade);
            return Promise.resolve(makeCarouselFixture());
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-fidelidade-fim', message: 'Crie um carrossel pro cliente' });

    expect(body.status).toBe('completed');
    expect(body.answer).toContain('Nota de produção');
    expect(body.answer).toContain('a fachada real da loja');
    // A nota vem DEPOIS do conceito, não antes.
    expect(body.answer.indexOf('Conceito:')).toBeLessThan(body.answer.indexOf('Nota de produção'));

    await app.close();
  });

  it('pergunta sem verbo de produção vira chat com conhecimento, sem spec', async () => {
    const app = buildTestApp(
      makeDeps({ chat: () => Promise.resolve('Resposta estratégica baseada no Brain.') }, brainDir),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-2',
      message: 'O que diz o funil de demanda sobre carrossel?',
    });

    expect(body.status).toBe('completed');
    expect(body.answer).toBe('Resposta estratégica baseada no Brain.');
    expect(body.metadata.intent).toBe('chat');
    expect(body.metadata.production_spec).toBeUndefined();
    expect(body.sources).toContain('funil-de-demanda.md');

    await app.close();
  });

  /**
   * REGRESSÃO REAL: Jardim Europa V (Cosentino), 22/09/2026. "Roteiro para
   * Reels explicando uma data de abertura + legenda" cai no caminho de
   * PRODUÇÃO (a palavra 'reels' basta pra detectProductionIntent), que
   * historicamente devolvia só "Conceito + Copy" resumidos: a fala completa
   * cena a cena ficava presa em metadata.video_plan, invisível pra quem
   * pediu o roteiro no chat. O fix: spoken_line no VideoPlan + formatação
   * do roteiro completo na resposta visível.
   */
  it('roteiro de reels FALADO devolve o roteiro completo na resposta, não só conceito+copy', async () => {
    const videoFixture = {
      concept: 'Abertura sem fila',
      duration: 15,
      aspect_ratio: '9:16',
      scenes: [
        {
          camera_movement: 'estático',
          subject_movement: 'corretor caminha até a fachada',
          environment: 'stand de vendas Jardim Europa V',
          lighting: 'luz natural de fim de tarde',
          transition: 'corte seco',
          pacing: 'direto',
          duration_seconds: 5,
          spoken_line: 'Dia 24 de setembro abre a venda do Jardim Europa V.',
          on_screen_text: '24/09 — Abertura',
        },
        {
          camera_movement: 'estático',
          subject_movement: 'atendente recebe visitante',
          environment: 'recepção do stand',
          lighting: 'luz interna quente',
          transition: 'corte seco',
          pacing: 'direto',
          duration_seconds: 5,
          spoken_line: 'Atendimento ágil, sem necessidade de cadastro antes.',
        },
      ],
      sound_direction: 'trilha leve, sem locução em off',
      text_overlays: [],
      cta: 'Garanta seu horário',
      generation_prompts: ['sales stand facade, golden hour', 'reception desk, warm light'],
    };

    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            return Promise.resolve(videoFixture);
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-jardim-europa',
      message:
        'Otto, preciso que crie o conteudo para um reels da Cosentino informando a abertura de vendas do ' +
        'Jardim Europa V dia 24 de setembro, com roteiro, sugestao de imagem para as telas e legenda.',
    });

    expect(body.metadata.intent).toBe('reels');
    expect(body.answer).toContain('Dia 24 de setembro abre a venda');
    expect(body.answer).toContain('Fala:');
    expect(body.answer).toContain('Atendimento ágil, sem necessidade de cadastro antes.');
    expect(body.answer).toContain('CTA: Garanta seu horário');
    expect(body.answer).toContain('Legenda:');

    await app.close();
  });

  it('falha do LLM sobe como erro estruturado, nunca resposta simulada', async () => {
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: () => Promise.reject(new OttoLLMError('Ollama chat request failed (http://localhost:11434)')),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-3',
      message: 'Crie um carrossel sobre o funil de demanda',
    });

    expect(body.status).toBe('failed');
    expect(body.answer).toBeNull();
    expect(body.error).toContain('Ollama chat request failed');
    expect(body.metadata).toBeUndefined();

    await app.close();
  });
});


describe('profundidade adaptativa do turno', () => {
  /** Captura o system prompt do chat pra inspecionar o que chegou no modelo. */
  function captureChat(): { behavior: FakeProviderBehavior; captured: { system: string } } {
    const captured = { system: '' };
    return {
      captured,
      behavior: {
        chat: (messages) => {
          const list = messages as { role: string; content: string }[];
          captured.system = list.find((message) => message.role === 'system')?.content ?? '';
          return Promise.resolve('Conceito: forno como palco.');
        },
      },
    };
  }

  it('pedido de copy curta roda em FAST: menos docs, snippet menor, sem STUDIO-BRAIN', async () => {
    const calls: RetrievalCall[] = [];
    const app = buildTestApp(makeDeps(captureChat().behavior, brainDir, calls));

    const { body } = await execute(app, {
      execution_id: 'exe-fast',
      message: 'Me da uma headline pra esse post da pizzaria',
    });

    expect(body.metadata.retrieval.depth).toBe('fast');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options.maxDocs).toBe(2);
    expect(calls[0]!.options.includeStudioBrain).toBe(false);
    expect(calls[0]!.options.snippetLength).toBeLessThan(400);

    await app.close();
  });

  it('briefing de campanha roda em STANDARD, com o vault inteiro', async () => {
    const calls: RetrievalCall[] = [];
    const app = buildTestApp(makeDeps(captureChat().behavior, brainDir, calls));

    const { body } = await execute(app, {
      execution_id: 'exe-standard',
      message: 'Preciso de uma campanha para o lancamento do rodizio novo',
    });

    expect(body.metadata.retrieval.depth).toBe('standard');
    expect(calls[0]!.options.includeStudioBrain).toBe(true);
    expect(calls[0]!.options.maxDocs).toBe(4);

    await app.close();
  });

  it('reposicionamento roda em DEEP: mais docs e snippet maior', async () => {
    const calls: RetrievalCall[] = [];
    const app = buildTestApp(makeDeps(captureChat().behavior, brainDir, calls));

    const { body } = await execute(app, {
      execution_id: 'exe-deep',
      message: 'Quero repensar o posicionamento e a arquitetura de marca do cliente',
    });

    expect(body.metadata.retrieval.depth).toBe('deep');
    expect(calls[0]!.options.maxDocs).toBe(8);
    expect(calls[0]!.options.snippetLength).toBe(600);

    await app.close();
  });

  it('os TRES niveis mandam suppressThinking pro provider', async () => {
    // Inclusive DEEP: o raciocínio interno do modelo estoura o timeout de
    // 120s de produção, então profundidade vem de contexto, não de monólogo.
    for (const [message, expectedDepth] of [
      ['Troca o CTA desse anuncio', 'fast'],
      ['Monta o briefing dessa campanha de lancamento', 'standard'],
      ['Quero repensar o posicionamento e o branding da marca', 'deep'],
    ] as const) {
      let suppressed: boolean | undefined = undefined;
      const app = buildTestApp(
        makeDeps(
          {
            chat: (_messages, opts) => {
              suppressed = (opts as { suppressThinking?: boolean } | undefined)?.suppressThinking;
              return Promise.resolve('ok');
            },
          },
          brainDir,
        ),
      );
      const { body } = await execute(app, { execution_id: `exe-think-${expectedDepth}`, message });
      expect(body.metadata.retrieval.depth).toBe(expectedDepth);
      expect(suppressed).toBe(true);
      await app.close();
    }
  });

  it('o bloco de contexto do Orchestrator nao muda a profundidade', async () => {
    const calls: RetrievalCall[] = [];
    const app = buildTestApp(makeDeps(captureChat().behavior, brainDir, calls));

    const { body } = await execute(app, {
      execution_id: 'exe-ctx',
      message:
        'Me da uma headline pra esse post\n\n---\nContexto:\nAprendizado recente: Otto trabalhou no reposicionamento e branding do cliente X.',
    });

    // Sem o corte, o "reposicionamento" do contexto levaria o turno pra DEEP.
    expect(body.metadata.retrieval.depth).toBe('fast');
    /**
     * A asserção aqui era o OPOSTO, e vinha com a justificativa "contexto é
     * termo de busca legítimo". A produção provou que não é: com o bloco
     * inteiro na query, um pedido de três palavras competia com centenas de
     * palavras de dossiê, e num turno da Elite o vault devolveu o tom de voz
     * da APAE (medido pelo frontend publicado em 18/09/2026).
     *
     * Contexto resolvido pelo orquestrador é FATO e entra no prompt com
     * precedência declarada. Ele não é, e nunca foi, uma consulta de busca.
     */
    expect(calls[0]!.query).not.toContain('reposicionamento');
    expect(calls[0]!.query).toContain('headline');

    await app.close();
  });

  it('caminho de PRODUCAO nunca cai pra FAST (piso em standard)', async () => {
    const calls: RetrievalCall[] = [];
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
        },
        brainDir,
        calls,
      ),
    );

    // 'troca' e 'cta' são cues de FAST, mas 'gere' + 'imagem' é produção.
    const { body } = await execute(app, {
      execution_id: 'exe-floor',
      message: 'Troca o CTA e gere a imagem nova',
    });

    expect(body.metadata.intent).toBe('image');
    expect(body.metadata.retrieval.depth).toBe('fast');
    // A DECISÃO é fast, mas a política aplicada foi elevada pra standard.
    expect(calls[0]!.options.maxDocs).toBe(4);
    expect(calls[0]!.options.includeStudioBrain).toBe(true);

    await app.close();
  });
});

describe('observabilidade de latencia por fase', () => {
  it('chat devolve classify_ms, retrieval_ms, llm_ms e total_ms', async () => {
    const app = buildTestApp(makeDeps({ chat: () => Promise.resolve('resposta') }, brainDir));

    const { body } = await execute(app, {
      execution_id: 'exe-timings',
      message: 'Me da uma headline pra esse post',
    });

    const timings = body.metadata.timings as Record<string, number>;
    for (const phase of ['classify_ms', 'retrieval_ms', 'llm_ms', 'total_ms']) {
      expect(typeof timings[phase]).toBe('number');
      expect(timings[phase]).toBeGreaterThanOrEqual(0);
    }
    // O total tem que cobrir as fases medidas dentro dele.
    expect(timings.total_ms).toBeGreaterThanOrEqual(
      timings.classify_ms! + timings.retrieval_ms! + timings.llm_ms! - 1,
    );

    await app.close();
  });

  it('llm_ms mede a chamada de verdade, nao um zero', async () => {
    const app = buildTestApp(
      makeDeps(
        { chat: () => new Promise((resolve) => setTimeout(() => resolve('devagar'), 40)) },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-llm-ms', message: 'Me da uma headline' });
    expect((body.metadata.timings as Record<string, number>).llm_ms).toBeGreaterThanOrEqual(35);

    await app.close();
  });

  it('caminho de producao soma as DUAS chamadas de modelo em llm_ms', async () => {
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            const wait = new Promise((resolve) => setTimeout(resolve, 30));
            if (schema === creativePlanSchema) return wait.then(() => creativePlanFixture);
            if (schema === carouselPlanSchema) return wait.then(() => makeCarouselFixture());
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-timings-prod',
      message: 'Crie um carrossel sobre o funil de demanda',
    });

    // plano + carrossel: duas gerações, então llm_ms cobre as duas.
    expect((body.metadata.timings as Record<string, number>).llm_ms).toBeGreaterThanOrEqual(55);

    await app.close();
  });
});

describe('Otto assume uma direcao (diretiva de postura)', () => {
  function captureSystemPrompt(): { behavior: FakeProviderBehavior; captured: { system: string } } {
    const captured = { system: '' };
    return {
      captured,
      behavior: {
        chat: (messages) => {
          const list = messages as { role: string; content: string }[];
          captured.system = list.find((message) => message.role === 'system')?.content ?? '';
          return Promise.resolve('entrega');
        },
      },
    };
  }

  it('briefing de campanha recebe a espinha completa que o dono pediu', async () => {
    const { behavior, captured } = captureSystemPrompt();
    const app = buildTestApp(makeDeps(behavior, brainDir));

    await execute(app, {
      execution_id: 'exe-stance-standard',
      message: 'Preciso de uma campanha para o lancamento do rodizio, publico de familias, encher o salao na terca',
    });

    for (const label of ['Conceito:', 'Por que funciona:', 'Hook:', 'Roteiro:', 'Direção visual:', 'CTA:']) {
      expect(captured.system).toContain(label);
    }
    expect(captured.system).toContain('Variação A:');
    expect(captured.system).toContain('Variação B:');
    // E a instrução de não devolver o pedido como pergunta.
    expect(captured.system).toContain('Devolver o pedido em forma de pergunta não é resposta');

    await app.close();
  });

  it('pedido de copy curta NAO recebe a espinha de campanha', async () => {
    const { behavior, captured } = captureSystemPrompt();
    const app = buildTestApp(makeDeps(behavior, brainDir));

    await execute(app, { execution_id: 'exe-stance-fast', message: 'Me da uma headline pra esse post' });

    expect(captured.system).toContain('entrega curta');
    expect(captured.system).not.toContain('Variação A:');

    await app.close();
  });

  it('as garantias de honestidade sobrevivem a diretiva', async () => {
    const { behavior, captured } = captureSystemPrompt();
    const app = buildTestApp(makeDeps(behavior, brainDir));

    await execute(app, {
      execution_id: 'exe-stance-honesty',
      message: 'Preciso de uma campanha pra esse cliente',
      attachments: [{ url: 'https://exemplo.test/peca.png', filename: 'peca.png', contentType: 'image/png' }],
    });

    // 1) O aviso de que o Otto não tem visão computacional continua lá.
    expect(captured.system).toContain('você NÃO tem acesso visual ao conteúdo');
    expect(captured.system).toContain('Nunca descreva cor, textura, cena');
    // 2) A diretiva reforça, não afrouxa: assumir direção vale pra decisão
    //    criativa, nunca pra fato.
    expect(captured.system).toContain('nunca pra fato');
    expect(captured.system).toContain('detalhe visual de anexo que você não recebeu de verdade');
    // 3) Sem brand kit no request, o aviso de "não invente o DNA nem se
    //    autodescreva no lugar da entrega" aparece.
    expect(captured.system).toContain('não recebeu material real deste cliente neste turno');
    expect(captured.system).toContain('nem descreva a si mesmo');

    await app.close();
  });

  it('com brand kit, o aviso de ausencia de material nao aparece', async () => {
    const { behavior, captured } = captureSystemPrompt();
    const app = buildTestApp(makeDeps(behavior, brainDir));

    await execute(app, {
      execution_id: 'exe-stance-dna',
      message: 'Preciso de uma campanha pra esse cliente',
      client_brand_kit: { colors: ['#E2551D'], fonts: ['Grotesque'], tone_of_voice: 'Direto', logo_url: null },
    });

    expect(captured.system).not.toContain('não recebeu material real deste cliente neste turno');
    expect(captured.system).toContain('DNA criativo do cliente');

    await app.close();
  });
});

describe('DNA criativo no turno (client_brand_kit)', () => {
  const brandKit = {
    colors: ['#E2551D', '#1A1A1A'],
    fonts: ['Grotesque Bold'],
    tone_of_voice: 'Irreverente e direto',
    logo_url: null,
  };

  function capturePlannerPrompt(): { behavior: FakeProviderBehavior; captured: { user: string } } {
    const captured = { user: '' };
    return {
      captured,
      behavior: {
        chatJson: (schema, messages) => {
          const list = messages as { role: string; content: string }[];
          if (schema === creativePlanSchema) {
            captured.user = list.find((message) => message.role === 'user')?.content ?? '';
            return Promise.resolve(creativePlanFixture);
          }
          if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
          return Promise.reject(new OttoLLMError('schema inesperado'));
        },
      },
    };
  }

  it('com brand kit no request, o DNA entra no prompt do planner e na metadata', async () => {
    const { behavior, captured } = capturePlannerPrompt();
    const app = buildTestApp(makeDeps(behavior, brainDir));

    const { body } = await execute(app, {
      execution_id: 'exe-dna-1',
      message: 'Crie um carrossel sobre o funil de demanda',
      context_refs: [`client:${CLIENT_ID}`],
      client_brand_kit: brandKit,
    });

    expect(body.status).toBe('completed');
    // O DNA virou a seção "Contexto do cliente" que o planner monta.
    expect(captured.user).toContain('DNA criativo do cliente');
    expect(captured.user).toContain('Paleta: #E2551D, #1A1A1A');
    expect(captured.user).toContain('Tipografia: Grotesque Bold');
    expect(captured.user).toContain('Tom: Irreverente e direto');
    // Sem feedbacks (node não acessa o banco): confiança 0, dito no prompt.
    expect(captured.user).toContain('Confiança do DNA: 0%');

    expect(body.metadata.creative_dna.palette).toEqual(['#E2551D', '#1A1A1A']);
    expect(body.metadata.creative_dna.clientId).toBe(CLIENT_ID);

    await app.close();
  });

  it('com brand kit, o DNA também entra no system prompt do chat', async () => {
    let systemPrompt = '';
    const app = buildTestApp(
      makeDeps(
        {
          chat: (messages) => {
            const list = messages as { role: string; content: string }[];
            systemPrompt = list.find((message) => message.role === 'system')?.content ?? '';
            return Promise.resolve('Resposta com DNA.');
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-dna-2',
      message: 'O que diz o funil de demanda sobre carrossel?',
      client_brand_kit: brandKit,
    });

    expect(body.status).toBe('completed');
    expect(systemPrompt).toContain('DNA criativo do cliente');
    expect(systemPrompt).toContain('Tom: Irreverente e direto');
    expect(body.metadata.creative_dna.toneOfVoice).toBe('Irreverente e direto');

    await app.close();
  });

  it('sem brand kit, o prompt e a resposta ficam exatamente como antes', async () => {
    const { behavior, captured } = capturePlannerPrompt();
    const app = buildTestApp(makeDeps(behavior, brainDir));

    const { body } = await execute(app, {
      execution_id: 'exe-dna-3',
      message: 'Crie um carrossel sobre o funil de demanda',
      context_refs: [`client:${CLIENT_ID}`],
    });

    expect(body.status).toBe('completed');
    expect(captured.user).not.toContain('DNA criativo do cliente');
    expect(body.metadata.creative_dna).toBeUndefined();
    expect(productionSpecSchema.parse(body.metadata.production_spec).job_type).toBe('carousel');

    await app.close();
  });

  it('com client_feedback_history real, o DNA acumula confiança e padrões (auto-aprendizagem)', async () => {
    const { behavior, captured } = capturePlannerPrompt();
    const app = buildTestApp(makeDeps(behavior, brainDir));

    const { body } = await execute(app, {
      execution_id: 'exe-dna-feedback',
      message: 'Crie um carrossel sobre o funil de demanda',
      context_refs: [`client:${CLIENT_ID}`],
      client_brand_kit: brandKit,
      client_feedback_history: [
        { verdict: 'approved', reason: 'gostou da paleta vibrante', context: '' },
        { verdict: 'rejected', reason: 'tipografia fina demais', context: '' },
        { verdict: 'rejected', reason: 'tipografia fina demais', context: '' },
        { verdict: 'needs_iteration', reason: 'texto longo demais', context: '' },
      ],
    });

    expect(body.status).toBe('completed');
    // Antes desta busca real (execute-job.ts -> recallMemories), o node
    // sempre recebia feedbacks: [] e a confiança nunca saía de 0%.
    expect(captured.user).not.toContain('Confiança do DNA: 0%');
    expect(body.metadata.creative_dna.feedbackCount).toBe(4);
    // Razão repetida (2x) vira padrão rejeitado; razão única não.
    expect(body.metadata.creative_dna.rejectedPatterns).toContain('tipografia fina demais');
    expect(body.metadata.creative_dna.approvedPatterns).not.toContain('gostou da paleta vibrante');

    await app.close();
  });
});

/**
 * Loop criativo ao vivo no node (§52-§67): CreativeState -> lacunas ->
 * pesquisa -> geração -> porta anti-genérico -> auto-revisão. Estes casos
 * existem porque, até serem escritos, runCreativePipeline/runResearch eram
 * código exportado e testado em packages/otto SEM nenhum caller em runtime:
 * o node chamava createCreativePlan direto e entregava a 1a versão.
 */
describe('POST /execute — loop criativo (pipeline + pesquisa + qualidade)', () => {
  const PEDIDO_COM_PESQUISA = {
    execution_id: 'exe-pipeline',
    message: 'Crie um post sobre as tendências atuais de mercado para o cliente',
    context_refs: [`client:${CLIENT_ID}`],
  };

  it('expõe estado, lacunas e trace do pipeline na metadata', async () => {
    const app = buildTestApp(
      makeDeps(
        { chatJson: (schema) => (schema === creativePlanSchema ? Promise.resolve(creativePlanFixture) : Promise.reject(new OttoLLMError('schema inesperado'))) },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-pipeline-1',
      message: 'Crie um post para o cliente',
      context_refs: [`client:${CLIENT_ID}`],
    });

    const pipeline = body.metadata.creative_pipeline;
    expect(pipeline).toBeDefined();
    // Sem brand kit e sem histórico, o estado DECLARA o que falta em vez de inventar.
    expect(pipeline.gaps).toContain('brand_context');
    expect(pipeline.gaps).toContain('offer');
    expect(pipeline.trace.length).toBeGreaterThan(0);
    expect(pipeline.quality_passed).toBe(true);

    await app.close();
  });

  it('objetivo que pede dado atual dispara pesquisa REAL e vira evidência web', async () => {
    let buscou = '';
    const provider: ResearchProvider = {
      search: async (query) => {
        buscou = query;
        return [
          { url: 'https://exame.com/tendencias', title: 'Tendências 2026', snippet: 'Vídeo curto domina o consumo em 2026.' },
          { url: 'https://meioemensagem.com.br/x', title: 'Mercado', snippet: 'Marcas migram verba para creators.' },
        ];
      },
    };

    let clientContextVisto = '';
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema !== creativePlanSchema) return Promise.reject(new OttoLLMError('schema inesperado'));
            clientContextVisto = JSON.stringify(messages);
            return Promise.resolve(creativePlanFixture);
          },
        },
        brainDir,
        [],
        provider,
      ),
    );

    const { body } = await execute(app, PEDIDO_COM_PESQUISA);

    const pesquisa = body.metadata.creative_pipeline.research;
    expect(pesquisa.performed).toBe(true);
    expect(buscou).toContain('tendências atuais');
    expect(pesquisa.sources.length).toBeGreaterThanOrEqual(2);
    expect(pesquisa.single_source).toBe(false);
    // Evidência de 1a classe: type web, com a URL real como sourceId (§59).
    expect(pesquisa.evidence[0].type).toBe('web');
    expect(pesquisa.evidence[0].sourceId).toContain('https://');
    // E o achado chegou de fato ao prompt do planner — pesquisa que não
    // alimenta a geração seria teatro.
    expect(clientContextVisto).toContain('Vídeo curto domina');

    await app.close();
  });

  /**
   * REGRESSÃO REAL: baseline ao vivo (22/09/2026, Otto Elite Phase 2) —
   * "legenda" e "pode usar emojis na legenda" chegavam SEM efeito no plano
   * de produção porque createCreativePlan tinha um prompt próprio que nunca
   * recebia contratoDeSaida nem sabia que emoji tinha sido autorizado. A
   * legenda gerada saiu sem hashtag e sem emoji.
   */
  it('caminho de produção recebe o contrato de saída e a autorização de emoji no prompt do planner', async () => {
    let userPrompt = '';
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) {
              const list = messages as { role: string; content: string }[];
              userPrompt = list.find((message) => message.role === 'user')?.content ?? '';
              return Promise.resolve(creativePlanFixture);
            }
            return Promise.resolve({ ...makeCarouselFixture() });
          },
        },
        brainDir,
      ),
    );

    await execute(app, {
      execution_id: 'exe-contrato-producao',
      message: 'Crie um carrossel e uma legenda para o cliente, pode usar emojis na legenda.',
    });

    expect(userPrompt).toMatch(/O campo "copy" precisa seguir este contrato/);
    expect(userPrompt).toMatch(/hashtags na última linha/);
    expect(userPrompt).toMatch(/O pedido autoriza emojis/);

    await app.close();
  });

  /**
   * REGRESSÃO REAL (Otto Senior V1, "Universal Quality Floor", Section 9):
   * pedido explícito de "8 slides" devolvia 10 — a contagem era hardcoded
   * em execute.ts, nunca lida do pedido do usuário.
   */
  it('teste 9c: carrossel com "8 slides" pedidos explicitamente gera exatamente 8, não o default de 10', async () => {
    let carouselSystemPrompt = '';
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            const list = messages as { role: string; content: string }[];
            carouselSystemPrompt = list.find((m) => m.role === 'system')?.content ?? '';
            return Promise.resolve(makeCarouselFixture(8));
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-slide-count',
      message: 'Crie um carrossel de 8 slides para o cliente sobre o lançamento da nova coleção.',
    });

    expect(body.status).toBe('completed');
    expect(carouselSystemPrompt).toMatch(/exatamente 8 slides/);
    expect((body.metadata.carousel_plan as { slide_count: number }).slide_count).toBe(8);

    await app.close();
  });

  it('carrossel SEM quantidade pedida continua no default de 10 (comportamento anterior preservado)', async () => {
    let carouselSystemPrompt = '';
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            const list = messages as { role: string; content: string }[];
            carouselSystemPrompt = list.find((m) => m.role === 'system')?.content ?? '';
            return Promise.resolve(makeCarouselFixture());
          },
        },
        brainDir,
      ),
    );

    await execute(app, { execution_id: 'exe-slide-count-default', message: 'Crie um carrossel pro cliente' });

    expect(carouselSystemPrompt).toMatch(/exatamente 10 slides/);

    await app.close();
  });

  /**
   * MISSÃO 6 (Otto Senior 20Y): o bloco de contexto do orquestrador não pode
   * entrar cru no "Briefing:" do planner (duplicando o que já chega via
   * clientContext) nem se acumular numa reescrita. Isto é o que investigamos
   * antes de tocar no prompt de reescrita: o contexto tinha que aparecer
   * UMA vez, com framing de precedência, não duas.
   */
  it('bloco de contexto do orquestrador entra UMA vez, via clientContext com framing de precedência — nunca cru dentro de "Briefing:"', async () => {
    let userPrompt = '';
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) {
              const list = messages as { role: string; content: string }[];
              userPrompt = list.find((message) => message.role === 'user')?.content ?? '';
              return Promise.resolve(creativePlanFixture);
            }
            return Promise.resolve({ ...makeCarouselFixture() });
          },
        },
        brainDir,
      ),
    );

    await execute(app, {
      execution_id: 'exe-contexto-limpo',
      message: `Crie um carrossel pro cliente.${CONTEXT_BLOCK_MARKER}CLIENTE DO TURNO: Cosentino\nDossiê real do cliente.`,
    });

    expect(userPrompt).toMatch(/ESCOPO RESOLVIDO DESTE TURNO.*PRECEDÊNCIA/s);
    expect(userPrompt).toContain('CLIENTE DO TURNO: Cosentino');
    // O dossiê aparece UMA vez só (na seção de contexto), não duplicado
    // dentro do "Briefing:" cru.
    expect(userPrompt.split('CLIENTE DO TURNO: Cosentino')).toHaveLength(2);
    const briefingSection = userPrompt.slice(userPrompt.indexOf('Briefing:'));
    expect(briefingSection).not.toContain('CLIENTE DO TURNO');
    expect(briefingSection).not.toContain('---\nContexto:');

    await app.close();
  });

  it('sem provider configurado a pesquisa NÃO acontece e isso fica declarado', async () => {
    const app = buildTestApp(
      makeDeps(
        { chatJson: (schema) => (schema === creativePlanSchema ? Promise.resolve(creativePlanFixture) : Promise.reject(new OttoLLMError('x'))) },
        brainDir,
      ),
    );

    const { body } = await execute(app, PEDIDO_COM_PESQUISA);

    const pipeline = body.metadata.creative_pipeline;
    expect(pipeline.requires_research).toBe(true);
    // O ponto do teste: requiresResearch=true + performed=false. O Otto não
    // diz que pesquisou; a ausência aparece na auditoria.
    expect(pipeline.research.performed).toBe(false);
    expect(pipeline.research.evidence).toEqual([]);

    await app.close();
  });

  it('copy genérica reprova na porta e o Otto se auto-revisa até passar', async () => {
    let tentativas = 0;
    const briefingsVistos: string[] = [];
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema !== creativePlanSchema) return Promise.reject(new OttoLLMError('schema inesperado'));
            tentativas += 1;
            briefingsVistos.push(JSON.stringify(messages));
            // 1a tentativa: clichê puro, curto e sem âncora → reprova.
            if (tentativas === 1) {
              return Promise.resolve({ ...creativePlanFixture, copy: 'Transforme seu negócio. A solução completa.' });
            }
            return Promise.resolve({ ...creativePlanFixture, copy: 'A pizza que sai do forno a 400 graus em 90 segundos.' });
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-revisao',
      message: 'Crie um post para o cliente',
      context_refs: [`client:${CLIENT_ID}`],
    });

    const pipeline = body.metadata.creative_pipeline;
    expect(tentativas).toBe(2);
    expect(pipeline.revisions).toBe(1);
    expect(pipeline.quality_passed).toBe(true);
    // A revisão não foi um retry cego: o motivo da reprovação entrou no briefing.
    expect(briefingsVistos[1]).toContain('REVISÃO OBRIGATÓRIA');
    // E o que foi entregue é a versão revisada, não a genérica.
    expect(body.metadata.creative_plan.copy).toContain('400 graus');

    await app.close();
  });

  it('copy genérica persistente NÃO é entregue como aprovada', async () => {
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) =>
            schema === creativePlanSchema
              ? Promise.resolve({ ...creativePlanFixture, copy: 'Transforme seu negócio. A solução completa.' })
              : Promise.reject(new OttoLLMError('schema inesperado')),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-generica',
      message: 'Crie um post para o cliente',
      context_refs: [`client:${CLIENT_ID}`],
    });

    const pipeline = body.metadata.creative_pipeline;
    expect(pipeline.quality_passed).toBe(false);
    expect(pipeline.quality_assessment.generic).toBe(true);
    expect(pipeline.revisions).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('histórico de feedback do cliente vira referência aprovada/rejeitada do estado', async () => {
    const app = buildTestApp(
      makeDeps(
        { chatJson: (schema) => (schema === creativePlanSchema ? Promise.resolve(creativePlanFixture) : Promise.reject(new OttoLLMError('x'))) },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-historico',
      message: 'Crie um post para o cliente',
      context_refs: [`client:${CLIENT_ID}`],
      client_brand_kit: { colors: ['#000'], fonts: ['Grotesque'], tone_of_voice: 'direto', logo_url: null },
      client_feedback_history: [
        { verdict: 'approved', reason: 'close de produto', context: 'carrossel de maio' },
        { verdict: 'rejected', reason: 'texto demais', context: 'post de abril' },
      ],
    });

    const pipeline = body.metadata.creative_pipeline;
    // Com brand kit e histórico reais, as lacunas de marca e histórico somem.
    expect(pipeline.gaps).not.toContain('brand_context');
    expect(pipeline.gaps).not.toContain('creative_history');

    await app.close();
  });
});

/**
 * CRITIC + REWRITE (Otto Elite Phase 2, Fase 2 — Fases 9-15 do brief): o
 * primeiro draft de reels/vídeo/carrossel não é entregue sem passar por uma
 * avaliação estruturada; se reprovar, o Otto reescreve UMA vez com a nota do
 * critic antes de responder.
 */
describe('critic + rewrite (Otto Elite Phase 2)', () => {
  it('critic aprova de primeira: uma reescrita não acontece, metadata.critic registra a aprovação', async () => {
    let creativePlanCalls = 0;
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) {
              creativePlanCalls += 1;
              return Promise.resolve(creativePlanFixture);
            }
            if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-critic-aprova',
      message: 'Crie um carrossel sobre o funil de demanda pro cliente',
    });

    expect(body.status).toBe('completed');
    expect(creativePlanCalls).toBe(1); // sem reescrita
    expect(body.metadata.critic).toMatchObject({ enabled: true, passed: true, rewrites: 0 });

    await app.close();
  });

  /**
   * INVARIANTE (Otto Elite, Blocker 2): uma reescrita que REMOVE um
   * entregável que já existia é REJEITADA, mesmo sem erro de schema —
   * achado ao vivo real: draft com roteiro completo, reescrita #2 sem erro
   * nenhum mas devolvendo só conceito+legenda (roteiro sumiu). Sem esta
   * checagem, essa reescrita PIOR teria virado a versão final.
   */
  it('reescrita que remove entregável já existente é REJEITADA — mantém a versão anterior (Blocker 2)', async () => {
    let videoPlanCalls = 0;

    const videoComFala = {
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'plano fixo médio', subject_movement: 'apresentador olha pra câmera e fala diretamente', environment: 'estúdio com fundo neutro', lighting: 'luz de estúdio suave', transition: 'corte seco no fim da fala', pacing: 'direto', duration_seconds: 5, spoken_line: 'Abertura dia 24 de setembro.' }],
      sound_direction: 'trilha', text_overlays: [], cta: 'Confira', generation_prompts: ['a'],
    };
    const videoSemFala = { ...videoComFala, scenes: [{ ...videoComFala.scenes[0], spoken_line: undefined }] };

    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            videoPlanCalls += 1;
            // 1a chamada (draft): COM fala. 2a chamada (reescrita): SEM fala — regressão.
            return Promise.resolve(videoPlanCalls === 1 ? videoComFala : videoSemFala);
          },
          critic: () => {
            // Reprova por um motivo NÃO relacionado a completude (copy fraca) —
            // força uma reescrita que, por acidente, perde o roteiro.
            return Promise.resolve({
              scores: {
                strategy: 9, concept: 9, hook: 9, specificity: 9, originality: 9,
                brand_fit: 9, copy: 5, retention: 9, platform_fit: 9, executability: 9,
              },
              flags: {
                missing_deliverables: [], genericity: false, unsupported_claims: [],
                weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
              },
              reasoning: 'copy fraca',
              root_cause: 'COPY',
            });
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-regressao-roteiro', message: 'Crie um reels com roteiro pro cliente' });

    expect(body.status).toBe('completed');
    expect(body.answer).toContain('Roteiro:'); // a versão COM fala sobreviveu
    expect(body.answer).toContain('Abertura dia 24 de setembro.');
    expect(body.metadata.quality_pipeline_degraded).toBe(true);
    expect(body.metadata.quality_pipeline_degraded_reason).toMatch(/removeu entregável\(is\) que já existia\(m\): roteiro/);
    expect(body.metadata.quality_tier).toBe('beta'); // reels: congelado em beta (Otto Senior V1), nunca "draft" nem "elite"
    expect(body.metadata.elite_passed).toBe(false);
    expect(body.metadata.missing_deliverables).toEqual([]); // versão final (draft preservado) está completa

    await app.close();
  });

  /**
   * Otto Elite, Blocker 2 — reparo de completude: quando um entregável
   * pedido NUNCA existiu em nenhuma tentativa (não foi perdido no meio do
   * caminho — isso é o teste acima), uma última chamada NARROW tenta só
   * adicionar o que falta, preservando o resto.
   */
  it('reparo de completude: entregável que nunca existiu é adicionado numa chamada final narrow', async () => {
    let videoPlanCalls = 0;
    let repairMessageReceived = '';

    const videoSemFala = {
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'plano fixo médio', subject_movement: 'apresentador olha pra câmera e fala diretamente', environment: 'estúdio com fundo neutro', lighting: 'luz de estúdio suave', transition: 'corte seco no fim da fala', pacing: 'direto', duration_seconds: 5 }],
      sound_direction: 'trilha', text_overlays: [], cta: 'Confira', generation_prompts: ['a'],
    };
    const videoComFala = { ...videoSemFala, scenes: [{ ...videoSemFala.scenes[0], spoken_line: 'Abertura dia 24 de setembro.' }] };

    let creativePlanCalls = 0;
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) {
              creativePlanCalls += 1;
              // 4a chamada de createCreativePlan = o passo de REPARO (draft +
              // 2 reescritas do critic + 1 reparo de completude).
              if (creativePlanCalls === 4) {
                const list = messages as { role: string; content: string }[];
                repairMessageReceived = list.find((m) => m.role === 'user')?.content ?? '';
              }
              return Promise.resolve(creativePlanFixture);
            }
            videoPlanCalls += 1;
            // draft + 2 reescritas do critic: NUNCA produz roteiro; só o
            // reparo (4a chamada de vídeo) finalmente tem fala.
            return Promise.resolve(videoPlanCalls <= 3 ? videoSemFala : videoComFala);
          },
          // Critic sempre reprova por completude (código detecta "roteiro" ausente
          // de qualquer forma, então o conteúdo do critic aqui é irrelevante pro gate).
          critic: () =>
            Promise.resolve({
              scores: {
                strategy: 9, concept: 9, hook: 9, specificity: 9, originality: 9,
                brand_fit: 9, copy: 9, retention: 9, platform_fit: 9, executability: 9,
              },
              flags: {
                missing_deliverables: [], genericity: false, unsupported_claims: [],
                weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
              },
              reasoning: 'ok',
              root_cause: 'DELIVERABLE',
            }),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-reparo-completude', message: 'Crie um reels com roteiro pro cliente' });

    expect(body.status).toBe('completed');
    expect(videoPlanCalls).toBe(4); // draft + 2 reescritas do critic + 1 reparo de completude
    expect(repairMessageReceived).toMatch(/COMPLEMENTO OBRIGATÓRIO/);
    expect(repairMessageReceived).toMatch(/preserve TODO o resto do conteúdo/);
    expect(repairMessageReceived).toMatch(/- roteiro/);
    expect(body.answer).toContain('Roteiro:');
    expect(body.metadata.completion_repair).toEqual({ attempted: true, succeeded: true });
    expect(body.metadata.missing_deliverables).toEqual([]);

    await app.close();
  });

  /**
   * MISSÃO 7 (Otto Senior 20Y): completude é CALCULADA EM CÓDIGO
   * (computeMissingDeliverables), não autocertificada pelo modelo — o
   * critic pode dizer "está completo" e o código ainda reprova se o rótulo
   * esperado ("Roteiro:") não aparecer de fato na resposta renderizada.
   * Cenário real: pedido de reels com roteiro; o primeiro vídeo gerado não
   * tem NENHUMA fala (spoken_line), então formatVideoScript não renderiza
   * seção de roteiro nenhuma — código detecta a ausência mesmo o critic
   * (propositalmente) reportando missing_deliverables vazio.
   */
  it('completude é calculada em código (Missão 7): reprova por "Roteiro:" ausente mesmo o critic dizendo que está tudo lá, reescreve UMA vez', async () => {
    let creativePlanCalls = 0;
    let videoPlanCalls = 0;
    const briefingsRecebidos: string[] = [];
    const videoPromptsRecebidos: string[] = [];
    let criticCalls = 0;

    const videoSemFala = {
      concept: 'X', duration: 5, aspect_ratio: '9:16',
      scenes: [{ camera_movement: 'plano fixo médio', subject_movement: 'apresentador olha pra câmera e fala diretamente', environment: 'estúdio com fundo neutro', lighting: 'luz de estúdio suave', transition: 'corte seco no fim da fala', pacing: 'direto', duration_seconds: 5 }],
      sound_direction: 'trilha', text_overlays: [], cta: 'Confira', generation_prompts: ['a'],
    };
    const videoComFala = {
      ...videoSemFala,
      scenes: [{ ...videoSemFala.scenes[0], spoken_line: 'Abertura dia 24 de setembro.' }],
    };

    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) {
              creativePlanCalls += 1;
              const list = messages as { role: string; content: string }[];
              briefingsRecebidos.push(list.find((m) => m.role === 'user')?.content ?? '');
              return Promise.resolve(creativePlanFixture);
            }
            videoPlanCalls += 1;
            const list = messages as { role: string; content: string }[];
            videoPromptsRecebidos.push(list.find((m) => m.role === 'user')?.content ?? '');
            return Promise.resolve(videoPlanCalls === 1 ? videoSemFala : videoComFala);
          },
          // O critic (propositalmente) reporta TUDO ok — a reprovação real
          // vem do código, não da autoavaliação do modelo.
          critic: () => {
            criticCalls += 1;
            return Promise.resolve({
              scores: {
                strategy: 9, concept: 9, hook: 9, specificity: 9, originality: 9,
                brand_fit: 9, copy: 9, retention: 9, platform_fit: 9, executability: 9,
              },
              flags: {
                missing_deliverables: [], genericity: false, unsupported_claims: [],
                weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
              },
              reasoning: 'parece completo (o critic está errado aqui de propósito)',
            });
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-critic-reprova',
      message: 'Crie um reels com roteiro pro cliente',
    });

    expect(body.status).toBe('completed');
    expect(criticCalls).toBe(2); // avaliação inicial + reavaliação pós-reescrita
    expect(creativePlanCalls).toBe(2); // geração inicial + UMA reescrita, não duas
    expect(briefingsRecebidos[1]).toMatch(/REVISÃO DO CRITIC OBRIGATÓRIA/);
    expect(briefingsRecebidos[1]).toMatch(/entregável\(is\) pedido\(s\) faltando: roteiro/);
    // Missão 6: a reescrita recebe a PEÇA ATUAL (o que o draft já escreveu),
    // não só a nota do critic — achado ao vivo: sem isso, a reescrita
    // regenerava do zero e perdia conteúdo bom (fala sumindo de cenas que
    // já tinham). "O forno como palco" é o concept do creativePlanFixture,
    // então aparece no rendered answer do draft anterior.
    expect(briefingsRecebidos[1]).toMatch(/PEÇA ATUAL.*preserve o que já está bom/s);
    expect(briefingsRecebidos[1]).toContain('O forno como palco');
    expect(body.metadata.critic).toMatchObject({ enabled: true, passed: true, rewrites: 1 });
    expect(body.answer).toContain('Roteiro:');

    // Achado ao vivo real (segunda validação Cosentino): planVideo era
    // chamado de novo, do zero, sem NENHUMA ideia do que a revisão pedia —
    // a fala sumia de cenas que já a tinham porque o segundo passo do
    // pipeline nunca soube que havia algo pra corrigir. A nota do critic
    // agora chega em planVideo também, não só em createCreativePlan.
    expect(videoPlanCalls).toBe(2);
    expect(videoPromptsRecebidos[0]).not.toMatch(/REVISÃO OBRIGATÓRIA/); // 1a chamada (draft): sem nota
    expect(videoPromptsRecebidos[1]).toMatch(/REVISÃO OBRIGATÓRIA \(o storyboard anterior falhou/);
    expect(videoPromptsRecebidos[1]).toMatch(/entregável\(is\) pedido\(s\) faltando: roteiro/);

    await app.close();
  });

  it('critic reprova e continua reprovando após DUAS reescritas: entrega mesmo assim (nunca trava o turno), quality_tier fica "draft"', async () => {
    let creativePlanCalls = 0;
    let criticCalls = 0;
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) {
              creativePlanCalls += 1;
              return Promise.resolve(creativePlanFixture);
            }
            if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
          critic: () => {
            criticCalls += 1;
            return Promise.resolve({
              scores: {
                strategy: 5, concept: 5, hook: 5, specificity: 5, originality: 5,
                brand_fit: 5, copy: 5, retention: 5, platform_fit: 5, executability: 5,
              },
              flags: {
                missing_deliverables: [], genericity: true, unsupported_claims: [],
                weak_hook: true, weak_concept: true, bad_cta: false, bad_platform_fit: false,
                ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
              },
              reasoning: 'fraco em tudo',
            });
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-critic-persistente',
      message: 'Crie um carrossel pro cliente',
    });

    // Entrega mesmo reprovado: NUNCA travar o turno por causa do critic — o
    // mesmo princípio do loop anti-genérico (creative-pipeline.ts), que
    // também entrega após esgotar revisões em vez de devolver erro.
    expect(body.status).toBe('completed');
    // MAX_REWRITES=2: draft inicial + 2 reescritas = 3 chamadas de createCreativePlan.
    expect(creativePlanCalls).toBe(3);
    expect(criticCalls).toBe(3); // avaliação inicial + após reescrita 1 + após reescrita 2
    expect(body.metadata.critic).toMatchObject({ enabled: true, passed: false, rewrites: 2, max_rewrites: 2 });
    // Regra 19: nunca chamar "elite" trabalho que não passou.
    expect(body.metadata.quality_tier).toBe('draft');
    expect(body.metadata.elite_passed).toBe(false);
    expect(body.metadata.requires_human_review).toBe(true);

    await app.close();
  });

  /**
   * REGRESSÃO REAL (Otto Senior V1, "Best-Valid Fix"): achado ao vivo com
   * qwen3.6:35b-a3b — draft=45, reescrita#1=43, reescrita#2=39, TODOS
   * estruturalmente válidos (sem regressão de completude). O sistema
   * entregava 39 (o mais recente); devia entregar 45 (o melhor). Nenhum
   * dos três passa o gate (< 88), então o loop consome as 2 reescritas e
   * termina reprovado de qualquer forma — a única coisa que muda é QUAL
   * dos três vira `result` final.
   */
  it('melhor candidato válido vence, não o mais recente: draft=45 > reescrita#1=43 > reescrita#2=39 (Otto Senior V1, Best-Valid Fix)', async () => {
    let creativePlanCalls = 0;
    let criticCalls = 0;
    const scoresPorTentativa = [
      { strategy: 5, concept: 5, hook: 5, specificity: 4, originality: 4, brand_fit: 5, copy: 4, retention: 4, platform_fit: 4, executability: 5 }, // média 45
      { strategy: 5, concept: 4, hook: 4, specificity: 4, originality: 4, brand_fit: 5, copy: 4, retention: 4, platform_fit: 4, executability: 5 }, // média 43
      { strategy: 4, concept: 4, hook: 4, specificity: 4, originality: 3, brand_fit: 4, copy: 3, retention: 4, platform_fit: 4, executability: 4 }, // média 38 (~39)
    ];
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) {
              creativePlanCalls += 1;
              return Promise.resolve(creativePlanFixture);
            }
            if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
          critic: () => {
            const scores = scoresPorTentativa[Math.min(criticCalls, scoresPorTentativa.length - 1)]!;
            criticCalls += 1;
            return Promise.resolve({
              scores,
              flags: {
                missing_deliverables: [], genericity: false, unsupported_claims: [],
                weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
              },
              reasoning: `tentativa ${criticCalls}`,
              root_cause: 'COPY',
            });
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-best-valid',
      message: 'Crie um carrossel pro cliente',
    });

    expect(body.status).toBe('completed');
    expect(creativePlanCalls).toBe(3); // draft + 2 reescritas — todas rodaram, nenhuma passou o gate
    const critic = body.metadata.critic as { overall?: number; rewrites?: number };
    // A nota FINAL reportada é a do DRAFT (45), não a da última reescrita (39/38).
    expect(critic.overall).toBe(45);
    expect(critic.rewrites).toBe(2); // as duas reescritas rodaram — só a ESCOLHA final não é a mais recente
    expect(body.metadata.quality_tier).toBe('draft'); // nenhum candidato passou os 88 do gate

    await app.close();
  });

  it('critic aprova de primeira: quality_tier "elite", elite_passed true, sem revisão humana obrigatória', async () => {
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-critic-elite',
      message: 'Crie um carrossel pro cliente',
    });

    expect(body.status).toBe('completed');
    expect(body.metadata.quality_tier).toBe('elite');
    expect(body.metadata.elite_passed).toBe(true);
    expect(body.metadata.requires_human_review).toBe(false);

    await app.close();
  });

  it('job type sem critic (image): quality_tier "not_evaluated", elite_passed null', async () => {
    const app = buildTestApp(
      makeDeps(
        { chatJson: (schema) => (schema === creativePlanSchema ? Promise.resolve(creativePlanFixture) : Promise.reject(new OttoLLMError('x'))) },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-tier-image', message: 'Crie uma imagem pro cliente' });

    expect(body.metadata.quality_tier).toBe('not_evaluated');
    expect(body.metadata.elite_passed).toBeNull();
    expect(body.metadata.requires_human_review).toBe(false);

    await app.close();
  });

  it('critic NÃO roda pra job type image/upscale (o entregável é a imagem, não o texto)', async () => {
    let criticCalls = 0;
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => (schema === creativePlanSchema ? Promise.resolve(creativePlanFixture) : Promise.reject(new OttoLLMError('x'))),
          critic: () => {
            criticCalls += 1;
            return Promise.resolve(CRITIC_APPROVES);
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, {
      execution_id: 'exe-critic-image',
      message: 'Crie uma imagem pro cliente',
    });

    expect(body.status).toBe('completed');
    expect(criticCalls).toBe(0);
    expect(body.metadata.critic).toEqual({ enabled: false });

    await app.close();
  });

  /**
   * Otto Elite, Blocker 4 (teste 7/10 do fechamento): "elite_passed can
   * NEVER be true if unsupported_claims.length > 0". Achado ao vivo real:
   * REWRITE #1 quebrou em schema (bug NÃO relacionado ao fato) antes de
   * corrigir "sem burocracia", e o draft com a alegação sobreviveu como
   * versão final sem NENHUMA tentativa de correção factual. Este teste
   * simula o pior caso: o critic reporta a MESMA alegação sem base em toda
   * avaliação (mesmo depois das 2 reescritas do gate e da correção factual
   * narrow dedicada) — elite_passed precisa continuar false, e a correção
   * factual precisa ter sido tentada.
   */
  it('unsupported_claims persistente NUNCA vira elite_passed=true, mesmo com scores altos e completude ok (Blocker 4)', async () => {
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
          critic: () =>
            Promise.resolve({
              scores: {
                strategy: 9, concept: 9, hook: 9, specificity: 9, originality: 9,
                brand_fit: 9, copy: 9, retention: 9, platform_fit: 9, executability: 9,
              },
              flags: {
                missing_deliverables: [], genericity: false, unsupported_claims: ['A pizza que o feed inteiro sente o cheiro.'],
                weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
              },
              reasoning: 'alegação sem base persistente',
              root_cause: 'FACTUAL',
            }),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-factual-persistente', message: 'Crie um carrossel pro cliente' });

    expect(body.status).toBe('completed');
    expect(body.metadata.critic.passed).toBe(false);
    expect(body.metadata.missing_deliverables).toEqual([]); // completude ok isoladamente
    expect(body.metadata.unsupported_claims.length).toBeGreaterThan(0); // mas o fato continua sem base
    expect(body.metadata.factual_correction).toEqual({ attempted: true, succeeded: false });
    expect(body.metadata.elite_passed).toBe(false);
    expect(body.metadata.quality_tier).toBe('draft');
    expect(body.metadata.requires_human_review).toBe(true);

    await app.close();
  });

  /**
   * REGRESSÃO REAL (Otto Senior V1, "Universal Quality Floor", certificação
   * não-vídeo): carrossel real (LaunchDesk/SaaS) repetiu "Antes:"/"Depois:"
   * em dois pares de slides — nota de retenção/platform_fit despencou, mas
   * o critic (LLM) não tinha nenhum sinal determinístico pra apontar ONDE.
   * O linter de repetição precisa forçar a reprovação mesmo quando o
   * critic (fake, aqui) aprovaria de cara.
   */
  it('teste 10: repetição real de carrossel (rótulo "Antes:"/"Depois:" repetido) força reprovação e root_cause=STRUCTURE, mesmo com critic aprovando', async () => {
    const carrosselComRepeticao = {
      concept: 'x',
      slide_count: 4,
      slides: [
        { index: 1, narrative_function: 'hook', objective: 'o', copy: 'Configurar tarefas manualmente toma tempo do seu time.', visual: 'v', composition: 'c', layout: 'l', image_prompt: 'p' },
        { index: 2, narrative_function: 'development', objective: 'o', copy: 'Antes: configuração manual de tarefas leva horas todo mês.', visual: 'v', composition: 'c', layout: 'l', image_prompt: 'p' },
        { index: 3, narrative_function: 'development', objective: 'o', copy: 'Antes: revisar e reconfigurar tarefas manualmente consome o dia.', visual: 'v', composition: 'c', layout: 'l', image_prompt: 'p' },
        { index: 4, narrative_function: 'cta', objective: 'o', copy: 'Ative a automação direto no seu workspace hoje.', visual: 'v', composition: 'c', layout: 'l', image_prompt: 'p' },
      ],
    };
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
            if (schema === carouselPlanSchema) return Promise.resolve(carrosselComRepeticao);
            return Promise.reject(new OttoLLMError('schema inesperado'));
          },
          critic: () => Promise.resolve(CRITIC_APPROVES),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-carousel-repeticao', message: 'Crie um carrossel pro cliente' });

    expect(body.status).toBe('completed');
    expect(body.metadata.critic).toMatchObject({ passed: false });
    const reasons = (body.metadata.critic as { reasons: string[] }).reasons;
    expect(reasons.some((r) => r.includes('qualidade de carrossel'))).toBe(true);
    expect((body.metadata.critic as { evaluation: { root_cause: string } }).evaluation.root_cause).toBe('STRUCTURE');

    await app.close();
  });

  /**
   * INVARIANTE ABSOLUTO (Otto Senior 20Y, Missão 4-5, Missão 24 — injeção
   * de falha): nenhuma falha de ESTÁGIO DE MELHORIA pode destruir um
   * artefato já válido. Achado ao vivo real: REWRITE #1 quebrou em schema
   * (delivery_format sumiu) e o turno inteiro morreu com 431s perdidos,
   * mesmo com um DRAFT_V1 válido em mãos. Estes quatro testes replicam cada
   * ponto de falha do loop (critic #1, reescrita #1, critic #2, reescrita
   * #2) via mock e confirmam: o usuário SEMPRE recebe a última versão
   * válida, nunca null/erro cru, e NUNCA "elite" quando degradado.
   */
  describe('injeção de falha: nenhum estágio de melhoria pode destruir um artefato válido', () => {
    it('critic #1 lança exceção -> mantém o DRAFT, nunca elite, degradado e visível na metadata', async () => {
      const app = buildTestApp(
        makeDeps(
          {
            chatJson: (schema) => {
              if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
              if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
              return Promise.reject(new OttoLLMError('schema inesperado'));
            },
            critic: () => Promise.reject(new Error('Ollama caiu no meio do critic')),
          },
          brainDir,
        ),
      );

      const { body } = await execute(app, { execution_id: 'exe-inj-critic1', message: 'Crie um carrossel pro cliente' });

      expect(body.status).toBe('completed');
      expect(body.answer).toContain('O forno como palco'); // o draft (creativePlanFixture) sobreviveu
      expect(body.metadata.quality_tier).toBe('draft');
      expect(body.metadata.elite_passed).toBe(false);
      expect(body.metadata.requires_human_review).toBe(true);
      expect(body.metadata.quality_pipeline_degraded).toBe(true);
      expect(body.metadata.quality_pipeline_degraded_reason).toMatch(/critic #1 falhou/);
      expect(body.metadata.critic).toMatchObject({ enabled: true, rewrites: 0 });

      await app.close();
    });

    it('REWRITE #1 lança exceção (o achado real) -> mantém o DRAFT válido anterior, nunca destrói o turno', async () => {
      let creativePlanCalls = 0;
      const app = buildTestApp(
        makeDeps(
          {
            chatJson: (schema) => {
              creativePlanCalls += 1;
              if (schema === creativePlanSchema) {
                // Draft (1a chamada) é válido; REWRITE (2a chamada) quebra —
                // exatamente o padrão observado ao vivo (delivery_format
                // sumiu / entity_type="").
                if (creativePlanCalls === 1) return Promise.resolve(creativePlanFixture);
                return Promise.reject(new OttoLLMError('schema mismatch: delivery_format Required'));
              }
              if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
              return Promise.reject(new OttoLLMError('schema inesperado'));
            },
            critic: () =>
              Promise.resolve({
                scores: {
                  strategy: 5, concept: 5, hook: 5, specificity: 5, originality: 5,
                  brand_fit: 5, copy: 5, retention: 5, platform_fit: 5, executability: 5,
                },
                flags: {
                  missing_deliverables: [], genericity: true, unsupported_claims: [],
                  weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                  ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
                },
                reasoning: 'fraco',
              }),
          },
          brainDir,
        ),
      );

      const { body } = await execute(app, { execution_id: 'exe-inj-rewrite1', message: 'Crie um carrossel pro cliente' });

      expect(body.status).toBe('completed');
      expect(body.answer).toContain('O forno como palco'); // o DRAFT original, não null
      expect(body.metadata.quality_tier).toBe('draft');
      expect(body.metadata.elite_passed).toBe(false);
      expect(body.metadata.requires_human_review).toBe(true);
      expect(body.metadata.quality_pipeline_degraded).toBe(true);
      expect(body.metadata.quality_pipeline_degraded_reason).toMatch(/reescrita #1 falhou/);
      expect(body.metadata.critic).toMatchObject({ enabled: true, rewrites: 0 }); // reescrita NUNCA contou como concluída

      await app.close();
    });

    it('CRITIC #2 (pós-reescrita) lança exceção -> mantém a REESCRITA #1, que já é uma versão válida melhor que o draft', async () => {
      let creativePlanCalls = 0;
      let criticCalls = 0;
      const app = buildTestApp(
        makeDeps(
          {
            chatJson: (schema) => {
              if (schema === creativePlanSchema) {
                creativePlanCalls += 1;
                return Promise.resolve(creativePlanFixture);
              }
              if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
              return Promise.reject(new OttoLLMError('schema inesperado'));
            },
            critic: () => {
              criticCalls += 1;
              if (criticCalls === 1) {
                return Promise.resolve({
                  scores: {
                    strategy: 5, concept: 5, hook: 5, specificity: 5, originality: 5,
                    brand_fit: 5, copy: 5, retention: 5, platform_fit: 5, executability: 5,
                  },
                  flags: {
                    missing_deliverables: [], genericity: true, unsupported_claims: [],
                    weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                    ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
                  },
                  reasoning: 'fraco',
                });
              }
              return Promise.reject(new Error('Ollama caiu na 2a avaliação'));
            },
          },
          brainDir,
        ),
      );

      const { body } = await execute(app, { execution_id: 'exe-inj-critic2', message: 'Crie um carrossel pro cliente' });

      expect(body.status).toBe('completed');
      expect(creativePlanCalls).toBe(2); // draft + UMA reescrita bem-sucedida
      expect(body.metadata.quality_tier).toBe('draft');
      expect(body.metadata.elite_passed).toBe(false);
      expect(body.metadata.quality_pipeline_degraded).toBe(true);
      expect(body.metadata.quality_pipeline_degraded_reason).toMatch(/critic #2 falhou/);
      expect(body.metadata.critic).toMatchObject({ enabled: true, rewrites: 1 }); // a reescrita #1 CONTOU, pois terminou com sucesso

      await app.close();
    });

    it('REWRITE #2 lança exceção -> mantém a REESCRITA #1 (última versão válida), não trava o turno', async () => {
      let creativePlanCalls = 0;
      const app = buildTestApp(
        makeDeps(
          {
            chatJson: (schema) => {
              if (schema === creativePlanSchema) {
                creativePlanCalls += 1;
                // Draft (1) e reescrita #1 (2) válidas; reescrita #2 (3) quebra.
                if (creativePlanCalls <= 2) return Promise.resolve(creativePlanFixture);
                return Promise.reject(new OttoLLMError('schema mismatch na 2a reescrita'));
              }
              if (schema === carouselPlanSchema) return Promise.resolve(makeCarouselFixture());
              return Promise.reject(new OttoLLMError('schema inesperado'));
            },
            // Critic reprova SEMPRE (nunca passa) -> força tentar as 2 reescritas.
            critic: () =>
              Promise.resolve({
                scores: {
                  strategy: 5, concept: 5, hook: 5, specificity: 5, originality: 5,
                  brand_fit: 5, copy: 5, retention: 5, platform_fit: 5, executability: 5,
                },
                flags: {
                  missing_deliverables: [], genericity: true, unsupported_claims: [],
                  weak_hook: false, weak_concept: false, bad_cta: false, bad_platform_fit: false,
                  ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
                },
                reasoning: 'fraco',
              }),
          },
          brainDir,
        ),
      );

      const { body } = await execute(app, { execution_id: 'exe-inj-rewrite2', message: 'Crie um carrossel pro cliente' });

      expect(body.status).toBe('completed');
      expect(body.answer).toContain('O forno como palco');
      expect(creativePlanCalls).toBe(3); // draft + reescrita#1 (sucesso) + reescrita#2 (falhou)
      expect(body.metadata.quality_tier).toBe('draft');
      expect(body.metadata.quality_pipeline_degraded).toBe(true);
      expect(body.metadata.quality_pipeline_degraded_reason).toMatch(/reescrita #2 falhou/);
      expect(body.metadata.critic).toMatchObject({ enabled: true, rewrites: 1 }); // só a reescrita #1 contou

      await app.close();
    });
  });
});

/**
 * Deps pra testar o escopo da reescrita por causa raiz (Missão 16): critic
 * reprova com um root_cause fixo na 1a avaliação, aprova na 2a — nunca
 * esgota MAX_REWRITES, então dá pra isolar exatamente 1 reescrita.
 */
function buildTestAppDepsForRootCause(opts: {
  rootCause: 'HOOK' | 'COPY';
  onBigIdeaCall: () => void;
  onCriticCall: () => void;
}) {
  let criticCallCount = 0;
  return makeDeps(
    {
      chatJson: (schema) => {
        if (schema === creativePlanSchema) return Promise.resolve(creativePlanFixture);
        return Promise.resolve(makeCarouselFixture());
      },
      bigIdea: () => {
        opts.onBigIdeaCall();
        return Promise.resolve(BIG_IDEA_APPROVES);
      },
      critic: () => {
        opts.onCriticCall();
        criticCallCount += 1;
        if (criticCallCount === 1) {
          return Promise.resolve({
            scores: {
              strategy: 5, concept: 5, hook: 5, specificity: 5, originality: 5,
              brand_fit: 5, copy: 5, retention: 5, platform_fit: 5, executability: 5,
            },
            flags: {
              missing_deliverables: [], genericity: false, unsupported_claims: [],
              weak_hook: opts.rootCause === 'HOOK', weak_concept: false, bad_cta: false, bad_platform_fit: false,
              ai_slop: false, over_explanation: false, missing_production_direction: false, brand_mismatch: false,
            },
            reasoning: `falha classificada como ${opts.rootCause}`,
            root_cause: opts.rootCause,
          });
        }
        return Promise.resolve(CRITIC_APPROVES);
      },
    },
    brainDir,
  );
}

/**
 * CAMADA DE ESTRATÉGIA (Otto Elite): REQUEST -> ESTRATÉGIA -> DIVERGÊNCIA DE
 * ÂNGULOS -> BIG IDEA -> HOOK -> DRAFT, antes de qualquer texto existir.
 */
describe('camada de estratégia (Otto Elite)', () => {
  it('roda estratégia+ângulos+big idea+hooks ANTES do draft, e os artefatos aparecem em metadata.strategy', async () => {
    let creativePlanPrompt = '';
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) {
              const list = messages as { role: string; content: string }[];
              creativePlanPrompt = list.find((m) => m.role === 'user')?.content ?? '';
              return Promise.resolve(creativePlanFixture);
            }
            return Promise.resolve(makeCarouselFixture());
          },
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-strategy', message: 'Crie um carrossel pro cliente' });

    expect(body.status).toBe('completed');
    // A direção estratégica chegou no prompt do draft (formatStrategyBriefing).
    expect(creativePlanPrompt).toMatch(/DIREÇÃO ESTRATÉGICA DESTA PEÇA/);
    expect(creativePlanPrompt).toContain(BIG_IDEA_APPROVES.big_idea);
    expect(creativePlanPrompt).toContain(STRATEGY_APPROVES.angles[0]!.name);

    const strategyMeta = body.metadata.strategy as Record<string, unknown>;
    expect(strategyMeta.enabled).toBe(true);
    expect(strategyMeta.degraded).toBe(false);
    expect(strategyMeta.big_idea).toBe(BIG_IDEA_APPROVES.big_idea);
    expect((strategyMeta.strategy as { angles: unknown[] }).angles).toHaveLength(4);
    expect(strategyMeta.selected_angle).toBeTruthy();
    expect(strategyMeta.selected_hook).toBeTruthy();

    await app.close();
  });

  it('não roda pra job type sem critic (image): metadata.strategy.enabled fica false', async () => {
    const app = buildTestApp(
      makeDeps(
        { chatJson: (schema) => (schema === creativePlanSchema ? Promise.resolve(creativePlanFixture) : Promise.reject(new OttoLLMError('x'))) },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-strategy-image', message: 'Crie uma imagem pro cliente' });

    expect(body.metadata.strategy).toEqual({ enabled: false });

    await app.close();
  });

  it('estratégia falha (LLM caiu) -> draft segue SEM ela, degradado e visível, nunca trava o turno', async () => {
    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => (schema === creativePlanSchema ? Promise.resolve(creativePlanFixture) : Promise.resolve(makeCarouselFixture())),
          strategy: () => Promise.reject(new Error('Ollama caiu na estratégia')),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-strategy-falha', message: 'Crie um carrossel pro cliente' });

    expect(body.status).toBe('completed'); // nunca trava o turno
    const strategyMeta = body.metadata.strategy as Record<string, unknown>;
    expect(strategyMeta.enabled).toBe(true);
    expect(strategyMeta.degraded).toBe(true);
    expect(strategyMeta.strategy).toBeUndefined(); // sem artefato — a chamada nunca terminou

    await app.close();
  });

  /**
   * MISSÃO 16: causa raiz na camada estratégica (HOOK) troca de ângulo
   * (reaproveitando os já gerados — sem nova chamada de divergência) e
   * regenera big idea/hook ANTES de reescrever o texto. Causa raiz de
   * execução (COPY) NÃO troca de ângulo — só reescreve com a mesma estratégia.
   */
  describe('escopo da reescrita por causa raiz (Missão 16)', () => {
    it('root_cause=HOOK troca de ângulo e regenera big idea/hook antes da reescrita', async () => {
      let bigIdeaCalls = 0;
      let criticCalls = 0;
      const app = buildTestApp(
        buildTestAppDepsForRootCause({
          rootCause: 'HOOK',
          onBigIdeaCall: () => { bigIdeaCalls += 1; },
          onCriticCall: () => { criticCalls += 1; },
        }),
      );

      const { body } = await execute(app, { execution_id: 'exe-rootcause-hook', message: 'Crie um carrossel pro cliente' });

      expect(body.status).toBe('completed');
      expect(criticCalls).toBe(2);
      // 1 chamada inicial (antes do draft) + 1 chamada extra pra trocar de ângulo na reescrita.
      expect(bigIdeaCalls).toBe(2);
      const strategyMeta = body.metadata.strategy as { selected_angle: { name: string } };
      // O ângulo final NÃO é o primeiro da lista (STRATEGY_APPROVES.angles[0]) — trocou.
      expect(strategyMeta.selected_angle.name).not.toBe(STRATEGY_APPROVES.angles[0]!.name);

      await app.close();
    });

    it('root_cause=COPY NÃO troca de ângulo — só reescreve o texto com a mesma estratégia', async () => {
      let bigIdeaCalls = 0;
      let criticCalls = 0;
      const app = buildTestApp(
        buildTestAppDepsForRootCause({
          rootCause: 'COPY',
          onBigIdeaCall: () => { bigIdeaCalls += 1; },
          onCriticCall: () => { criticCalls += 1; },
        }),
      );

      const { body } = await execute(app, { execution_id: 'exe-rootcause-copy', message: 'Crie um carrossel pro cliente' });

      expect(body.status).toBe('completed');
      expect(criticCalls).toBe(2);
      // Só a chamada inicial — root_cause=COPY não troca de ângulo, não regenera big idea/hook.
      expect(bigIdeaCalls).toBe(1);
      const strategyMeta = body.metadata.strategy as { selected_angle: { name: string } };
      expect(strategyMeta.selected_angle.name).toBe(STRATEGY_APPROVES.angles[0]!.name);

      await app.close();
    });
  });
});

/**
 * REEL EXECUTION ENGINE (Otto Elite, "Reel Execution Engine Closure"):
 * teste 9/10 da missão — "strong strategy + weak execution" precisa rodar
 * um REPARO ESTREITO (só planVideo de novo) sem tocar em createCreativePlan
 * — teste 10 é a mesma coisa, provando que o conceito/copy sobrevive.
 */
describe('Reel Execution Engine (Otto Elite)', () => {
  const cenaFraca = {
    camera_movement: 'estático',
    subject_movement: 'None',
    environment: 'None',
    lighting: 'luz de estúdio',
    transition: 'transição dinâmica',
    pacing: 'direto',
    duration_seconds: 5,
  };
  const cenasBoas = [
    {
      camera_movement: 'push-in lento',
      subject_movement: 'o corretor caminha até a porta e a abre com um gesto firme',
      environment: 'fachada do stand de vendas ao entardecer',
      lighting: 'luz quente de fim de tarde',
      transition: 'corte no movimento da mão',
      pacing: 'direto',
      duration_seconds: 3,
    },
    {
      camera_movement: 'tracking lateral',
      subject_movement: 'a atendente recebe o visitante e aponta para a maquete',
      environment: 'recepção do stand com maquete iluminada',
      lighting: 'luz interna quente',
      transition: 'match cut no gesto da mão',
      pacing: 'moderado',
      duration_seconds: 2,
    },
    {
      camera_movement: 'macro',
      subject_movement: 'detalhe do convite sendo entregue nas mãos do visitante',
      environment: 'balcão de atendimento com acabamento premium',
      lighting: 'luz lateral suave',
      transition: 'corte seco no beat da trilha',
      pacing: 'direto',
      duration_seconds: 2.5,
    },
  ];

  function videoPlanFixture(scenes: typeof cenaFraca[]) {
    return {
      concept: 'Abertura sem fila',
      duration: scenes.reduce((t, s) => t + s.duration_seconds, 0),
      aspect_ratio: '9:16',
      scenes,
      sound_direction: 'trilha leve',
      text_overlays: [],
      cta: 'Garanta seu horário',
      generation_prompts: scenes.map(() => 'a prompt'),
    };
  }

  it('teste 9/10: "Visual: None" força EXECUTABILITY mesmo quando o critic aprovaria — reparo estreito preserva concept/copy, não regenera createCreativePlan', async () => {
    let creativePlanCalls = 0;
    let videoPlanCalls = 0;
    let repairPromptReceived = '';

    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema, messages) => {
            if (schema === creativePlanSchema) {
              creativePlanCalls += 1;
              return Promise.resolve(creativePlanFixture);
            }
            videoPlanCalls += 1;
            if (videoPlanCalls === 1) return Promise.resolve(videoPlanFixture([cenaFraca, cenaFraca, cenaFraca]));
            const list = messages as { role: string; content: string }[];
            repairPromptReceived = list.find((m) => m.role === 'user')?.content ?? '';
            return Promise.resolve(videoPlanFixture(cenasBoas));
          },
          // Critic (propositalmente) aprovaria — a reprovação real vem do
          // linter determinístico de execução de reel, não do julgamento do modelo.
          critic: () => Promise.resolve(CRITIC_APPROVES),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-reel-execution', message: 'Crie um reels pro cliente' });

    expect(body.status).toBe('completed');
    // SÓ UMA chamada de createCreativePlan (o draft) — o reparo NUNCA regenerou conceito/copy.
    expect(creativePlanCalls).toBe(1);
    expect(videoPlanCalls).toBe(2); // draft (fraco) + 1 reparo estreito de execução
    expect(repairPromptReceived).toMatch(/Visual: ?"None"|"None"\/vazia/); // nota do linter, não do critic genérico
    expect(repairPromptReceived).toMatch(/Preserve o conceito, a copy e a mensagem já aprovados/);
    // O reparo resolveu — a segunda avaliação (sobre o storyboard já
    // corrigido) não acha mais nenhum achado do linter, então passa de
    // verdade. A rejeição na 1a avaliação foi 100% determinística (o
    // critic fake tinha aprovado de cara), não uma opinião do modelo.
    expect(body.metadata.critic).toMatchObject({ passed: true, rewrites: 1 });
    // Reels: congelado em beta (Otto Senior V1) mesmo com o critic aprovando
    // de verdade — o gate passou, mas o formato não certifica "elite" ainda.
    expect(body.metadata.quality_tier).toBe('beta');
    expect(body.metadata.elite_passed).toBe(false);
    expect(body.metadata.requires_human_review).toBe(true);

    await app.close();
  });

  it('sequência dinâmica e executável passa sem reparo (concept/copy preservados desde o draft, sem chamada extra)', async () => {
    let creativePlanCalls = 0;
    let videoPlanCalls = 0;

    const app = buildTestApp(
      makeDeps(
        {
          chatJson: (schema) => {
            if (schema === creativePlanSchema) {
              creativePlanCalls += 1;
              return Promise.resolve(creativePlanFixture);
            }
            videoPlanCalls += 1;
            return Promise.resolve(videoPlanFixture(cenasBoas));
          },
          critic: () => Promise.resolve(CRITIC_APPROVES),
        },
        brainDir,
      ),
    );

    const { body } = await execute(app, { execution_id: 'exe-reel-execution-ok', message: 'Crie um reels pro cliente' });

    expect(body.status).toBe('completed');
    expect(creativePlanCalls).toBe(1);
    expect(videoPlanCalls).toBe(1); // sem reparo nenhum — nada disparou o linter
    expect(body.metadata.critic).toMatchObject({ passed: true, rewrites: 0 });
    // Otto Senior V1: reels é BETA por definição de formato, mesmo aprovado
    // de primeira sem nenhum reparo — nunca "elite" pra vídeo neste V1.
    expect(body.metadata.quality_tier).toBe('beta');
    expect(body.metadata.elite_passed).toBe(false);
    expect(body.metadata.requires_human_review).toBe(true);

    await app.close();
  });
});

/**
 * FASE 13 — o node não pode ir ao vault pra descobrir o que "o segundo"
 * significa. Este arquivo mede exatamente isso: quantas vezes o retrieval foi
 * chamado, e com qual query.
 */
describe('follow-up referencial não consulta o vault', () => {
  const DIALOGO = [
    'CONVERSA RECENTE (para resolver referências; não é fonte de fato):',
    'Usuário: Me dá 3 títulos.',
    'Otto: 1 Título A',
    '2 Título B',
    '3 Título C',
  ].join('\n');

  function mensagemComContexto(turno: string, contexto = DIALOGO): string {
    return `${turno}${CONTEXT_BLOCK_MARKER}${contexto}`;
  }

  it('"me explica o segundo" -> ZERO chamadas ao vault', async () => {
    const chamadas: Array<{ query: string; options: unknown }> = [];
    const deps = makeDeps({ chat: async () => 'O Título B fala de ...' }, brainDir, chamadas as never);
    const app = buildTestApp(deps);
    const { statusCode } = await execute(app, {
      execution_id: 'EXE-REF-1',
      message: mensagemComContexto('me explica o segundo.'),
      context_refs: [],
    });
    await app.close();
    expect(statusCode).toBe(200);
    expect(chamadas, `vault foi consultado: ${JSON.stringify(chamadas.map((c) => c.query.slice(0, 60)))}`).toHaveLength(0);
  });

  it('pedido NOVO continua consultando o vault — e com a query LIMPA', async () => {
    const chamadas: Array<{ query: string; options: unknown }> = [];
    const deps = makeDeps({ chat: async () => '1 A\n2 B\n3 C' }, brainDir, chamadas as never);
    const app = buildTestApp(deps);
    await execute(app, {
      execution_id: 'EXE-REF-2',
      message: mensagemComContexto('me dá 3 títulos sobre funil de demanda'),
      context_refs: [],
    });
    await app.close();
    expect(chamadas).toHaveLength(1);
    // A query NÃO pode carregar o bloco do orquestrador: era isso que fazia o
    // dossiê de outro cliente decidir a busca lexical.
    expect(chamadas[0]!.query).toContain('funil de demanda');
    expect(chamadas[0]!.query).not.toContain('CONVERSA RECENTE');
    expect(chamadas[0]!.query).not.toContain('Título B');
  });

  it('referencial QUE PEDE FATO ainda consulta o vault', async () => {
    const chamadas: Array<{ query: string; options: unknown }> = [];
    const deps = makeDeps({ chat: async () => 'resposta' }, brainDir, chamadas as never);
    const app = buildTestApp(deps);
    await execute(app, {
      execution_id: 'EXE-REF-3',
      message: mensagemComContexto('me explica o segundo à luz do posicionamento da marca'),
      context_refs: [],
    });
    await app.close();
    expect(chamadas).toHaveLength(1);
  });

  it('o cliente resolvido viaja como cerca para o retrieval', async () => {
    const chamadas: Array<{ query: string; options: { clientSlug?: string | null } }> = [];
    const deps = makeDeps({ chat: async () => 'resposta' }, brainDir, chamadas as never);
    const app = buildTestApp(deps);
    await execute(app, {
      execution_id: 'EXE-REF-4',
      message: mensagemComContexto('me dá 3 títulos sobre funil', 'CLIENTE DO TURNO: Elite\nDossiê...'),
      context_refs: [],
    });
    await app.close();
    expect(chamadas[0]!.options.clientSlug).toBe('Elite');
  });
});
