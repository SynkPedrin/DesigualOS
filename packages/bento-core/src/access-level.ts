/**
 * access-level.ts — a pergunta certa antes de agir.
 *
 * O guard e o planner decidiam intenção pelo VERBO. Medido em 29/09/2026,
 * com as duas pontas erradas ao mesmo tempo:
 *
 *   "Faça um briefing executivo completo da agência."
 *      guard  → verbo_despacho (porque `faça` está em VERBO_DESPACHO_MUTAVEL_RE
 *               e `briefing` está em CAMPO_DE_TASK_RE) → escrita bloqueada
 *      planner → create_task ("criar uma nova task para elaborar o briefing")
 *      resposta ao usuário → "Não tenho autorização de escrita para esse cliente."
 *
 *   "Reatribua todas para a Tammy."
 *      classifyActionIntentV2 → ANALYZE, writeAuthorized=false
 *
 * Uma pergunta recusada como mutação; uma mutação lida como pergunta. A causa
 * é a mesma nas duas: ninguém olha o OBJETO do pedido.
 *
 * A regra desta casa passa a ser a pergunta que interessa:
 *
 *      o pedido MODIFICA um sistema externo?
 *
 * e não:
 *
 *      a frase contém "faça"?
 *
 * O objeto é o que decide. "Faça um BRIEFING" produz texto para uma pessoa
 * ler; "Faça uma TASK" muda o ClickUp. Mesmo verbo, naturezas opostas.
 *
 * ── O QUE ESTE MÓDULO PODE E NÃO PODE ──────────────────────────────────
 *
 * Ele ABRE leitura e NUNCA autoriza escrita. `WRITE` aqui significa apenas
 * "não pegue o atalho de leitura" — quem autoriza a mutação continua sendo a
 * policy (`validateBentoAction`), o write-scope e o kill switch externo, sem
 * nenhuma alteração. Um falso `WRITE` custa o comportamento de hoje; um falso
 * `READ` numa frase de mutação custaria uma task errada na conta de um
 * cliente. Por isso, na dúvida, devolve `INDEFINIDO` e a máquina existente
 * decide como sempre decidiu.
 */

export type NivelDeAcesso =
  /** Pedido de conhecimento: consulta o que o usuário já pode ver, não muda nada. */
  | 'READ'
  /** Pergunta o que DEVERIA ser feito. Lê à vontade, propõe, nunca executa. */
  | 'PROPOSE'
  /** Pode modificar sistema externo. Segue para a máquina de escrita, intocada. */
  | 'WRITE'
  /** Não deu pra decidir com segurança. Comportamento de hoje, sem atalho. */
  | 'INDEFINIDO';

export interface ClassificacaoDeAcesso {
  nivel: NivelDeAcesso;
  /** O que o pedido produz. É isto que separa "faça um briefing" de "faça uma task". */
  objeto: 'texto' | 'recurso' | 'indefinido';
  /** Legível, para log e para o trace. */
  motivo: string;
  sinais: string[];
}

function dobrar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * ENTREGÁVEL DE TEXTO: o que se pede a um analista, não a um sistema. O
 * resultado é prosa para alguém ler.
 *
 * `briefing`, `status` e `descricao` aparecem também como CAMPO de task — a
 * ambiguidade é real e é resolvida pela ausência de recurso na frase (ver
 * `RECURSO_RE`), nunca por esta lista sozinha.
 */
const ENTREGAVEL_DE_TEXTO_RE =
  /\b(briefing|brief|panorama|resumo|sumario|relatorio|analise|diagnostico|avaliacao|explicacao|leitura executiva|visao geral|overview|balanco|apanhado|retrospectiva|parecer|recomendacao|ata|report)\b/;

/**
 * RECURSO DO CLICKUP citado na frase, incluindo referente ("essa", "dela").
 * Presença aqui NÃO significa escrita — "quais tasks estão atrasadas?" cita
 * recurso e é pergunta. Significa só que a frase fala de um objeto do sistema,
 * e aí o atalho de "isto é texto puro" não vale.
 */
const RECURSO_RE =
  /\b(task|tasks|tarefa|tarefas|demanda|demandas|card|cards|subtarefa|subtask|checklist|coluna|lista|comentario|comentarios|anexo|anexos)\b/;

const REFERENTE_RE =
  /\b(essa|esse|esta|este|isso|isto|aquela|aquele|aquilo|ela|ele|elas|eles|dela|dele|delas|deles|nela|nele|nessa|nesse|nisso|disso|naquela|naquele|naquilo|mesma|mesmo)\b|\bacabou de\b|\bacabamos de\b/;

/**
 * VERBO DE MUTAÇÃO INEQUÍVOCO: não existe leitura que use estes. Separado dos
 * verbos de despacho (`faz`, `coloca`, `bota`, `põe`) exatamente porque estes
 * últimos dependem do objeto — e era essa dependência que faltava.
 */
