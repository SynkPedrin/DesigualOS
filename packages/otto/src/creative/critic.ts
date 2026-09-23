import type { Logger } from '@desigual-os/logging';
import type { OttoLLMProvider } from '../llm/ollama-provider.js';
import { criticEvaluationSchema, type CriticEvaluation, type CriticRootCause, type CriticScores } from './schemas.js';

/**
 * critic.ts — Otto Elite Phase 2, Fase 2 (Fases 9-15 do brief): o primeiro
 * draft NUNCA é o produto final pra pedidos elite (reels/vídeo/carrossel).
 *
 * Uma única inferência estruturada avalia o ENTREGÁVEL RENDERIZADO — o texto
 * exatamente como o humano vai ler — sob múltiplas lentes (creative director,
 * copy chief, content strategist, platform editor, brand guardian, audiência
 * cética), dobradas numa chamada só (o brief autoriza isso explicitamente:
 * "não precisam virar 10 chamadas caras... algumas podem ocorrer em uma
 * única inferência estruturada"). Rodar 6 chamadas separadas nesta máquina,
 * a ~3-6min por chamada já medidos nesta sessão, tornaria o critic sozinho
 * mais lento que a geração inteira.
 *
 * `overall` e o veredito do gate NÃO vêm do modelo — são calculados em
 * código a partir dos dez scores. Mesma lição do bug de `duration`
 * (commit 375f7ba): pedir pro modelo fazer a conta certa em cima do que ele
 * mesmo gerou é pedir aritmética que ele erra de forma consistente.
 */

export interface CriticDeps {
  llm: OttoLLMProvider;
  logger?: Logger;
}

export interface CriticInput {
  /** O pedido original do usuário, sem o bloco de contexto do orquestrador. */
  briefing: string;
  /** O texto EXATAMENTE como o humano vai ler (resposta já renderizada). */
  renderedAnswer: string;
  /** Entregáveis nomeados explicitamente no pedido (ver output-contract.ts). */
  requestedDeliverables?: string[];
  /**
   * Resumo da camada estratégica (Otto Elite — Missão 14: "the critic must
   * evaluate not only the final draft, but alignment with: creative brief,
   * selected angle, big idea, hook, execution plan"). Ver
   * strategy.ts::formatStrategyBriefing. Sem isto, o critic só vê o texto
   * final e não consegue dizer SE a peça é fiel à estratégia decidida — só
   * se o texto em si está bom, que é uma pergunta mais rasa.
   */
  strategyContext?: string;
}

