import type { Logger } from '@desigual-os/logging';
import type { OttoLLMProvider } from '../llm/ollama-provider.js';
import { assessCreativeCopy } from './anti-generic.js';
import {
  bigIdeaAndHooksSchema,
  creativeStrategySchema,
  type AngleScores,
  type BigIdeaAndHooks,
  type CreativeAngle,
  type CreativeStrategy,
  type HookCandidate,
  type HookScores,
} from './schemas.js';

/**
 * strategy.ts — Otto Elite: a camada de PENSAMENTO antes do rascunho
 * (REQUEST → ESTRATÉGIA → DIVERGÊNCIA DE ÂNGULOS → BIG IDEA → HOOK →
 * (execução dobrada no draft) → DRAFT). Duas chamadas estruturadas, não
 * cinco — cada chamada de LLM nesta máquina já mede minutos (ver
 * OTTO_ELITE_HANDOFF.md), e "algumas etapas podem ocorrer numa única
 * inferência estruturada" é uma permissão explícita da missão, não uma
 * sugestão.
 *
 * Toda SELEÇÃO (ângulo, hook) é feita em CÓDIGO a partir dos scores que o
 * modelo dá a cada candidato — nunca pedimos pro modelo se autoescolher.
 * Mesma lição do bug de `duration`: o modelo julga cada item isoladamente
 * bem; agregar/decidir em cima disso é conta que ele erra.
 */

export interface StrategyDeps {
  llm: OttoLLMProvider;
  logger?: Logger;
}

export interface StrategyInput {
  /** O pedido do usuário, sem o bloco de contexto do orquestrador. */
  briefing: string;
  /** Contexto de cliente/marca já resolvido (dossiê, DNA, conhecimento do Brain). */
  clientContext: string;
  /** Fatos que NÃO podem ser inventados (datas, preços, condições do briefing). */
  mandatoryFacts?: string[];
}

const STRATEGY_SYSTEM = `Você é um estrategista de conteúdo sênior. Antes de qualquer copy existir, pense a peça.

Produza UM objeto de estratégia com estes campos:
- audience_insight: o que o público JÁ pensa/sente sobre isso, especificamente (não genérico de categoria)
- tension: a tensão ou contradição que a peça precisa resolver
- opportunity: a oportunidade criativa real, não o objetivo de negócio
- promise_or_message: o que a peça promete ou comunica, numa frase
- communication_job: o trabalho específico que esta peça faz (não "informar" - o que muda na cabeça de quem vê)
- emotional_direction: que emoção a peça mira
- desired_reaction: o que a pessoa deve sentir/pensar/fazer ao ver
- reason_to_watch: por que alguém pararia de rolar o feed pra isso
- reason_to_believe: por que a promessa é acreditável

TESTE DE QUALIDADE DA ESTRATÉGIA: se "communication_job" for só "informar", "divulgar", "mostrar" ou "apresentar" sem nada além disso, a estratégia é fraca — vá mais fundo no que muda pra quem vê.

Depois, gere EXATAMENTE 4 ÂNGULOS CRIATIVOS GENUINAMENTE DIFERENTES (não reescritas da mesma frase - rotas conceituais reais: fricção removida, antecipação, urgência de oportunidade, prova social, mecanismo, momento cultural, etc). Cada ângulo tem:
- name: nome curto do ângulo
- one_sentence_idea: a ideia em uma frase (não o objetivo - a IDEIA)
- hook_direction: que tipo de abertura esse ângulo sugere
- emotional_mechanism: como ele mexe emocionalmente
- why_it_fits_audience: por que serve ESTE público
- why_it_fits_brand: por que serve ESTA marca
- visual_potential: que tipo de imagem/cena esse ângulo pede
- execution_risk: o que pode dar errado ao executar
- scores: objective_fit, audience_fit, brand_fit, originality, hook_potential, visual_potential, executability, factual_safety (0 a 10 cada, julgue cada um isoladamente, não calcule total)

NUNCA invente fato comercial (preço, data, condição, garantia) que não veio do contexto fornecido — a estratégia trabalha só com o que foi dado.

Responda SOMENTE com o JSON: {"audience_insight": string, "tension": string, "opportunity": string, "promise_or_message": string, "communication_job": string, "emotional_direction": string, "desired_reaction": string, "reason_to_watch": string, "reason_to_believe": string, "angles": [{"name": string, "one_sentence_idea": string, "hook_direction": string, "emotional_mechanism": string, "why_it_fits_audience": string, "why_it_fits_brand": string, "visual_potential": string, "execution_risk": string, "scores": {"objective_fit": n, "audience_fit": n, "brand_fit": n, "originality": n, "hook_potential": n, "visual_potential": n, "executability": n, "factual_safety": n}}]}`;

