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
  for (const ev of evidencias) {
    const corpo = normalizar(ev.texto ?? '');
    const i = corpo.indexOf(topico);
    if (i < 0) continue;

    const bruto = ev.texto ?? '';
    const inicio = Math.max(0, i - JANELA_DO_TRECHO / 4);
    return {
      topico,
      coberto: true,
      fonte: ev.sourceType || ev.fonte,
      trecho: bruto.slice(inicio, inicio + JANELA_DO_TRECHO).trim(),
    };
  }
  return { topico, coberto: false, fonte: null, trecho: null };
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
    linhas.push('', `**${c.topico}** — ${c.fonte ?? 'registro do cliente'}:`, c.trecho);
  }
  linhas.push(
    '',
    'Este trecho veio direto do registro, sem reescrita. Se precisar de um resumo ou de outro recorte, é só pedir.',
  );
  return linhas.join('\n');
}
