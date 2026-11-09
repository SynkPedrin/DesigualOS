import type { RegistroDeEvidencia } from './context-assembler';

/**
 * guarda-de-ausencia.ts — EVIDÊNCIA EXISTENTE NÃO PODE VIRAR AUSÊNCIA.
 *
 * Mesmo que o modelo erre. É essa a diferença entre este arquivo e mais uma
 * redação de prompt.
 *
 * O QUE ELE EXISTE PARA IMPEDIR, medido em 01/10/2026 com nove execuções da
 * MESMA pergunta ("Qual é o posicionamento da Cosentino?"), com o dossiê real
 * no prompt:
 *
 *   respondeu com o conhecimento:  2/9  (22%)
 *   afirmou que não havia dado:    5/9  (56%)
 *   roteador pediu esclarecimento: 2/9  (22%)
 *
 * O dossiê da Cosentino tem uma seção "## 2. POSICIONAMENTO" que começa
 * dizendo ser a mais bem definida da carteira. A informação estava no prompt
 * nas nove vezes. Em cinco delas o modelo disse que não existia.
 *
 * QUATRO TENTATIVAS DE CONSERTAR ISSO POR TEXTO FALHARAM — cada uma validada
 * por uma única amostra, o que não é medição, é sorte. A quarta piorou. Este
 * arquivo é a correção estrutural: a verificação não pede nada ao modelo, ela
 * CONFERE o que ele respondeu contra o que foi entregue a ele.
 *
 * ---
 *
 * A REGRA QUE GOVERNA O ARQUIVO:
 *
 *   ausência de CAMPO  ≠  evidência de ausência de FATO
 *
 * Um formulário sem posicionamento preenchido diz que o formulário está vazio.
 * Não diz que a empresa não tem posicionamento. Só é negativa de verdade a
 * afirmação EXPLÍCITA — "o cliente ainda não definiu o posicionamento" — e
 * essa vem no conteúdo da evidência, não da falta dela.
 *
 * SEM MODELO NA PRIMEIRA CAMADA. Tudo aqui é string normalizada e comparação
 * determinística: a checagem que decide se uma resposta pode ir ao usuário não
 * pode depender do mesmo tipo de componente que produziu o erro.
 */

/** Sem acento, minúscula, espaço normalizado. Toda comparação passa por aqui. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * AFIRMAÇÕES DE AUSÊNCIA em português.
 *
 * Reconhecem a forma "não tenho/não há/não existe X", e também as que o Bento
 * produziu de fato nas cinco falhas medidas: "o dado não traz", "está vazio",
 * "não consta", "[MISSING]".
 *
 * NÃO entram aqui negativas que são conteúdo legítimo da resposta — "a marca
 * não usa urgência", "não pode usar desconto". Elas negam um ATRIBUTO do
 * mundo, não a existência do registro. O recorte abaixo exige sempre um objeto
 * de informação ("dado", "informação", "registro", "fonte") ou um verbo de
 * posse/encontro na primeira pessoa.
 */
const PADROES_DE_AUSENCIA: RegExp[] = [
  /\bnao (tenho|temos|ha|havia|existe|existem|encontrei|encontramos|consta|constam|localizei) [^.]{0,40}\b(dado|dados|informacao|informacoes|registro|registros|fonte|fontes|conteudo)\b/,
  /\bnao (tenho|temos|ha|existe|existem|encontrei|encontramos|consta|localizei)\b(?![^.]{0,30}\b(urgencia|desconto|pressa|apelo)\b)/,
  /\bo dado nao (traz|informa|tem|possui|diz)\b/,
  /\bnao (foi|esta|estao|estava) (definido|definida|definidos|documentado|documentada|registrado|registrada|preenchido|preenchida)\b/,
  /\b(esta|estao) vazio(s)?\b/,
  /\bsem (informacao|informacoes|registro|registros|dado|dados) (sobre|a respeito|para)\b/,
  /\[missing\]/,
  /\bimpossivel responder\b/,
  /\bnao consegui (identificar|encontrar|localizar)\b(?![^.]{0,40}\bsozinho\b)/,
];

/** Os trechos da resposta que afirmam ausência. Vazio = nenhuma afirmação. */
export function trechosDeAusencia(resposta: string): string[] {
  const texto = normalizar(resposta);
  const achados: string[] = [];
  for (const re of PADROES_DE_AUSENCIA) {
    const m = re.exec(texto);
    if (m) achados.push(m[0].trim());
  }
  return achados;
}

/**
 * O TÓPICO DA PERGUNTA, por regra estrutural e não por lista de palavras.
 *
 * "Não use lista infinita de keywords" é requisito explícito do produto, e com
 * razão: corrigir `decisor`, depois `posicionamento`, depois `orçamento`, um a
 * um, é uma lista que nunca fecha.
 *
 * A regra: numa pergunta factual em português, o ATRIBUTO perguntado é o
 * substantivo que vem logo depois do pronome interrogativo e do artigo —
 * "qual é O POSICIONAMENTO da Cosentino", "quem é O DECISOR da Elite", "qual a
 * PRACA da 3Net". Tira-se o pronome, o verbo de ligação, o artigo e a cauda
 * ("da <cliente>"), e sobra o tópico.
 *
 * Palavras curtas e genéricas são descartadas: elas casariam com qualquer
 * dossiê e o guarda viraria sempre-verdadeiro, que é tão inútil quanto
 * sempre-falso.
 */
