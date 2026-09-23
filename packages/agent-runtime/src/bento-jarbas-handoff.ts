/**
 * bento-jarbas-handoff.ts — detecção de intenção de handoff (§21/§28).
 *
 * Puro e determinístico — nenhuma chamada de rede, nenhum LLM. Detecta se
 * uma mensagem do Bento é (a) um pedido pra atribuir análise ao Jarbas ou
 * (b) uma pergunta de status sobre uma tarefa já atribuída. NÃO está
 * conectado ao caminho de produção do Bento (bento-action-guard.ts) nesta
 * missão — ver docs/coordination/JARBAS_SENIOR_HANDOFF.md pelo motivo:
 * o AgentTaskStore desta branch é só em memória (nenhuma migração de
 * schema foi feita, de propósito, pra não abrir risco de deploy); ligar
 * isto ao caminho real perderia estado a cada restart do worker sem
 * avisar ninguém — exatamente o "fake success" que a missão pede pra nunca
 * fazer. Fica pronto, testado, pra quando a persistência real existir.
 */

const HANDOFF_VERBS = /\b(manda|pede|atribui|joga|passa)\b/i;
const JARBAS_MENTION = /\bjarbas\b/i;

export interface JarbasHandoffIntent {
  objective: string;
}

/**
 * "Bento, manda o Jarbas analisar a Cosentino" / "Bento, atribui essa task
 * ao Jarbas" / "Jarbas, pega essa task" — variações amplas, não overfit em
 * frase exata (§28/§52).
 */
export function detectJarbasHandoffRequest(message: string): JarbasHandoffIntent | null {
  const texto = message.trim();
  if (texto.length === 0) return null;

  // "Jarbas, pega essa task"/"Jarbas resolve essa task" — Jarbas é o
  // vocativo direto, não precisa do verbo de handoff.
  if (/^jarbas\b/i.test(texto) && /\b(pega|resolve|olha)\b/i.test(texto)) {
    return { objective: texto };
  }

  if (!JARBAS_MENTION.test(texto)) return null;
  if (!HANDOFF_VERBS.test(texto)) return null;

  return { objective: texto };
}

// Sem \b no fim: "está"/"não" terminam em vogal acentuada, que o motor de
// regex do JS (modo não-unicode) não trata como caractere de palavra — um
// \b logo depois nunca bate (mesma pegadinha já documentada em
// bento-action-guard.ts pra "amanhã").
const STATUS_QUERY = /\b(terminou|finalizou|acabou|conclu[íi]u|onde (ele |ela )?(est[áa]|ficou)|o que (ele )?(achou|encontrou|falou)|qual (foi a )?(recomenda[çc][ãa]o|resultado)|o que (falt|ficou faltando))/i;

/** "o Jarbas terminou?" / "o que ele achou?" / "onde ele está?" (§26/§46). */
export function detectJarbasStatusQuery(message: string): boolean {
  const texto = message.trim();
  if (texto.length === 0) return false;
  if (!JARBAS_MENTION.test(texto) && !/\b(ele|essa an[áa]lise|aquela an[áa]lise)\b/i.test(texto)) return false;
  return STATUS_QUERY.test(texto);
}

/** "aumenta orçamento em 20%" endereçado ao Jarbas — nunca executa, sempre vira proposta (§24/§49). */
const META_MUTATION_REQUEST = /\b(aumenta[r]?|reduz[ir]?|diminui[r]?|muda[r]?|troca[r]?|pausa[r]?|retoma[r]?|duplica[r]?|publica[r]?|cria[r]?)\b.{0,40}\b(or[çc]amento|budget|lance|bid|p[uú]blico|audi[êe]ncia|criativo|campanha|conjunto de an[uú]ncios|adset|an[uú]ncio)\b/i;

export function detectForbiddenMetaMutationRequest(message: string): boolean {
  return META_MUTATION_REQUEST.test(message.trim());
}

/**
 * "aumenta orçamento 20%" -> proposta, NUNCA execução (§12/§24). O tipo é
 * sempre inferido do PRIMEIRO verbo de mutação reconhecido na mensagem —
 * quando nenhum bate com precisão, cai em 'budget_change' como default
 * conservador (ainda assim, nunca vira mutação real).
 */
export function buildProposedAction(params: {
  message: string;
  entityId: string;
  currentValue?: string | number | null;
}): { type: 'budget_change' | 'bid_change' | 'audience_change' | 'creative_change' | 'pause' | 'resume' | 'duplicate' | 'publish'; entityId: string; currentValue: string | number | null; proposedValue: string; reason: string; evidenceRefs: string[]; risk: string; requiresApproval: true } | null {
  const texto = params.message.trim();
  if (!detectForbiddenMetaMutationRequest(texto)) return null;

  let type: 'budget_change' | 'bid_change' | 'audience_change' | 'creative_change' | 'pause' | 'resume' | 'duplicate' | 'publish' = 'budget_change';
  if (/pausa/i.test(texto)) type = 'pause';
  else if (/retoma/i.test(texto)) type = 'resume';
  else if (/duplica/i.test(texto)) type = 'duplicate';
  else if (/publica/i.test(texto)) type = 'publish';
  else if (/criativo/i.test(texto)) type = 'creative_change';
  else if (/p[uú]blico|audi[êe]ncia/i.test(texto)) type = 'audience_change';
  else if (/lance|bid/i.test(texto)) type = 'bid_change';

  return {
    type,
    entityId: params.entityId,
    currentValue: params.currentValue ?? null,
    proposedValue: texto,
    reason: `pedido explícito do usuário: "${texto}"`,
    evidenceRefs: [],
    risk: 'requer aprovação humana antes de qualquer execução — nenhum caminho de código deste repositório executa isto sozinho',
    requiresApproval: true,
  };
}
