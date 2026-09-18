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
  | 'AUTONOMOUS_ACTION'
  /** Concluir/fechar trabalho HUMANO. O Bento nunca faz; a resposta explica. */
  | 'FORBIDDEN_ACTION';

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

/**
 * TIER 1 — ordem de escrita INEQUÍVOCA. O verbo sozinho já é a ordem: quem
 * escreve "cria" não está perguntando nada.
 */
const IMPERATIVO = /\b(crie|cria|criem|adicione|adiciona|abre|abra|cadastre|cadastra|registre|registra|atribua|atribui|designe|designa|delega|delegue|mude|muda|altere|altera|reagende|reagenda|marque|marca|conclua|conclui|finalize|finaliza|feche|fecha|anexe|anexa|comente|comenta)\b/;

/**
 * TIER 2 — como a operação FALA de verdade. "separa a demanda", "lança pro
 * Gui", "joga na lista da D Carvalho", "coloca isso no ClickUp", "faz o
 * briefing". Nenhum destes verbos estava no classificador, e por isso todo
 * pedido real da Tammy caía em READ_ONLY: o guard devolvia null e o turno ia
 * pro caminho de análise — o agente lia, opinava e não escrevia nada.
 *
 * Estes verbos NÃO valem sozinhos, de propósito: "me faz uma análise" tem
 * "faz" e não é ordem de escrita. Só contam com um ALVO operacional
 * (task/demanda/briefing/lista/ClickUp/layout...) ou um DESTINO de pessoa
 * ("pro Gui") por perto. É a diferença entre despachar trabalho e conversar.
 */
const DESPACHO = /\b(lanc[ae]|lancem|joga|jogue|manda|mande|passa|passe|coloca|coloque|poe|ponha|separa|separe|divide|divida|quebra|quebre|deixa|deixe|sobe|suba|monta|monte|faz|faca|distribui|distribua|encaminha|encaminhe)\b/;

/**
 * O que o verbo de despacho precisa estar tocando pra virar ordem de escrita.
 * Inclui o ENTREGÁVEL (layout, texto, arte) porque é assim que a demanda é
 * nomeada antes de existir task: "lance pro Gui a criação do layout".
 */
const ALVO_OPERACIONAL = /\b(task|tasks|tarefa|tarefas|demanda|demandas|card|cards|briefing|brief|clickup|lista|layout|layouts|copy|texto|textos|arte|artes|pe[cç]a|pe[cç]as|video|videos|reels|stories|post|posts|carrossel|campanha|placa|placas|entrega|entregas)\b/;

/**
 * Destino nomeado, lido no texto COM CAIXA: "pro Gui", "pra Sofia", "com o
 * Matheus", "na D Carvalho". A maiúscula é o sinal barato que separa nome
 * próprio de preposição solta, e evita casar "passa pra frente". A segunda
 * alternativa existe pra inicial solta seguida de sobrenome — "D Carvalho" e
 * "D. Carvalho" é como a operação escreve esse cliente.
 */
const DESTINO_NOMEADO =
  /\b(?:pro|pra|para|ao|à|a|com|do|da|dos|das|n[ao])\s+(?:o\s+|a\s+)?[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ](?:[a-záàâãéêíóôõúç]+|\.?\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)/;

/**
 * Atribuição DECLARATIVA: a frase não tem verbo no imperativo, mas define dono.
 * "essa parte fica com a Sofia", "essa demanda é do Matheus", "o texto fica
 * pra Sofia". Para a pessoa que fala, isto é uma ordem; para o classificador
 * antigo, era conversa.
 */
const ATRIBUICAO_DECLARATIVA =
  /\b(?:essa|esse|esta|este|a demanda|a task|a tarefa|o layout|o texto|a arte|a copy|a parte|a peca)\b[^.;\n]{0,40}?(?:(?:fica|ficam|vai)\s+(?:com|pro|pra|para)|(?:e|sera|serao)\s+(?:do|da|de))\s+/;

/** Mesma ação, mas no infinitivo: sozinho não é ordem. */
const INFINITIVO = /\b(criar|adicionar|abrir|cadastrar|registrar|atribuir|designar|delegar|mudar|alterar|reagendar|marcar|concluir|finalizar|fechar|anexar|comentar|lancar|separar|dividir)\b/;
/** Modal/deliberação: transforma o infinitivo em pergunta, não em ordem. */
const MODAL = /\b(devemos|deveria|deveriamos|podemos|poderia|poderiamos|precisamos|precisa|precisaria|vale a pena|seria bom|seria melhor|faz sentido|acha que|acham que|quer que eu|posso|dever[ií]amos|sera que|tem que|teria que)\b/;
/** Pedido explícito de análise/opinião. */
const ANALISE = /\b(analis[ae]|analisar|analise|avali[ae]|avaliar|revis[ae] (isso|essas|esses|as|os)|revisar|diagnostic|o que voce acha|o que voces acham|me diga|me diz|me fala|sua opiniao|da uma olhada|de uma olhada|olha isso|veja isso|ve isso|checa|confere|conferir|comparar|compara)\b/;
/** Pedido de plano/recomendação sem execução. */
const PLANEJAMENTO = /\b(monte um plano|plano de acao|como deveriamos|qual a melhor forma|sugere|sugira|sugestao|recomenda|recomende|recomendacao|o que priorizar|por onde comecar)\b/;
/** Autonomia: só quando a pessoa manda resolver/executar. */
const AUTONOMIA = /\b(resolv[ae]|resolver|execut[ae]|executar|organize e execute|cuide|cuida|faca o que|faz o que|automaticamente|sozinh[oa]|corrija automaticamente|toma conta)\b/;