const CRITIC_SYSTEM = `Você é um painel de revisão criativa sênior da agência Desigual, julgando o trabalho de outro criativo antes dele chegar ao cliente. Avalie como as seguintes perspectivas julgariam JUNTAS, numa única nota por dimensão:

- CREATIVE DIRECTOR: existe uma ideia central? Ela é forte o bastante pra carregar a peça?
- COPY CHIEF: o texto soa humano, tem ritmo, ou soa "texto de IA" (genérico, cheio de clichê corporativo)?
- CONTENT STRATEGIST: a peça serve o objetivo e o público certos, no estágio de consciência certo?
- PLATFORM EDITOR: a forma (duração, ritmo, estrutura) é nativa do formato/plataforma pedido?
- BRAND GUARDIAN: o tom bate com a marca descrita no contexto?
- AUDIÊNCIA CÉTICA: "por que eu pararia de rolar pra ver isso? por que eu acreditaria?"

Julgue cada dimensão de 0 a 10, SEM CALCULAR MÉDIA OU TOTAL (isso é feito por código, não pelo seu julgamento):
- strategy: a peça serve o objetivo declarado e entende o público certo?
- concept: existe uma ideia central em uma frase, ou é só "falar sobre o produto"?
- hook: a abertura para o scroll, gera curiosidade específica e acreditável?
- specificity: se trocássemos o nome do cliente por outro, isso ainda faria sentido? (nota baixa = sim, troca sem perder nada)
- originality: isso foge de fórmula/clichê de anúncio genérico?
- brand_fit: o tom bate com o que o contexto descreve da marca?
- copy: o texto soa humano, tem ritmo e personalidade, ou soa "texto de IA"?
- retention: para vídeo/carrossel, existe estrutura que sustenta atenção até o fim (não é só um bloco de texto)?
- platform_fit: a forma é nativa do formato pedido (duração, estrutura, linguagem)?
- executability: um editor/designer consegue produzir a partir disto amanhã, sem voltar perguntando o que fazer?

Marque as flags (booleano ou lista) quando aplicável:
- missing_deliverables: liste aqui qualquer entregável PEDIDO explicitamente que NÃO apareceu na resposta (compare contra a lista de entregáveis pedidos, se fornecida)
- genericity: a peça serviria pra qualquer marca no mesmo setor
- unsupported_claims: liste qualquer número, data, garantia ou fato que a resposta afirma sem ter vindo do briefing. ISTO INCLUI reformulação criativa que FORTALECE o fato original além do que ele realmente diz — dramatizar a APRESENTAÇÃO é permitido, fortalecer a AFIRMAÇÃO por trás não é. Classes de fato pra checar com cuidado: preço, disponibilidade, escassez, reserva/vaga garantida, garantia, propriedade/posse, entrega, ausência de burocracia, prazo, resultado, prova, característica, condição comercial. Exemplos REAIS de fortalecimento indevido (achados ao vivo nesta sessão):
  - briefing diz "sem necessidade de cadastro" -> resposta diz "sem papelada" (generaliza de UM processo específico pra TODA burocracia — sinalize)
  - briefing diz "abertura de vendas" -> resposta diz "as chaves já estão na sua mão" (vendas abertas não é posse/entrega — sinalize)
  - briefing NÃO menciona escassez/vagas limitadas -> resposta diz "garanta sua vaga" (implica escassez que não foi dita — sinalize)
  Se a resposta faz esse tipo de salto, liste a frase exata em unsupported_claims mesmo que o "espírito" pareça compatível com o briefing.
- weak_hook: abertura fraca ou óbvia
- weak_concept: não há ideia central clara
- bad_cta: call-to-action ausente, vago ou deslocado
- bad_platform_fit: forma não bate com o formato pedido
- ai_slop: presença de clichê típico de IA ("em um mundo cada vez mais...", "não é apenas...", "transformando a forma como...", "revolucionando...", "leve ao próximo nível", "o futuro chegou")
- over_explanation: a resposta explica demais o próprio raciocínio em vez de entregar a peça
- missing_production_direction: falta direção de execução (visual, tempo, tom) pra quem for produzir
- brand_mismatch: tom incompatível com o que o contexto diz da marca

Se uma DIREÇÃO ESTRATÉGICA (big idea, ângulo, hook escolhido) foi fornecida, avalie também se a resposta é FIEL a ela — não só se o texto final está bom isoladamente. Uma peça polida que abandona o ângulo/big idea decidido antes é uma falha de fidelidade, não uma vitória de copy.

Quando reprovar, classifique "root_cause" na camada mais crítica que falhou (não liste várias — a MAIS crítica):
- STRATEGY: a peça não serve o objetivo/público real
- ANGLE: o ângulo escolhido não está sendo seguido ou era fraco
- BIG_IDEA: não há proposição criativa central clara
- HOOK: a abertura não segura atenção
- STRUCTURE: a peça não tem estrutura/progressão coerente
- COPY: a ideia está certa mas o texto em si é fraco/genérico/soa IA
- BRAND_FIT: tom incompatível com a marca
- EXECUTABILITY: falta direção concreta pra quem for produzir
- FACTUAL: afirma algo sem base no briefing
- DELIVERABLE: falta um item pedido
- NONE: a peça passa

Escolha UMA. Isto decide se a reescrita regenera só a copy ou volta pra camada estratégica (ângulo/big idea/hook) — classificar errado desperdiça uma reescrita inteira polindo frase quando o problema é a ideia.

Seja severo e honesto. Aprovar peça mediana custa mais caro pra agência do que reprovar e refazer. "reasoning" é uma frase curta e ACIONÁVEL — o que precisa mudar, não uma descrição do que já está lá.

Responda SOMENTE com o JSON: {"scores": {"strategy": n, "concept": n, "hook": n, "specificity": n, "originality": n, "brand_fit": n, "copy": n, "retention": n, "platform_fit": n, "executability": n}, "flags": {"missing_deliverables": string[], "genericity": bool, "unsupported_claims": string[], "weak_hook": bool, "weak_concept": bool, "bad_cta": bool, "bad_platform_fit": bool, "ai_slop": bool, "over_explanation": bool, "missing_production_direction": bool, "brand_mismatch": bool}, "reasoning": string, "root_cause": "STRATEGY"|"ANGLE"|"BIG_IDEA"|"HOOK"|"STRUCTURE"|"COPY"|"BRAND_FIT"|"EXECUTABILITY"|"FACTUAL"|"DELIVERABLE"|"NONE"}`;

