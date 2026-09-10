import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OttoLLMError,
  carouselPlanSchema,
  checkBrainHealth,
  creativePlanSchema,
  loadBrainIndex,
  productionSpecSchema,
  retrieveRelevantKnowledge,
  type OttoLLMProvider,
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

function makeCarouselFixture(slideCount = 10) {
  const functions = ['hook', 'context', 'development', 'value', 'development', 'value', 'development', 'value', 'context', 'cta'];
  return {
    concept: 'O forno como palco',
    slide_count: slideCount,
    slides: functions.slice(0, slideCount).map((narrativeFunction, index) => ({
      index: index + 1,
      narrative_function: narrativeFunction,
      objective: `Objetivo do slide ${index + 1}`,
      copy: `Copy do slide ${index + 1}`,
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
}

/** Registro do que o pipeline pediu ao retrieval, pra checar a profundidade. */
interface RetrievalCall {
  query: string;
  options: RetrieveOptions;
}

function makeDeps(
  behavior: FakeProviderBehavior,
  brainPath: string,
  retrievalCalls: RetrievalCall[] = [],
): OttoNodeDeps {
  // Cast no objeto inteiro: chatJson é genérica no contrato real e a fake
  // despacha por identidade do schema, algo que o TS não consegue tipar sem
  // virar o teste num exercício de generics em vez de um teste de pipeline.
  const llm = {
    chat: (messages: unknown, opts?: unknown) =>
      behavior.chat ? behavior.chat(messages, opts) : Promise.reject(new OttoLLMError('chat not expected')),
    chatJson: (messages: unknown, schema: unknown, opts?: unknown) =>
      behavior.chatJson
        ? behavior.chatJson(schema, messages, opts)
        : Promise.reject(new OttoLLMError('chatJson not expected')),
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

function buildTestApp(deps: OttoNodeDeps) {
  return buildServer(loadConfig({ NODE_SECRET: 'segredo-teste' }), deps);
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
    // Mas a QUERY do retrieval segue usando a mensagem inteira: contexto é
    // termo de busca legítimo, só não é sinal de profundidade.
    expect(calls[0]!.query).toContain('reposicionamento');

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
});