const ABERTURA_FACTUAL =
  /^\s*(?:me diga |me fala |pode dizer |sabe )?(?:qual|quais|quem|que|o que|onde|quando|como)\b(?:\s+(?:e|eh|sao|era|seria|foi|esta|estao))?\s*(?:o|a|os|as|um|uma)?\s*/;

/** Palavras que não identificam tópico nenhum. */
const VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'em', 'no', 'na',
  'para', 'pra', 'por', 'com', 'que', 'se', 'sobre', 'dele', 'dela', 'deles',
  'delas', 'esse', 'essa', 'este', 'esta', 'isso', 'nosso', 'nossa', 'seu',
  'sua', 'mais', 'muito', 'hoje', 'agora', 'cliente', 'empresa', 'conta',
  'sistema', 'ser', 'estar', 'ter', 'fazer', 'deve', 'pode',
]);

const TAMANHO_MINIMO_DO_TOPICO = 5;

export function topicosDaPergunta(pergunta: string): string[] {
  const texto = normalizar(pergunta).replace(/[?!.,;:]/g, ' ');
  if (!ABERTURA_FACTUAL.test(texto)) return [];

  const semAbertura = texto.replace(ABERTURA_FACTUAL, '');
  // Corta a cauda que nomeia a entidade: "... da Cosentino", "... do cliente X".
  const semEntidade = semAbertura.split(/\s+d[aeo]s?\s+/)[0] ?? semAbertura;

  return [...new Set(
    semEntidade
      .split(' ')
      .map((p) => p.trim())
      .filter((p) => p.length >= TAMANHO_MINIMO_DO_TOPICO && !VAZIAS.has(p)),
  )];
}

export interface CoberturaDeTopico {
  topico: string;
  coberto: boolean;
  /** De qual bloco veio a cobertura, para a proveniência por claim. */
  fonte: string | null;
  /** O trecho que cobre, para o fallback determinístico poder citá-lo. */
  trecho: string | null;
}

/** Quantos caracteres de contexto o fallback cita em volta do termo achado. */
const JANELA_DO_TRECHO = 400;

/**
 * O tópico está coberto por alguma evidência ENTREGUE AO MODELO?
 *
 * Confere contra `RegistroDeEvidencia`, que por construção é o texto como foi
 * entregue — já cortado pelo orçamento. Conferir contra o que foi RECUPERADO,
 * e não contra o que foi ENTREGUE, acusaria o modelo de ignorar algo que o
 * orçamento tinha cortado antes dele ver.
 */
export function coberturaDoTopico(topico: string, evidencias: readonly RegistroDeEvidencia[]): CoberturaDeTopico {
  /**
   * SÓ EVIDÊNCIA CITÁVEL COBRE O TÓPICO (09/11/2026). O histórico da conversa e o registro das execuções contêm a
   * própria PERGUNTA ("quais os endereços da DCS"): contavam como "o tópico está nas fontes", e o último recurso citava
   * a pergunta de volta para o Endrigo como se fosse a resposta. E os dados canônicos do cliente vêm antes de qualquer
   * outra fonte: são o fato validado.
   */
  const ordenadas = evidencias
    .filter((ev) => ev.citavel)
    .map((ev, i) => ({ ev, i, canonica: (ev.texto ?? '').includes('DADOS CANONICOS') }))
    .sort((a, b) => Number(b.canonica) - Number(a.canonica) || a.i - b.i)
    .map((x) => x.ev);
  for (const ev of ordenadas) {
    const trecho = linhasComOTopico(ev.texto ?? '', topico);
    if (!trecho) continue;
    return { topico, coberto: true, fonte: ev.sourceType || ev.fonte, trecho };
  }
  return { topico, coberto: false, fonte: null, trecho: null };
}

/**
 * O trecho em LINHAS INTEIRAS. Cortar por caractere entregava "ncias como..." e "Nahes Dias..." pela metade.
 *   - linha de RÓTULO do bloco ("[REGISTRO CRIATIVO (posicionamento, publico...)]") não conta: ela nomeia o tópico, não
 *     o responde;
 *   - termo num TÍTULO ("## 2. POSICIONAMENTO", "## Unidades"): a seção, até o próximo título;
 *   - termo numa linha comum: ela e as duas seguintes (onde costuma estar o dado).
 */