export async function critiqueDeliverable(deps: CriticDeps, input: CriticInput): Promise<CriticEvaluation> {
  const user = [
    `Pedido original do usuário:\n${input.briefing}`,
    input.requestedDeliverables && input.requestedDeliverables.length > 0
      ? `Entregáveis pedidos explicitamente: ${input.requestedDeliverables.join(', ')}`
      : null,
    input.strategyContext ? `${input.strategyContext}` : null,
    `Resposta gerada (exatamente como o humano vai ler):\n\n${input.renderedAnswer}`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  deps.logger?.info('otto: critic avaliando entregável renderizado');
  return deps.llm.chatJson(
    [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: user },
    ],
    criticEvaluationSchema,
    { temperature: 0.2 },
  );
}

/** Média simples dos dez scores, 0-100. Ver nota no topo do arquivo sobre por que isto não vem do modelo. */
export function deriveCriticOverall(scores: CriticScores): number {
  const values = Object.values(scores);
  const avg = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.round(avg * 10);
}

export interface CriticGateResult {
  passed: boolean;
  overall: number;
  reasons: string[];
}

/**
 * Completude de entregáveis CALCULADA EM CÓDIGO (Otto Senior 20Y, Missão 7:
 * "Do NOT ask the model to self-certify completeness"). O critic também
 * reporta `flags.missing_deliverables`, mas isso é o modelo julgando o
 * próprio trabalho — o mesmo modelo que já demonstrou nesta sessão que
 * esquece campos e instruções sob pressão de prompt longo. Quando o
 * chamador sabe quais entregáveis foram pedidos (ver output-contract.ts),
 * a verificação real é procurar a seção correspondente na resposta
 * RENDERIZADA — determinístico, não opinião.
 *
 * Cobre só os dois rótulos que o caminho de produção de fato renderiza
 * (formatPlanAnswer/formatVideoScript): "Legenda:" e "Roteiro:". Os demais
 * tipos de artefato (título, headline, prompt, email, nome) só existem no
 * caminho de chat, que já garante completude na hora da geração via
 * contratoDeSaida/diretivaDoContrato — não há rótulo fixo pra checar aqui.
 */
export function computeMissingDeliverables(renderedAnswer: string, requestedDeliverables: string[]): string[] {
  const missing: string[] = [];
  // [ \t]*, não \s*: \s* atravessa quebra de linha e o teste passaria mesmo
  // com "Legenda:" vazio seguido de QUALQUER outra seção não-vazia mais
  // adiante na resposta (achado ao escrever o teste desta função).
  if (requestedDeliverables.includes('legenda') && !/Legenda:[ \t]*\S/.test(renderedAnswer)) {
    missing.push('legenda');
  }
  if (requestedDeliverables.includes('roteiro') && !renderedAnswer.includes('Roteiro:')) {
    missing.push('roteiro');
  }
  return missing;
}

/**
 * INVARIANTE (Otto Elite, Blocker 2): uma reescrita NUNCA pode remover um
 * entregável que já existia numa versão válida anterior. Achado ao vivo
 * real: o draft tinha roteiro; a reescrita #2 devolveu só conceito+legenda,
 * perdendo o roteiro — e sem esta checagem, essa reescrita PIOR teria virado
 * a versão "corrigida". Compara a lista de faltantes ANTES e DEPOIS: o que
 * está em `depois` mas não estava em `antes` é uma REGRESSÃO — o candidato
 * deve ser rejeitado (mantém a versão anterior), não aceito como melhoria.
 */
export function deliverableRegression(missingBefore: string[], missingAfter: string[]): string[] {
  return missingAfter.filter((item) => !missingBefore.includes(item));
}

/**
 * Gate de qualidade (Fase 13 do brief): overall < 88 OU concept < 8 OU
 * copy < 8 OU executability < 8 OU falta entregável pedido → falha.
 *
 * `codeMissingDeliverables`, quando fornecido, SUBSTITUI
 * `evaluation.flags.missing_deliverables` como fonte da checagem de
 * completude (Missão 7) — o código manda, não a autoavaliação do modelo.
 * Omitido (undefined), o gate cai de volta no que o critic reportou
 * (compatibilidade com quem ainda não tem a lista de entregáveis pedidos
 * à mão).
 */
