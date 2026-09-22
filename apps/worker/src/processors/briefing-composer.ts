import { DELIVERY_LABEL, classifyDeliveryType, sectionsFor, type BriefingSection, type DeliveryType } from './briefing-schema';
import { factFor, type BriefingFact } from './briefing-facts';

/**
 * briefing-composer.ts — monta o briefing a partir dos FATOS recuperados.
 *
 * Não escreve prosa bonita sobre o que não sabe: campo com fato vira linha
 * preenchida; campo sem fato vira PENDÊNCIA nominal. É o oposto do template
 * anterior, que preenchia tudo com frase genérica e por isso passava a
 * impressão de briefing completo sem conter informação nenhuma.
 */

export interface ComposeInput {
  taskName: string;
  clientName: string | null;
  deliveryType: DeliveryType;
  facts: BriefingFact[];
  /** Referências brutas (links, anexos, comentários) pra seção de referências. */
  references: string[];
  requestedBy: string;
  /**
   * O pedido do humano, em uma linha. É o fato mais básico do briefing — a
   * SITUAÇÃO que originou a demanda — e vinha faltando: o campo era crítico
   * e nenhuma fonte o preenchia, então até briefing rico reprovava.
   */
  requestSummary?: string | null;
  dueDateLabel: string | null;
  assignee: string | null;
}

export interface ComposedBriefing {
  markdown: string;
  deliveryType: DeliveryType;
  /** Campos críticos sem fonte — o que trava a execução. */
  missingCritical: string[];
  /** Todos os campos sem fonte, pra seção de pendências. */
  missing: string[];
  /** Campos preenchidos, com a fonte de cada um (rastro interno). */
  grounded: Array<{ field: string; source: string }>;
}

function valorDoCampo(input: ComposeInput, key: string): BriefingFact | null {
  // Campos que o próprio turno conhece (não vêm de retrieval).
  if (key === 'cliente' && input.clientName) {
    return { field: key, value: input.clientName, source: 'cadastro do cliente' };
  }
  if (key === 'tipo_entrega') {
    return { field: key, value: DELIVERY_LABEL[input.deliveryType], source: 'classificação do pedido' };
  }
  if (key === 'responsavel' && input.assignee) {
    return { field: key, value: input.assignee, source: 'task no ClickUp' };
  }
  if (key === 'prazo' && input.dueDateLabel) {
    return { field: key, value: input.dueDateLabel, source: 'task no ClickUp' };
  }
  if (key === 'situacao' && input.requestSummary) {
    return { field: key, value: input.requestSummary, source: 'pedido do usuário' };
  }
  if (key === 'origem') {
    return { field: key, value: `Pedido de ${input.requestedBy} no chat do Desigual OS`, source: 'execução atual' };
  }
  if (key === 'referencias' && input.references.length > 0) {
    return { field: key, value: input.references.join('; ').slice(0, 400), source: 'comentários e anexos da task' };
  }
  return factFor(input.facts, key);
}

function renderSecao(secao: BriefingSection, input: ComposeInput, missing: string[], missingCritical: string[], grounded: Array<{ field: string; source: string }>): string[] {
  const linhas: string[] = [];
  for (const campo of secao.fields) {
    const fato = valorDoCampo(input, campo.key);
    if (fato) {
      linhas.push(`- ${campo.label}: ${fato.value}`);
      grounded.push({ field: campo.key, source: fato.source });
    } else {
      missing.push(campo.label);
      if (campo.critical) missingCritical.push(campo.label);
    }
  }
  if (linhas.length === 0) return [];
  return [`## ${secao.title}`, ...linhas, ''];
}

/**
 * Campos CRÍTICOS que este pedido específico ainda não resolve — nem por
 * fato especial do turno (cliente, prazo...) nem por fato recuperado
 * (`input.facts`). É a mesma checagem que `composeBriefing` faz por dentro,
 * exposta ANTES de montar o markdown, pra quem chama (o guard) poder tentar
 * preencher a lacuna com o próprio pedido antes de aceitar [CONFIRMAR] —
 * sem regenerar o briefing inteiro, só os campos que faltam de verdade.
 */
export function pendingCriticalFields(input: ComposeInput): Array<{ key: string; label: string }> {
  const pendentes: Array<{ key: string; label: string }> = [];
  for (const secao of sectionsFor(input.deliveryType)) {
    for (const campo of secao.fields) {
      if (!campo.critical) continue;
      if (!valorDoCampo(input, campo.key)) pendentes.push({ key: campo.key, label: campo.label });
    }
  }
  return pendentes;
}

export function composeBriefing(input: ComposeInput): ComposedBriefing {
  const missing: string[] = [];
  const missingCritical: string[] = [];
  const grounded: Array<{ field: string; source: string }> = [];

  const corpo: string[] = [`# Briefing: ${input.taskName}`, ''];
  for (const secao of sectionsFor(input.deliveryType)) {
    corpo.push(...renderSecao(secao, input, missing, missingCritical, grounded));
  }

  if (missing.length > 0) {
    corpo.push(
      '## PENDENTE DE CONFIRMAÇÃO',
      'Não encontrei estas informações nas fontes consultadas (dossiê do cliente, memória, comentários da task e o próprio pedido). Não preenchi por dedução:',
      ...missing.map((m) => `- ${m}`),
      '',
    );
  }

  return { markdown: corpo.join('\n').trimEnd(), deliveryType: input.deliveryType, missingCritical, missing, grounded };
}

export { classifyDeliveryType };