function linhasComOTopico(texto: string, topico: string): string | null {
  const linhas = texto.split('\n');
  const ehRotulo = (l: string) => /^\s*\[[^\]]*\]\s*$/.test(l);
  const ehTitulo = (l: string) => /^\s*#{1,6}\s/.test(l);
  const i = linhas.findIndex((l) => !ehRotulo(l) && normalizar(l).includes(topico));
  if (i < 0) return null;
  const limite = JANELA_DO_TRECHO * 2;
  let trecho = linhas[i]!;
  const seguintes = ehTitulo(linhas[i]!) ? linhas.slice(i + 1) : linhas.slice(i + 1, i + 3);
  for (const linha of seguintes) {
    if (ehTitulo(linha) || ehRotulo(linha)) break;
    if (trecho.length + linha.length + 1 > limite) break;
    trecho = `${trecho}\n${linha}`;
  }
  return trecho.trim() || null;
}

export interface VeredictoDaGuarda {
  /** A resposta pode ir ao usuário? */
  aprovada: boolean;
  /** Afirmações de ausência encontradas na resposta. */
  afirmacoesDeAusencia: string[];
  /** Tópicos da pergunta que TÊM evidência entregue. */
  cobertos: CoberturaDeTopico[];
  /** Tópicos sem evidência — aqui declarar ausência é correto. */
  descobertos: string[];
}

/**
 * O VEREDICTO. Reprova só na conjunção: a resposta afirma ausência E existe
 * evidência entregue sobre o tópico perguntado.
 *
 * Não reprova resposta que afirma ausência sem evidência — essa é honesta, e é
 * o comportamento que o produto quer preservar. Não reprova resposta sem
 * afirmação de ausência, por pior que seja: julgar qualidade não é trabalho
 * deste guarda.
 */
export function avaliarAusencia(params: {
  pergunta: string;
  resposta: string;
  evidencias: readonly RegistroDeEvidencia[];
}): VeredictoDaGuarda {
  const afirmacoes = trechosDeAusencia(params.resposta);
  const topicos = topicosDaPergunta(params.pergunta);

  const coberturas = topicos.map((t) => coberturaDoTopico(t, params.evidencias));
  const cobertos = coberturas.filter((c) => c.coberto);
  const descobertos = coberturas.filter((c) => !c.coberto).map((c) => c.topico);

  return {
    aprovada: !(afirmacoes.length > 0 && cobertos.length > 0),
    afirmacoesDeAusencia: afirmacoes,
    cobertos,
    descobertos,
  };
}

/**
 * RESPOSTA DE ÚLTIMO RECURSO, determinística.
 *
 * Usada quando a regeração também afirma ausência. É deliberadamente simples:
 * cita o que foi encontrado e diz de onde veio. O produto prefere uma resposta
 * menos elegante e correta a uma resposta bem escrita que nega o que ele sabe.
 */
export function respostaDeUltimoRecurso(cobertos: readonly CoberturaDeTopico[]): string {
  const linhas = ['Encontrei isto registrado no sistema:'];
  for (const c of cobertos) {
    if (!c.trecho) continue;
    // Dois tópicos que caem no mesmo trecho aparecem uma vez só.
    if (linhas.some((l) => l === c.trecho)) continue;
    linhas.push('', c.trecho);
  }
  linhas.push(
    '',
    'Este trecho veio direto do registro, sem reescrita. Se precisar de um resumo ou de outro recorte, é só pedir.',
  );
  return linhas.join('\n');
}

/**
 * SEGUNDA TENTATIVA, ANTES DO ÚLTIMO RECURSO (09/11/2026).
 *
 * A resposta reprovada caía direto na colagem literal de trechos. Com o Endrigo e o Pedro isso virou "Encontrei isto
 * registrado no sistema" seguido de pedaços que não respondiam nada. O caso medido: o GPT tinha os dados canônicos da
 * DCS ("Dr. Fernando ..., CRM-SP 115229") e o brain antigo dizia "[CONFIRMAR: nome e CRM]"; ele ficou com a pendência.
 *
 * Aqui o modelo recebe de novo a pergunta e SÓ o registro citável que foi entregue (ficha do cliente, vault, o que a
 * equipe ensinou), com a regra explícita: fato registrado vale sobre marcação de pendente. A resposta nova passa pela
 * mesma conferência; se negar de novo, aí sim vai o último recurso.
 */
export function promptDeRegeracao(pergunta: string, evidencias: readonly RegistroDeEvidencia[], teto = 24_000): string | null {
  const registro = evidencias
    .filter((ev) => ev.citavel && (ev.texto ?? '').trim())
    .map((ev) => (ev.texto ?? '').trim())
    .join('\n\n')
    .slice(0, teto);
  if (!registro) return null;
  return [
    'Você é o Bento, assistente de operação da Agência Desigual. Responda em português do Brasil, direto.',
    'Uma resposta anterior disse que a informação não existia, mas ela está no REGISTRO abaixo.',
    'Regras: responda à PERGUNTA usando o REGISTRO. Um fato registrado (nome, número, endereço, CRM) vale sobre qualquer',
    'marcação de pendente, [FALTA] ou [CONFIRMAR] em outra ficha. Se o registro responde só em parte, diga o que ele diz',
    'e o que falta. Não invente nada que não esteja no registro.',
    '',
    `PERGUNTA:\n${pergunta}`,
    '',
    `REGISTRO:\n${registro}`,
  ].join('\n');
}