export function passesCriticGate(evaluation: CriticEvaluation, codeMissingDeliverables?: string[]): CriticGateResult {
  const overall = deriveCriticOverall(evaluation.scores);
  const reasons: string[] = [];
  if (overall < 88) reasons.push(`nota geral ${overall}/100 abaixo de 88`);
  if (evaluation.scores.concept < 8) reasons.push(`concept ${evaluation.scores.concept}/10 abaixo de 8`);
  if (evaluation.scores.copy < 8) reasons.push(`copy ${evaluation.scores.copy}/10 abaixo de 8`);
  if (evaluation.scores.executability < 8) reasons.push(`executability ${evaluation.scores.executability}/10 abaixo de 8`);
  const missingDeliverables = codeMissingDeliverables ?? evaluation.flags.missing_deliverables;
  if (missingDeliverables.length > 0) {
    reasons.push(`entregável(is) pedido(s) faltando: ${missingDeliverables.join(', ')}`);
  }
  return { passed: reasons.length === 0, overall, reasons };
}

/**
 * Escopo da reescrita (Otto Elite — Missão 16). Uma falha classificada em
 * STRATEGY/ANGLE/BIG_IDEA/HOOK precisa regenerar a CAMADA ESTRATÉGICA
 * inteira (novo ângulo, nova big idea, novo hook) antes de redigir de novo
 * — polir a frase quando o problema é a IDEIA é a "reescrita de sinônimo"
 * que a missão proíbe. As demais causas (COPY/STRUCTURE/BRAND_FIT/
 * EXECUTABILITY/FACTUAL/DELIVERABLE) só exigem reescrever o texto com a
 * estratégia já decidida — refazer o ângulo não resolveria um problema que
 * é de execução, e custaria uma chamada de LLM inteira à toa.
 */
const STRATEGY_LAYER_ROOT_CAUSES: readonly CriticRootCause[] = ['STRATEGY', 'ANGLE', 'BIG_IDEA', 'HOOK'];

export function rewriteRequiresStrategyLayer(rootCause: CriticRootCause): boolean {
  return STRATEGY_LAYER_ROOT_CAUSES.includes(rootCause);
}

/**
 * Nota de revisão pro passo de geração reaproveitar (mesmo mecanismo do loop
 * anti-genérico em creative-pipeline.ts: `revisionNote` concatenado no
 * briefing). Lista o que falhou E o motivo de cada flag marcada, pra a
 * reescrita saber O QUE mudar — ângulo, hook, estrutura — não só "reescreva".
 */
export function formatCriticRevisionNote(evaluation: CriticEvaluation, gate: CriticGateResult): string {
  const flagNotes: string[] = [];
  if (evaluation.flags.genericity) flagNotes.push('a peça serviria pra qualquer marca — troque a especificidade, não o sinônimo');
  if (evaluation.flags.weak_hook) flagNotes.push('a abertura é fraca — troque o ângulo do hook, não só a frase');
  if (evaluation.flags.weak_concept) flagNotes.push('não há ideia central clara — a peça precisa de um CONCEITO, não só texto bonito');
  if (evaluation.flags.bad_cta) flagNotes.push('o CTA está ausente, vago ou deslocado');
  if (evaluation.flags.bad_platform_fit) flagNotes.push('a forma não é nativa do formato pedido');
  if (evaluation.flags.ai_slop) flagNotes.push('há clichê típico de texto de IA — reescreva em português natural, sem fórmula');
  if (evaluation.flags.over_explanation) flagNotes.push('a resposta explica demais o raciocínio em vez de entregar a peça');
  if (evaluation.flags.missing_production_direction) flagNotes.push('falta direção de execução pra quem for produzir');
  if (evaluation.flags.brand_mismatch) flagNotes.push('o tom não bate com a marca');
  if (evaluation.flags.unsupported_claims.length > 0) {
    flagNotes.push(`remova ou marque como [A CONFIRMAR] estas afirmações sem fonte: ${evaluation.flags.unsupported_claims.join('; ')}`);
  }
  if (evaluation.flags.missing_deliverables.length > 0) {
    flagNotes.push(`ENTREGA INCOMPLETA — faltou: ${evaluation.flags.missing_deliverables.join(', ')}. Entregue TODOS os itens pedidos.`);
  }

  return [
    `A versão anterior falhou na revisão de qualidade (nota ${gate.overall}/100, mínimo 88):`,
    ...gate.reasons.map((reason) => `- ${reason}`),
    evaluation.root_cause && evaluation.root_cause !== 'NONE'
      ? `Causa raiz (camada que falhou): ${evaluation.root_cause}.`
      : '',
    evaluation.reasoning ? `Avaliação: ${evaluation.reasoning}` : '',
    flagNotes.length > 0 ? `O que precisa mudar:\n${flagNotes.map((note) => `- ${note}`).join('\n')}` : '',
    'Reescreva. Isto pode significar trocar ângulo, conceito, hook, estrutura ou CTA — não é troca de sinônimo. Preserve os fatos do briefing original.',
  ]
    .filter(Boolean)
    .join('\n');
}
