import type { ComposedBriefing } from './briefing-composer';

/**
 * briefing-quality.ts — porta de qualidade do briefing.
 *
 * Existe por causa de um caso real: o briefing anexado no smoke dizia
 * "Executar a entrega descrita no título desta task" e "Detalhes adicionais
 * devem ser complementados pelo solicitante". Foi anexado, verificado por
 * read-back, e mesmo assim era inútil — ninguém consegue executar a partir
 * dali. Anexar não é entregar.
 *
 * As dimensões são calculadas do briefing COMPOSTO (estrutura + fatos +
 * pendências), não de impressão sobre o texto.
 */

export interface BriefingEvaluation {
  /** Um funcionário conseguiria executar sem reinterpretar a demanda? */
  executable: boolean;
  score: number;
  dimensions: {
    contextCompleteness: number;
    objectiveClarity: number;
    executionClarity: number;
    clientSpecificity: number;
    deliverableClarity: number;
    referenceUsage: number;
    constraintClarity: number;
    approvalCriteria: number;
    factualGrounding: number;
    nonGenericness: number;
  };
  missingCritical: string[];
  genericSections: string[];
  /** Afirmações sem fonte — aqui sempre vazio por construção, mas o campo
   * existe pra quando um escritor externo preencher o briefing. */
  hallucinatedClaims: string[];
  recommendation: 'approve' | 'revise' | 'retrieve_more_context' | 'ask_user';
}

/** Frases que preenchem espaço sem dizer nada — o pior tipo de briefing. */
const FRASES_GENERICAS = [
  'executar a entrega descrita no t',
  'detalhes adicionais devem ser complementados',
  'criar uma campanha de qualidade',
  'produzir conte[úu]do alinhado',
  'conte[úu]do alinhado com a marca',
  'seguir o padr[ãa]o da ag[êe]ncia',
  'material de alta qualidade',
  'conforme solicitado',
  'de acordo com as necessidades do cliente',
  'entrega revisada e aprovada pelo solicitante',
];
const RE_GENERICAS = new RegExp(FRASES_GENERICAS.join('|'), 'i');

function norm(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function evaluateBriefing(b: ComposedBriefing, opts: { clientName?: string | null } = {}): BriefingEvaluation {
  const texto = b.markdown;
  const flat = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const totalCampos = b.grounded.length + b.missing.length;

  const tem = (field: string): boolean => b.grounded.some((g) => g.field === field);

  const contextCompleteness = totalCampos === 0 ? 0 : norm(b.grounded.length / totalCampos);
  const objectiveClarity = tem('objetivo') ? 1 : 0;
  const executionClarity = tem('entregaveis') ? 1 : 0;
  const deliverableClarity = executionClarity;
  const approvalCriteria = tem('aprovacao') ? 1 : 0;
  const referenceUsage = tem('referencias') ? 1 : 0.5;
  const constraintClarity = tem('proibidos') || tem('obrigatorios') || tem('tom') ? 1 : 0.5;

  // Específico ao cliente: cita o nome E traz pelo menos um fato que só existe
  // pra esse cliente (público/oferta/posicionamento/tom).
  const citaCliente = Boolean(opts.clientName) && flat.includes((opts.clientName ?? '').toLowerCase());
  const fatoDoCliente = ['publico', 'oferta', 'posicionamento', 'tom', 'produto', 'diferenciais'].some(tem);
  const clientSpecificity = norm((citaCliente ? 0.4 : 0) + (fatoDoCliente ? 0.6 : 0));

  // Grounding: todo campo preenchido tem fonte declarada (invariante da composição).
  const semFonte = b.grounded.filter((g) => !g.source || g.source.trim().length === 0);
  const factualGrounding = b.grounded.length === 0 ? 0 : norm(1 - semFonte.length / b.grounded.length);

  const genericSections: string[] = [];
  if (RE_GENERICAS.test(texto)) genericSections.push('texto com frase genérica de preenchimento');
  // Briefing que é quase só pendência não é briefing: é um formulário vazio.
  if (totalCampos > 0 && b.grounded.length / totalCampos < 0.3) genericSections.push('quase nenhum campo com fonte real');
  const nonGenericness = genericSections.length === 0 ? 1 : 0;

  const dimensions = {
    contextCompleteness,
    objectiveClarity,
    executionClarity,
    clientSpecificity,
    deliverableClarity,
    referenceUsage,
    constraintClarity,
    approvalCriteria,
    factualGrounding,
    nonGenericness,
  };

  const valores = Object.values(dimensions);
  const score = Number((valores.reduce((a, b2) => a + b2, 0) / valores.length).toFixed(3));

  const executable = b.missingCritical.length === 0 && nonGenericness === 1 && objectiveClarity === 1 && executionClarity === 1;

  // A recomendação diz O QUE FAZER, não só que está ruim.
  let recommendation: BriefingEvaluation['recommendation'] = 'approve';
  if (!executable) {
    // A ordem importa: quando o problema é FALTA DE CONTEXTO, mandar revisar
    // só produz outra versão vazia. Buscar mais contexto vem primeiro;
    // reescrever só resolve quando já existe matéria-prima.
    if (contextCompleteness < 0.5) recommendation = 'retrieve_more_context';
    else if (genericSections.length > 0) recommendation = 'revise';
    else if (b.missingCritical.length > 0) recommendation = 'ask_user';
    else recommendation = 'revise';
  }

  return {
    executable,
    score,
    dimensions,
    missingCritical: b.missingCritical,
    genericSections,
    hallucinatedClaims: [],
    recommendation,
  };
}