const VERBO_MUTACAO_RE =
  /\b(cri(a|e|ar|em)|adicion[a-z]*|acrescent[a-z]*|increment[a-z]*|inclu[a-z]*|atualiz[a-z]*|altera?[a-z]*|edit[a-z]*|modific[a-z]*|corrig[a-z]*|renomei[a-z]*|apag[a-z]*|delet[a-z]*|exclu[a-z]*|remov[a-z]*|arquiv[a-z]*|reatribu[a-z]*|atribu[a-z]*|delegu?[a-z]*|design[a-z]*|reagend[a-z]*|remarc[a-z]*|adi[a-z]*|antecip[a-z]*|conclu[a-z]*|finaliz[a-z]*|fech[a-z]*|reabr[a-z]*|move?[a-z]*|mover|anex[a-z]*|coment[a-z]*|marc(a|ar|ue|que)|prioriz[a-z]*)\b/;

/**
 * VERBO DE DESPACHO: ambíguo por natureza. Só é mutação quando o objeto é
 * recurso. É a família que continha `faça` e que derrubava o briefing.
 */
const VERBO_DESPACHO_RE = /\b(faz|faca|fazer|coloc[a-z]*|coloqu[a-z]*|bot(a|e|ar)|po(e|em)|ponha|tir(a|e|ar)|pass(a|e|ar)|jog(a|e|ar)|lanc(a|e|ar)|mand(a|e|ar)|monta?[a-z]*|prepar[a-z]*|gera?[a-z]*|escrev[a-z]*|elabor[a-z]*|entreg[a-z]*|traz[a-z]*|traga|da|de|me da|me de)\b/;

/** Pergunta de verdade, pela forma. */
/**
 * `como` só conta como pergunta no INÍCIO da frase ou depois de pontuação.
 * "Agora me coloque como responsável nessa tarefa" usa `como` de preposição, e
 * lê-lo como interrogativa transformava uma atribuição de responsável em
 * leitura (regressão pega pela suíte da Tammy, 28/09).
 */
const INTERROGATIVA_RE =
  /\?|(^|[?.!;,]\s*)como\b|\b(o que|oque|qual|quais|quem|quando|onde|por que|porque|quanto|quantas|quantos)\b/;

/** Pedido de conhecimento dirigido ao agente ("me fala", "me explica", "quero saber"). */
const PEDIDO_DE_CONHECIMENTO_RE =
  /\b(me (fal[ae]|diga?|dig[ao]|explic[ao]|conta?|mostr[ae]|atualiz[ae]|informe?|list[ae]|resum[ao]|entregue?|de um|da um)|quero saber|gostaria de saber|preciso saber|o que voce sabe|tudo que voce sabe|me poe a par)\b/;

/**
 * DELIBERATIVO: pergunta o que DEVERIA acontecer. Não é ordem — é consulta com
 * recomendação. "Me diga quais tasks deveriam ser reatribuídas" cita recurso e
 * verbo de mutação, e mesmo assim não manda fazer nada.
 */
const DELIBERATIVO_RE =
  /\b(deveri[a-z]*|devia|precisari[a-z]*|valeria|vale a pena|faria sentido|o que voce (faria|sugere|recomenda|acha)|sugir[a-z]*|sugest[a-z]*|recomend[a-z]*|seria bom|melhor seria|faz sentido|poderi[a-z]*)\b/;

/** Negação/hipótese: "não cria ainda", "se eu criasse". Nunca é ordem. */
const NAO_EXECUTAVEL_RE = /\b(nao|nem|sem|jamais|nunca)\s+(me\s+)?\w*\s*(cri|altera|atualiz|apag|delet|mexe|toque|faca|mude)/;

/**
 * Classifica o nível de acesso que o pedido exige.
 *
 * Determinístico e sem rede: é regra de negócio, tem que ser reproduzível e
 * testável frase a frase. A ordem das checagens é a própria política.
 */