/**
 * HARD DENY (boundary do Bento): concluir, fechar ou dar como resolvido o
 * trabalho de uma PESSOA. Não é uma questão de permissão configurável — um
 * agente dizer que o designer terminou o layout é falsificar o estado da
 * operação, e quem confia nesse status planeja o dia errado.
 *
 * Só dispara sobre a CONCLUSÃO. "marca como urgente" e "marca o prazo" não
 * são isto, e continuam sendo escrita normal.
 */
const CONCLUSAO_HUMANA =
  /\b(?:marc(?:a|ar|que)[^.;\n]{0,30}\b(?:conclu|pronto|prontos|feito|finalizad|entregue|resolvid)|d(?:a|ar|e)\s+como\s+(?:conclu|pronto|feito|entregue)|conclu(?:i|a|ir|ida|ido)\b|finaliz(?:a|ar|e)\b|fech(?:a|ar|e)\b[^.;\n]{0,25}\b(?:task|tarefa|demanda|card|chamado)|encerr(?:a|ar|e)\b[^.;\n]{0,25}\b(?:task|tarefa|demanda))/;

/**
 * ONDE ESTÁ A ORDEM dentro do turno.
 *
 * O classificador lia só o PRIMEIRO parágrafo. A suposição — "o pedido vem
 * primeiro" — quebra exatamente no jeito como a operação trabalha: a pessoa
 * cola a solicitação do cliente e escreve a ordem DEPOIS. No caso real de
 * 17/09/2026 o primeiro parágrafo era o texto do cliente sobre placas, e a
 * ordem ("Bento, ... separe a demanda e lance pro Gui ... na lista da D
 * Carvalho") estava no último. Resultado: READ_ONLY, guard devolvia null, e o
 * turno virava análise — três vezes seguidas, sem nenhuma task criada.
 *
 * A regra: quando algum parágrafo ENDEREÇA o agente pelo nome, são esses os
 * parágrafos que carregam a instrução — o resto é material colado. Sem
 * endereçamento, vale o turno inteiro, que é a leitura honesta de quem
 * escreveu tudo pra você.
 */
const ENDERECA_AGENTE = /\b(bento|otto|jarbas|suzy)\b/i;

export function trechoDeInstrucao(turno: string): string {
  const paragrafos = turno.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  if (paragrafos.length <= 1) return turno;
  const enderecados = paragrafos.filter((p) => ENDERECA_AGENTE.test(p));
  return enderecados.length > 0 ? enderecados.join('\n') : turno;
}

/**
 * Classifica a intenção do turno. Determinístico: mesma frase, mesma classe.
 */
export function classifyActionIntent(message: string): ActionIntent {
  // Só o turno do usuário: o bloco de contexto do Orchestrator vem depois do
  // marcador e traz texto de terceiros que não é pedido de ninguém.
  const turno = message.split(/\n-{3,}\n/)[0] ?? message;
  const instrucao = trechoDeInstrucao(turno);
  // Trecho entre aspas é NOME (da task, da campanha), não instrução: sem
  // tirar isso, `crie a task "Revisar peças"` virava "pedido de análise"
  // por causa da palavra dentro do nome.
  const semNomes = instrucao.replace(/["“'][^"”']{3,80}["”']/g, ' ');
  const flat = dobra(semNomes);

  const temImperativo = IMPERATIVO.test(flat);
  // O despacho precisa estar APONTANDO pra alguma coisa. `DESTINO_PESSOA` lê o
  // texto com caixa original de propósito: é a maiúscula que distingue "pro
  // Gui" de "pra frente".
  const temDespacho = DESPACHO.test(flat) && (ALVO_OPERACIONAL.test(flat) || DESTINO_NOMEADO.test(semNomes));
  const temAtribuicao = ATRIBUICAO_DECLARATIVA.test(flat) && DESTINO_NOMEADO.test(semNomes);
  const temOrdem = temImperativo || temDespacho || temAtribuicao;
  const temInfinitivo = INFINITIVO.test(flat);
  const temModal = MODAL.test(flat);
  const temAnalise = ANALISE.test(flat);
  const temPlanejamento = PLANEJAMENTO.test(flat);
  const temAutonomia = AUTONOMIA.test(flat);

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

  // HARD DENY antes de qualquer autorização. Vem depois da deliberação porque
  // "devemos fechar essa task?" é uma PERGUNTA e merece resposta, não recusa.
  if (CONCLUSAO_HUMANA.test(flat)) {
    return {
      kind: 'FORBIDDEN_ACTION',
      writeAuthorized: false,
      reason: 'concluir/fechar trabalho humano está fora do que o Bento pode fazer',
      requiresAnalysisFirst: false,
    };
  }

  if (temAutonomia && (temOrdem || /\boperacao\b|\bdemanda\b|\bfila\b/.test(flat))) {
    return {
      kind: 'AUTONOMOUS_ACTION',
      writeAuthorized: true,
      reason: 'usuário pediu explicitamente para resolver/executar',
      requiresAnalysisFirst: true,
    };
  }

  if (temOrdem) {
    const comoFoiPedido = temImperativo
      ? 'ação pedida no imperativo'
      : temDespacho
        ? 'ordem operacional de despacho (separar/lançar/jogar/colocar) com alvo definido'
        : 'atribuição declarativa de responsável';
    return {
      kind: 'ACTION_REQUEST',
      writeAuthorized: true,
      reason: temAnalise ? `${comoFoiPedido}, precedida de análise` : comoFoiPedido,
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
