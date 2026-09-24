import type { AgentName } from '@desigual-os/types';

/**
 * small-talk.ts — fast path para saudação e cortesia.
 *
 * "Oi, tudo bem?" era roteado pro RAG do Bento e voltava
 * "Achei material relacionado, mas não consegui montar uma resposta com fonte
 * confiável. Registrei para revisão da curadoria." — resposta de sistema de
 * busca para uma frase que não é pergunta (medido no release gate, 15/09/2026).
 *
 * Saudação não tem fato pra ancorar: chamar retrieval, evidência e grounding
 * aqui é caro e produz exatamente esse tipo de resposta errada. O corte é
 * determinístico e DELIBERADAMENTE estreito — só pega frase curta que é
 * cortesia pura. Qualquer coisa com pergunta real de trabalho segue o caminho
 * normal, com evidência.
 */

const FIM = '(?=$|[\\s,.!?;:])';
const SAUDACAO = new RegExp(`^(oi+|ol[áa]|e a[íi]|opa|fala|bom dia|boa tarde|boa noite|hey|hi|hello)${FIM}`, 'i');
const CORTESIA = new RegExp(`^(obrigad[oa]|valeu|vlw|show|beleza|blz|perfeito|ok|okay|entendi|massa|top|legal|bacana|isso|certo)${FIM}`, 'i');
const TUDO_BEM = new RegExp(`^(tudo bem|tudo bom|como vai|como voc[êe] est[áa]|td bem|td bom)${FIM}`, 'i');

/** Sinal de que NÃO é small talk, por mais curta que a frase seja. */
const TEM_TRABALHO =
  /(tasks?|tarefas?|prazos?|clientes?|campanhas?|posts?|copy|briefings?|reels|carross[eé]is?|carrossel|clickup|relat[óo]rios?|m[ée]tricas?|or[çc]amentos?|status|entregas?|aprova|atrasad|vencem?|prioriz|organiz|fato|hip[óo]tese|fonte|tirou|comparad|per[íi]odo|dados?|de onde|veio de)/i;

export interface SmallTalk {
  kind: 'saudacao' | 'cortesia' | 'tudo_bem';
  answer: string;
}

const RESPOSTAS: Record<AgentName | 'default', Record<SmallTalk['kind'], string>> = {
  bento: {
    saudacao: 'Oi! Tô por aqui. Me diz o que você precisa da operação que eu puxo.',
    cortesia: 'Tamo junto. Se precisar de mais alguma coisa da operação, é só chamar.',
    tudo_bem: 'Tudo certo por aqui. E aí, o que você precisa hoje?',
  },
  otto: {
    saudacao: 'Oi! Bora criar. Me conta o cliente e o que você precisa.',
    cortesia: 'Valeu! Quando quiser a próxima peça, é só chamar.',
    tudo_bem: 'Tudo ótimo. Qual cliente a gente ataca agora?',
  },
  jarbas: {
    saudacao: 'Oi! Me diz de qual cliente você quer os números.',
    cortesia: 'De nada. Quando quiser outro recorte de performance, é só pedir.',
    tudo_bem: 'Tudo certo. Quer que eu puxe performance de algum cliente?',
  },
  suzy: {
    saudacao: 'Oi! Como posso ajudar?',
    cortesia: 'Imagina! Precisando, estou aqui.',
    tudo_bem: 'Tudo bem por aqui. O que você precisa?',
  },
  studio: {
    saudacao: 'Oi! Me manda o que você quer produzir.',
    cortesia: 'Tranquilo. É só mandar o próximo job.',
    tudo_bem: 'Tudo certo. O que vamos produzir?',
  },
  default: {
    saudacao: 'Oi! Como posso ajudar?',
    cortesia: 'Tranquilo! Se precisar de mais alguma coisa, é só chamar.',
    tudo_bem: 'Tudo bem por aqui. O que você precisa?',
  },
};

/**
 * Detecta small talk puro. `null` = segue o caminho normal (com evidência).
 * Limite de tamanho: cortesia é curta; texto longo quase sempre carrega pedido
 * junto ("oi, me vê as tarefas de hoje") e ESSE não pode pular o retrieval.
 */
/**
 * O turno do USUÁRIO, sem o bloco de contexto que o Orchestrator anexa
 * depois do marcador "---". Sem este corte, "Bom dia" chegava aqui com
 * centenas de caracteres de contexto colado e estourava o limite de
 * tamanho — o fast path só pegava as mensagens que por acaso vinham sem
 * contexto (medido ao vivo: "Oi, tudo bem?" entrava, "Bom dia" não).
 */
function turnoDoUsuario(message: string): string | null {
  const paragrafos = message.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const primeiro = paragrafos[0];
  if (!primeiro) return null;
  // O resto só pode ser bloco anexado pelo Orchestrator. Se houver mais
  // conteúdo do usuário, NÃO é small talk — "oi" seguido de um pedido real
  // precisa do caminho com evidência.
  const resto = paragrafos.slice(1);
  const soContexto = resto.every((p) => /^-{3,}/.test(p) || /^contexto\s*:/i.test(p));
  if (!soContexto) return null;
  return primeiro.split(/\n-{3,}\n/)[0]?.trim() ?? primeiro;
}

export function detectSmallTalk(message: string, agent: AgentName): SmallTalk | null {
  const texto = turnoDoUsuario(message);
  if (texto === null) return null;
  if (texto.length > 40) return null;
  if (TEM_TRABALHO.test(texto)) return null;

  // Mais de uma frase com conteúdo também sai do fast path.
  const semPontuacao = texto.replace(/[!?.,;:]+$/g, '').trim();
  if (semPontuacao.split(/[.?!]\s+/).length > 2) return null;

  const kind: SmallTalk['kind'] | null = TUDO_BEM.test(semPontuacao)
    ? 'tudo_bem'
    : SAUDACAO.test(semPontuacao)
      ? 'saudacao'
      : CORTESIA.test(semPontuacao)
        ? 'cortesia'
        : null;
  if (!kind) return null;

  // "oi, tudo bem?" cai como saudação + tudo bem: prioriza a pergunta.
  const efetivo: SmallTalk['kind'] = /tudo (bem|bom)/i.test(semPontuacao) ? 'tudo_bem' : kind;
  const tabela = RESPOSTAS[agent] ?? RESPOSTAS.default;
  return { kind: efetivo, answer: tabela[efetivo] };
}