export function classificarAcesso(message: string): ClassificacaoDeAcesso {
  const texto = dobrar((message ?? '').trim());
  if (texto.length === 0) {
    return { nivel: 'INDEFINIDO', objeto: 'indefinido', motivo: 'mensagem vazia', sinais: [] };
  }

  const sinais: string[] = [];
  const citaRecurso = RECURSO_RE.test(texto);
  const citaReferente = REFERENTE_RE.test(texto);
  const temEntregavel = ENTREGAVEL_DE_TEXTO_RE.test(texto);
  const temMutacao = VERBO_MUTACAO_RE.test(texto);
  const temDespacho = VERBO_DESPACHO_RE.test(texto);
  const pergunta = INTERROGATIVA_RE.test(texto);
  const pedeConhecimento = PEDIDO_DE_CONHECIMENTO_RE.test(texto);
  const deliberativo = DELIBERATIVO_RE.test(texto);

  if (citaRecurso) sinais.push('recurso');
  if (citaReferente) sinais.push('referente');
  if (temEntregavel) sinais.push('entregavel_de_texto');
  if (temMutacao) sinais.push('verbo_mutacao');
  if (temDespacho) sinais.push('verbo_despacho');
  if (pergunta) sinais.push('interrogativa');
  if (pedeConhecimento) sinais.push('pedido_de_conhecimento');
  if (deliberativo) sinais.push('deliberativo');

  // 1. Negação/hipótese nunca ordena. Sai antes de tudo: "não cria a task
  //    ainda" tem verbo de mutação E recurso, e mesmo assim não é escrita.
  if (NAO_EXECUTAVEL_RE.test(texto)) {
    return {
      nivel: 'INDEFINIDO',
      objeto: 'indefinido',
      motivo: 'negação ou hipótese sobre a ação — nunca é ordem; segue para a máquina de sempre',
      sinais: [...sinais, 'nao_executavel'],
    };
  }

  // 2. DELIBERATIVO vence a mutação. "quais tasks deveriam ser reatribuídas"
  //    tem `reatribu` e `tasks` e ainda assim não manda reatribuir nada.
  if (deliberativo) {
    return {
      nivel: 'PROPOSE',
      objeto: citaRecurso || citaReferente ? 'recurso' : 'texto',
      motivo: 'pergunta o que DEVERIA ser feito: lê tudo, propõe, não executa',
      sinais,
    };
  }

  // 3. ENTREGÁVEL DE TEXTO SEM RECURSO — o caso que estava quebrado.
  //    "Faça um briefing executivo completo da agência": objeto é o briefing,
  //    não existe task nenhuma na frase, e portanto não existe o que mutar.
  //    O `!temMutacao` é o que separa "faça um briefing" (despacho ambíguo,
  //    objeto é texto) de "incrementa o briefing" / "adiciona isso no
  //    briefing" (verbo inequívoco de mutação sobre o CAMPO briefing de uma
  //    task em foco). Sem ele, as duas frases viravam leitura — regressão
  //    pega pela matriz do guard (B.4).
  if (temEntregavel && !temMutacao && !citaRecurso && !citaReferente) {
    return {
      nivel: 'READ',
      objeto: 'texto',
      motivo: 'pede um entregável de texto, sem verbo de mutação e sem recurso do ClickUp — não há o que modificar',
      sinais,
    };
  }

  // 4. MUTAÇÃO INEQUÍVOCA sobre recurso (ou referente) → caminho de escrita,
  //    exatamente como hoje. Este ramo não autoriza nada: só recusa o atalho.
  if (temMutacao && (citaRecurso || citaReferente)) {
    return {
      nivel: 'WRITE',
      objeto: 'recurso',
      motivo: 'verbo de mutação sobre recurso do ClickUp — segue para a policy de escrita',
      sinais,
    };
  }

  // 5. PEDIDO DIRIGIDO AO FALANTE, sem recurso na frase: "me atualiza aí",
  //    "me fala da agência". O verbo é de mutação (`atualiz`), mas o objeto
  //    é A PESSOA — quem é atualizado é quem pergunta, não uma task. Só vale
  //    sem recurso e sem referente: "me atualiza sobre essa task" volta a ser
  //    ambíguo e segue o caminho de sempre.
  if (pedeConhecimento && !citaRecurso && !citaReferente) {
    return {
      nivel: 'READ',
      objeto: 'texto',
      motivo: 'pedido de conhecimento dirigido a quem pergunta, sem nenhum recurso do ClickUp na frase',
      sinais: [...sinais, 'objeto_e_a_pessoa'],
    };
  }

  // 6. PERGUNTA PURA, mesmo citando recurso. "Quais tasks estão atrasadas?"
  //    cita recurso e não muda nada. O que impede o atalho aqui é a ausência
  //    de qualquer verbo capaz de mutar.
  if ((pergunta || pedeConhecimento) && !temMutacao && !temDespacho) {
    return {
      nivel: 'READ',
      objeto: citaRecurso ? 'recurso' : 'texto',
      motivo: 'pergunta ou pedido de conhecimento sem nenhum verbo capaz de modificar',
      sinais,
    };
  }

  // 7. DESPACHO + PERGUNTA/CONHECIMENTO, sem recurso: "me dá um panorama",
  //    "monta pra mim o que está pegando". Verbo ambíguo, objeto não é recurso.
  if (temDespacho && !temMutacao && !citaRecurso && !citaReferente && (pergunta || pedeConhecimento || temEntregavel)) {
    return {
      nivel: 'READ',
      objeto: 'texto',
      motivo: 'verbo de despacho sobre objeto que não é recurso do ClickUp',
      sinais,
    };
  }

  // 8. Mutação sem objeto identificado, ou despacho com recurso: ambíguo de
  //    verdade. Comportamento de hoje, sem atalho e sem afrouxamento.
  return {
    nivel: 'INDEFINIDO',
    objeto: citaRecurso || citaReferente ? 'recurso' : 'indefinido',
    motivo: 'não deu pra decidir pelo objeto; mantém o caminho atual',
    sinais,
  };
}

/**
 * Atalho de leitura: o pedido é PROVADAMENTE de conhecimento?
 *
 * É o predicado que o caminho de escrita consulta para se abster. `PROPOSE`
 * entra junto de propósito: propor exige ler tudo e não executa nada.
 */
export function ehPedidoDeLeitura(message: string): boolean {
  const n = classificarAcesso(message).nivel;
  return n === 'READ' || n === 'PROPOSE';
}
