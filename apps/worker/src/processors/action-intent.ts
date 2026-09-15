/**
 * action-intent.ts — ANÁLISE NÃO É ESCRITA.
 *
 * Caso real (feedback de colaboradora, deploy anterior): ela pediu uma ANÁLISE
 * de umas peças e o sistema criou uma task na hora, na lista errada, com o
 * título copiado da mensagem ("Peças que você confia, você tem"), sem
 * responsável e sem contexto. O gatilho de criação era um regex solto que
 * aceitava qualquer ocorrência de "criar" — inclusive dentro de uma PERGUNTA
 * sobre se valeria a pena criar.
 *
 * Aqui a intenção é classificada ANTES de qualquer ferramenta de escrita, de
 * forma determinística. Só ACTION_REQUEST e AUTONOMOUS_ACTION autorizam write.
 * O resto é leitura, por mais que o texto contenha a palavra "criar".
 *
 * A distinção que faz o trabalho: VERBO NO IMPERATIVO é ordem ("crie uma
 * task"); VERBO NO INFINITIVO depois de modal é deliberação ("me diga se
 * devemos criar uma task"). Português dá esse sinal de graça e ele não depende
 * de o modelo estar num dia bom.
 */

export type ActionIntentClass =
  | 'READ_ONLY'
  | 'ANALYSIS'
  | 'SUGGESTION'
  | 'PLANNING'
  | 'ACTION_REQUEST'
  | 'AUTONOMOUS_ACTION';

export interface ActionIntent {
  kind: ActionIntentClass;
  /** Só true para ACTION_REQUEST e AUTONOMOUS_ACTION. */
  writeAuthorized: boolean;
  /** Motivo legível — vai pro trace (write_reason). */
  reason: string;
  /** O pedido também pede análise antes de agir? */
  requiresAnalysisFirst: boolean;
}

function dobra(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Ordem direta de escrita. */
const IMPERATIVO = /\b(crie|cria|criem|adicione|adiciona|abre|abra|cadastre|cadastra|registre|registra|atribua|atribui|designe|designa|delega|delegue|mude|muda|altere|altera|reagende|reagenda|marque|marca|conclua|conclui|finalize|finaliza|feche|fecha|anexe|anexa|comente|comenta)\b/;
/** Mesma ação, mas no infinitivo: sozinho não é ordem. */
const INFINITIVO = /\b(criar|adicionar|abrir|cadastrar|registrar|atribuir|designar|delegar|mudar|alterar|reagendar|marcar|concluir|finalizar|fechar|anexar|comentar)\b/;
/** Modal/deliberação: transforma o infinitivo em pergunta, não em ordem. */
const MODAL = /\b(devemos|deveria|deveriamos|podemos|poderia|poderiamos|precisamos|precisa|precisaria|vale a pena|seria bom|seria melhor|faz sentido|acha que|acham que|quer que eu|posso|dever[ií]amos|sera que|tem que|teria que)\b/;
/** Pedido explícito de análise/opinião. */
const ANALISE = /\b(analis[ae]|analisar|analise|avali[ae]|avaliar|revis[ae] (isso|essas|esses|as|os)|revisar|diagnostic|o que voce acha|o que voces acham|me diga|me diz|me fala|sua opiniao|da uma olhada|de uma olhada|olha isso|veja isso|ve isso|checa|confere|conferir|comparar|compara)\b/;
/** Pedido de plano/recomendação sem execução. */
const PLANEJAMENTO = /\b(monte um plano|plano de acao|como deveriamos|qual a melhor forma|sugere|sugira|sugestao|recomenda|recomende|recomendacao|o que priorizar|por onde comecar)\b/;
/** Autonomia: só quando a pessoa manda resolver/executar. */
const AUTONOMIA = /\b(resolv[ae]|resolver|execut[ae]|executar|organize e execute|cuide|cuida|faca o que|faz o que|automaticamente|sozinh[oa]|corrija automaticamente|toma conta)\b/;

/**
 * Classifica a intenção do turno. Determinístico: mesma frase, mesma classe.
 */
export function classifyActionIntent(message: string): ActionIntent {
  // Só o turno do usuário: o bloco de contexto do Orchestrator vem depois do
  // marcador e traz texto de terceiros que não é pedido de ninguém.
  const turno = (message.split(/\n-{3,}\n/)[0] ?? message).split(/\n\s*\n/)[0] ?? message;
  // Trecho entre aspas é NOME (da task, da campanha), não instrução: sem
  // tirar isso, `crie a task "Revisar peças"` virava "pedido de análise"
  // por causa da palavra dentro do nome.
  const semNomes = turno.replace(/["“'][^"”']{3,80}["”']/g, ' ');
  const flat = dobra(semNomes);

  const temImperativo = IMPERATIVO.test(flat);
  const temInfinitivo = INFINITIVO.test(flat);
  const temModal = MODAL.test(flat);
  const temAnalise = ANALISE.test(flat);
  const temPlanejamento = PLANEJAMENTO.test(flat);
  const temAutonomia = AUTONOMIA.test(flat);

  if (temAutonomia && (temImperativo || /\boperacao\b|\bdemanda\b|\bfila\b/.test(flat))) {
    return {
      kind: 'AUTONOMOUS_ACTION',
      writeAuthorized: true,
      reason: 'usuário pediu explicitamente para resolver/executar',
      requiresAnalysisFirst: true,
    };
  }

  // Deliberação vence ordem: "me diga se devemos criar uma task" NÃO cria
  // nada, mesmo contendo a palavra "criar". Mas a deliberação precisa ser
  // sobre uma ESCRITA — "o que precisa mudar" fala das peças, não de criar
  // task, e continua sendo análise.
  const OBJETO_DE_ESCRITA = /\b(task|tarefa|card|comentario|anexo|prazo|responsavel|status)\b/;
  if (temModal && temInfinitivo && !temImperativo && OBJETO_DE_ESCRITA.test(flat)) {
    return {
      kind: 'SUGGESTION',
      writeAuthorized: false,
      reason: 'pergunta se a ação deve ser feita (infinitivo após modal), não é ordem de execução',
      requiresAnalysisFirst: temAnalise,
    };
  }

  if (temImperativo) {
    return {
      kind: 'ACTION_REQUEST',
      writeAuthorized: true,
      reason: temAnalise ? 'ação pedida no imperativo, precedida de análise' : 'ação pedida no imperativo',
      requiresAnalysisFirst: temAnalise,
    };
  }

  if (temAnalise) {
    return {
      kind: 'ANALYSIS',
      writeAuthorized: false,
      reason: 'pedido de análise/opinião sem ordem de execução',
      requiresAnalysisFirst: true,
    };
  }

  if (temPlanejamento) {
    return {
      kind: 'PLANNING',
      writeAuthorized: false,
      reason: 'pedido de plano/recomendação sem ordem de execução',
      requiresAnalysisFirst: true,
    };
  }

  return {
    kind: 'READ_ONLY',
    writeAuthorized: false,
    reason: 'pergunta ou conversa sem intenção de escrita',
    requiresAnalysisFirst: false,
  };
}