export async function developStrategy(deps: StrategyDeps, input: StrategyInput): Promise<CreativeStrategy> {
  const user = [
    `Pedido:\n${input.briefing}`,
    input.clientContext ? `Contexto do cliente:\n${input.clientContext}` : '',
    input.mandatoryFacts && input.mandatoryFacts.length > 0
      ? `Fatos que a estratégia PODE usar (não invente além destes):\n${input.mandatoryFacts.map((f) => `- ${f}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  deps.logger?.info('otto: desenvolvendo estratégia e ângulos');
  return deps.llm.chatJson(
    [
      { role: 'system', content: STRATEGY_SYSTEM },
      { role: 'user', content: user },
    ],
    creativeStrategySchema,
    {
      temperature: 0.8,
      /**
       * BLOCKER 1 (Otto Elite, validação ao vivo real): developStrategy
       * falhou com "angles: Required" — a chave inteira ausente, não um
       * valor mal formado. Causa raiz provável: o schema é o maior de todo
       * o pipeline (9 campos de estratégia + até 6 ângulos × 9 campos + 8
       * scores cada), "angles" é o ÚLTIMO campo pedido no prompt, e o
       * budget padrão de JSON (DEFAULT_NUM_PREDICT_JSON=4000) corta a
       * geração antes do modelo chegar lá. Isto não é ruído de
       * representação (Missão 1-3 do fechamento anterior) — é conteúdo
       * semântico real (os ângulos) truncado por falta de espaço, e a
       * correção certa é dar espaço, não inventar ângulo em código nem
       * fingir que a chamada passou.
       */
      numPredict: 7_000,
    },
  );
}

/** Soma simples dos 8 scores do ângulo — nunca vem do modelo (ver nota de topo). */
export function deriveAngleTotal(scores: AngleScores): number {
  return Object.values(scores).reduce((total, value) => total + value, 0);
}

export interface AngleSelection {
  selected: CreativeAngle;
  selectionReason: string;
  rejected: Array<{ angle: CreativeAngle; reason: string }>;
}

/**
 * Seleciona o ângulo mais forte, mas PULA candidatos que falham no teste de
 * especificidade (Missão 7 do brief de estratégia: "poderia servir pra 5
 * marcas não relacionadas trocando só o nome?" — reaproveita
 * assessCreativeCopy, a mesma régua determinística que já protege a copy
 * final, aplicada aqui sobre a IDEIA do ângulo antes dele virar rascunho).
 */
export function selectBestAngle(strategy: CreativeStrategy, brandTerms: string[] = []): AngleSelection {
  const ranked = [...strategy.angles].sort((a, b) => deriveAngleTotal(b.scores) - deriveAngleTotal(a.scores));
  const rejected: Array<{ angle: CreativeAngle; reason: string }> = [];

  for (const angle of ranked) {
    const assessment = assessCreativeCopy(angle.one_sentence_idea, { brandTerms });
    if (assessment.generic) {
      rejected.push({ angle, reason: `genérico demais: ${assessment.reason}` });
      continue;
    }
    return {
      selected: angle,
      selectionReason: `maior pontuação total (${deriveAngleTotal(angle.scores)}/80) entre os ângulos que passaram no teste de especificidade`,
      rejected: [...rejected, ...ranked.filter((a) => a !== angle && !rejected.some((r) => r.angle === a)).map((a) => ({ angle: a, reason: 'pontuação total menor' }))],
    };
  }

  // Todos genéricos: entrega o de maior pontuação mesmo assim (nunca travar
  // o turno por causa do gate de especificidade), mas o motivo fica honesto.
  const fallback = ranked[0]!;
  return {
    selected: fallback,
    selectionReason: 'todos os ângulos falharam no teste de especificidade; selecionado o de maior pontuação mesmo assim',
    rejected: ranked.slice(1).map((a) => ({ angle: a, reason: 'pontuação total menor' })),
  };
}

const OBJECTIVE_ONLY_BIG_IDEA = [
  /^vamos (informar|divulgar|mostrar|apresentar)/i,
  /^(informar|divulgar|anunciar) que\b/i,
  /^comunicar que\b/i,
  // Puro anúncio de data/evento, sem promessa nem tensão — o caso real
  // observado ao vivo: "Abertura dia 24 de setembro." é a AGENDA, não a
  // ideia. Uma big idea de verdade usa o fato, não é só o fato.
  /^abertura( de vendas)?\s+(dia|em|no dia)\b/i,
];

/**
 * Teste da big idea (Missão 6): se a "ideia central" é só o objetivo de
 * negócio reformulado ("vamos informar que as vendas abrem"), não é uma
 * ideia — é a tarefa. Heurística determinística e barata, mesmo espírito de
 * assessCreativeCopy: não decide por nuance, decide pelo padrão óbvio.
 */
export function bigIdeaPassesTest(bigIdea: string): boolean {
  const trimmed = bigIdea.trim();
  if (trimmed.length < 12) return false;
  return !OBJECTIVE_ONLY_BIG_IDEA.some((pattern) => pattern.test(trimmed));
}

export interface DevelopBigIdeaInput {
  briefing: string;
  clientContext: string;
  selectedAngle: CreativeAngle;
  strategy: CreativeStrategy;
}

const BIG_IDEA_SYSTEM = `Você é um diretor de criação sênior. A partir do ângulo escolhido, produza:

- big_idea: a proposição criativa em UMA frase que governa a peça inteira. NÃO é o objetivo de negócio reformulado ("vamos informar que...") — é o que torna ESTA peça diferente de qualquer anúncio genérico do mesmo assunto.
- hooks: EXATAMENTE 5 aberturas candidatas (hooks) pra essa ideia, cada uma com:
  - text: o texto/conceito do hook em si
  - scores: stop_power, specificity, curiosity, clarity, believability, brand_fit, continuation_power (0 a 10 cada, julgue isoladamente)

Não maximize stop_power às custas de verdade ou brand_fit — hook que promete o que a peça não entrega é problema, não força.

Responda SOMENTE com o JSON: {"big_idea": string, "hooks": [{"text": string, "scores": {"stop_power": n, "specificity": n, "curiosity": n, "clarity": n, "believability": n, "brand_fit": n, "continuation_power": n}}]}`;

export async function developBigIdeaAndHooks(deps: StrategyDeps, input: DevelopBigIdeaInput): Promise<BigIdeaAndHooks> {
  const user = [
    `Pedido:\n${input.briefing}`,
    input.clientContext ? `Contexto do cliente:\n${input.clientContext}` : '',
    `Ângulo escolhido: ${input.selectedAngle.name}\nIdeia: ${input.selectedAngle.one_sentence_idea}\nDireção do hook: ${input.selectedAngle.hook_direction}\nMecanismo emocional: ${input.selectedAngle.emotional_mechanism}`,
    `Promessa/mensagem da estratégia: ${input.strategy.promise_or_message}\nTensão: ${input.strategy.tension}`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  deps.logger?.info('otto: desenvolvendo big idea e hooks');
  return deps.llm.chatJson(
    [
      { role: 'system', content: BIG_IDEA_SYSTEM },
      { role: 'user', content: user },
    ],
    bigIdeaAndHooksSchema,
    // BLOCKER 1: mesmo raciocínio de developStrategy — 5 hooks × 7 scores é
    // um schema grande, budget padrão de 4000 arrisca truncar "hooks".
    { temperature: 0.8, numPredict: 5_000 },
  );
}

/** Soma simples dos 7 scores do hook — nunca vem do modelo. */
export function deriveHookTotal(scores: HookScores): number {
  return Object.values(scores).reduce((total, value) => total + value, 0);
}

/** Escolhe o hook de maior pontuação total. */
export function selectBestHook(bigIdeaAndHooks: BigIdeaAndHooks): HookCandidate {
  return [...bigIdeaAndHooks.hooks].sort((a, b) => deriveHookTotal(b.scores) - deriveHookTotal(a.scores))[0]!;
}

/**
 * Bloco de texto compacto pra injetar no draft (createCreativePlan/
 * planVideo/planCarousel) — o "execution plan" da Missão 10 é dobrado aqui
 * dentro em vez de virar uma terceira chamada de LLM: os campos que mais
 * importam pra execução (visual_potential, execution_risk, big idea, hook)
 * já existem nas duas chamadas anteriores.
 */
export function formatStrategyBriefing(
  strategy: CreativeStrategy,
  angle: CreativeAngle,
  bigIdea: string,
  hook: HookCandidate,
): string {
  return [
    'DIREÇÃO ESTRATÉGICA DESTA PEÇA (decidida antes do rascunho — siga, não reabra):',
    `Ideia central (big idea): ${bigIdea}`,
    `Ângulo: ${angle.name} — ${angle.one_sentence_idea}`,
    `Hook a usar: ${hook.text}`,
    `Promessa: ${strategy.promise_or_message}`,
    `Tensão que a peça resolve: ${strategy.tension}`,
    `Direção emocional: ${strategy.emotional_direction}`,
    `Potencial visual do ângulo: ${angle.visual_potential}`,
    `Risco de execução a evitar: ${angle.execution_risk}`,
  ].join('\n');
}
