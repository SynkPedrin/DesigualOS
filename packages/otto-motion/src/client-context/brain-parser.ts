/**
 * Leitor dos BRAIN.md dos clientes (.claude/skills/otto/brains/<cliente>/),
 * que chegam aqui pelo texto de `memories` kind `client.profile`, subject
 * `cliente:<id>:brain` — importados por scripts/sync-brains.mts.
 *
 * Por que parsear em vez de jogar o markdown inteiro no prompt: o brain
 * inteiro vai TAMBÉM (campo `briefing`), cru, porque o Opus lê melhor do que
 * qualquer resumo. O que se extrai aqui é o punhado de campos que o CÓDIGO
 * precisa manipular — cor de fundo, fonte, CTA — e que não podem depender do
 * modelo ter lido direito.
 *
 * Regra que atravessa o arquivo: `[FALTA]` e `[CONFIRMAR]` NUNCA viram valor.
 * Um `[FALTA]` que escapasse como se fosse uma cor apareceria escrito na tela
 * de um motion publicitário.
 */

const PLACEHOLDER_HEAD = /^\[(FALTA|CONFIRMAR)/i;

/**
 * `[FALTA ...]` e `[CONFIRMAR: ...]` são ANOTAÇÃO EDITORIAL, não conteúdo — o
 * texto dentro delas nunca é dado do cliente, esteja onde estiver na linha.
 *
 * Isto existe porque a regra do topo ("placeholder nunca vira valor") só era
 * aplicada quando o marcador ABRIA o valor. Na D. Carvalho ele aparece no fim,
 * e o resultado foi concreto: `extractColors` devolvia CINCO hex como cores da
 * marca, todos lidos de dentro de um `[CONFIRMAR]` que pergunta justamente
 * qual dos três pares é o oficial — três são errados por construção, e o
 * próprio brain manda "não fixar o hex em peça que dependa da cor exata".
 * Um desses amarelos pintaria uma peça publicitária (07/10/2026).
 */
const ANOTACAO = /`?\[(?:FALTA|CONFIRMAR)[^\]]*\]`?/gi;

function semAnotacoes(text: string): string {
  return text.replace(ANOTACAO, ' ');
}

/** Há pergunta aberta aqui? Então o que este bloco afirma ainda não foi confirmado. */
function temPerguntaAberta(text: string): boolean {
  return /\[CONFIRMAR/i.test(text);
}

/**
 * O bloco de um item `- **Rótulo:**` — a própria linha mais os sub-bullets
 * indentados dela, até o próximo item de primeiro nível.
 *
 * Serve pra dar ESCOPO ao que se extrai: sem isso, `extractColors` varria a
 * seção inteira e misturava a cor confirmada de um rótulo com as candidatas
 * em aberto de outro.
 */
function blocoRotulado(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linhas = body.split('\n');
  const inicio = linhas.findIndex((l) => new RegExp(`^[-*]\\s*\\*\\*${escaped}`, 'i').test(l));
  if (inicio === -1) return null;
  const bloco = [linhas[inicio] ?? ''];
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^[-*]\s*\*\*/.test(linha)) break; // próximo rótulo de primeiro nível
    bloco.push(linha);
  }
  return bloco.join('\n');
}

/**
 * Uma linha é lacuna quando COMEÇA pelo marcador — que é como os brains
 * escrevem: "`[FALTA]` — topo, meio e fundo" é a resposta "não existe", com a
 * explicação do que falta logo depois.
 *
 * Contar caracteres em vez de olhar a posição daria o resultado errado
 * justamente nesse caso (a explicação é longa), e o erro sairia caro: um
 * `[FALTA]` tratado como dado vira texto na tela de um motion publicitário.
 */
export function isPlaceholder(value: string | null | undefined): boolean {
  if (!value) return true;
  const stripped = value
    .trim()
    .replace(/^(?:[-*]|\d+\.)\s*/, '')
    .replace(/^\[[ x]\]\s*/i, '')
    .replace(/^[`*\s]+/, '')
    .trim();
  return stripped === '' || PLACEHOLDER_HEAD.test(stripped);
}

/**
 * Corpo de uma seção `## N. TÍTULO`, sem o cabeçalho.
 *
 * Feito por fatiamento em vez de uma regex só com lookahead: a última seção
 * do brain (§13 LACUNAS) não tem `##` depois dela, e uma regex que dependa do
 * próximo cabeçalho devolve vazio exatamente na seção que declara o que
 * falta — o campo mais importante pra não inventar nada.
 */
export function section(brain: string, title: string): string | null {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^##\\s*\\d*\\.?\\s*${escaped}\\s*$`, 'im');
  const match = header.exec(brain);
  if (!match) return null;
  const rest = brain.slice(match.index + match[0].length);
  const next = /^##\s/m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  return body === '' ? null : body;
}

/**
 * Seção cujo veredito é "não existe": a primeira linha com conteúdo é o
 * marcador. Uma linha solta de informação adjacente não transforma a lacuna
 * em dado — na Envu, §7 abre com `[FALTA]` e logo abaixo lista canais de
 * conversão, que não são CTAs aprovados.
 */
export function sectionIsGap(body: string | null): boolean {
  if (!body) return true;
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue;
    return isPlaceholder(line);
  }
  return true;
}

/** Valor de um item `- **Rótulo:** valor` dentro de um corpo de seção. */
export function labeledValue(body: string | null, label: string): string | null {
  if (!body) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^[-*]\\s*\\*\\*${escaped}[^:*]*:?\\*\\*:?\\s*(.+)$`, 'im');
  const raw = pattern.exec(body)?.[1]?.trim();
  // isPlaceholder ANTES de limpar: um valor que ABRE com o marcador é lacuna, e
  // essa leitura depende do texto como está escrito.
  if (!raw || isPlaceholder(raw)) return null;
  // A anotação sai do valor, mas não anula o valor: "R$ 192.280,00 para
  // agosto–dezembro [CONFIRMAR: vigente?]" continua sendo a informação
  // R$ 192.280,00 — a ressalva é metadado, e carregá-la junto fazia o texto da
  // pergunta vazar pra dentro do dado.
  const limpo = cleanInline(semAnotacoes(raw));
  return limpo === '' ? null : limpo;
}

function cleanInline(value: string): string {
  return value
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Hex de 3 ou 6 dígitos, normalizado em maiúsculas e sem repetição — e SÓ o
 * que está confirmado.
 *
 * Duas travas, nesta ordem:
 *
 * 1. Escopo: quando a seção tem um rótulo de cor, lê só o bloco dele. Varrer a
 *    seção inteira misturava hex de rótulos diferentes.
 * 2. Pergunta aberta: se esse bloco contém `[CONFIRMAR`, NENHUMA cor sai. Um
 *    bloco que pergunta "qual dos três pares é o oficial?" não tem cor
 *    confirmada, e escolher uma é deduzir — o que a regra 3 do projeto proíbe.
 *    Devolver vazio faz a peça cair no neutro em vez de sair com um amarelo
 *    que o cliente talvez nunca tenha aprovado.
 */
export function extractColors(body: string | null): string[] {
  if (!body) return [];
  const bloco =
    blocoRotulado(body, 'Cores') ?? blocoRotulado(body, 'Paleta') ?? blocoRotulado(body, 'Cor') ?? body;
  if (temPerguntaAberta(bloco)) return [];
  const found = semAnotacoes(bloco).match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) ?? [];
  return [...new Set(found.map((color) => color.toUpperCase()))];
}

/**
 * Um nome de fonte é curto. Prosa que sobrou da frase não é.
 *
 * Sem isto, um prefixo em prosa antes do valor ("já registrado neste brain:
 * Big Shoulders Display") virava o nome da fonte, e a peça seria renderizada
 * pedindo uma família tipográfica que não existe.
 */
function pareceNomeDeFonte(parte: string): boolean {
  if (parte.length < 2 || parte.length > 48) return false;
  if (parte.split(/\s+/).length > 5) return false;
  return !/^(já|ja|o|a|os|as|que|com|sem|para|pra|usar|usa|até|ate|não|nao|ver|veja|fonte|fontes)\b/i.test(parte);
}

/**
 * Tipografias declaradas. O brain escreve como prosa
 * ("Big Shoulders Display (display) e Work Sans (texto)"), então a quebra é
 * por " e " / vírgula, com o parêntese explicativo removido.
 */
export function extractFonts(body: string | null): string[] {
  const line = labeledValue(body, 'Tipografias') ?? labeledValue(body, 'Tipografia') ?? labeledValue(body, 'Fontes');
  if (!line) return [];
  // Só a PRIMEIRA frase: o que vem depois do ponto é comentário sobre a fonte
  // (procedência, divergência em aberto), não mais nomes de fonte.
  const primeiraFrase = semAnotacoes(line).split(/\.\s+(?=[A-ZÀ-Ü])/)[0] ?? '';
  // Prefixo em prosa antes de dois-pontos ("já registrado neste brain: X") não
  // é dado — o dado é o que vem depois.
  const semPrefixo = primeiraFrase.includes(':')
    ? (primeiraFrase.slice(primeiraFrase.lastIndexOf(':') + 1) ?? primeiraFrase)
    : primeiraFrase;
  return semPrefixo
    .split(/\s+e\s+|\s+ou\s+|,|;|\//)
    .map((part) =>
      part
        .replace(/\([^)]*\)/g, '')
        .replace(/[.;:]+$/, '')
        .trim(),
    )
    .filter((part) => !isPlaceholder(part) && pareceNomeDeFonte(part));
}

/** Itens de lista de uma seção, sem sub-bullets vazios nem placeholders. */
export function extractBullets(body: string | null, limit = 12): string[] {
  if (!body || sectionIsGap(body)) return [];
  const bullets: string[] = [];
  for (const line of body.split('\n')) {
    const match = /^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s*)?(.+)$/.exec(line);
    const value = match?.[1]?.trim();
    if (!value || isPlaceholder(value)) continue;
    const cleaned = cleanInline(value);
    if (cleaned.length < 3) continue;
    bullets.push(cleaned);
    if (bullets.length >= limit) break;
  }
  return bullets;
}

/** Primeiro parágrafo útil de uma seção, para campos que são texto corrido. */
export function firstParagraph(body: string | null): string | null {
  if (!body) return null;
  for (const block of body.split(/\n{2,}/)) {
    if (isPlaceholder(block.trim())) continue;
    const cleaned = cleanInline(semAnotacoes(block.replace(/^[-*]\s+/gm, '')));
    if (cleaned.length > 20 && !cleaned.startsWith('|')) return cleaned.slice(0, 600);
  }
  return null;
}

export interface ParsedBrain {
  positioning: string | null;
  audience: string | null;
  toneOfVoice: string | null;
  colors: string[];
  fonts: string[];
  approvedCtas: string[];
  restrictions: string[];
  products: string[];
  gaps: string[];
}

export function parseBrain(brain: string): ParsedBrain {
  const posicionamento = section(brain, 'POSICIONAMENTO');
  const publico = section(brain, 'PÚBLICO') ?? section(brain, 'PUBLICO');
  const voz = section(brain, 'VOZ VERBAL');
  const ctas = section(brain, 'CTAs APROVADOS') ?? section(brain, 'CTAS APROVADOS');
  const restricoes = section(brain, 'RESTRIÇÕES') ?? section(brain, 'RESTRICOES');
  const visual = section(brain, 'IDENTIDADE VISUAL');
  const oferta = section(brain, 'OFERTA');
  const lacunas = section(brain, 'LACUNAS');

  return {
    positioning: labeledValue(posicionamento, 'O que vende') ?? firstParagraph(posicionamento),
    audience: firstParagraph(publico),
    toneOfVoice: firstParagraph(voz),
    colors: extractColors(visual),
    fonts: extractFonts(visual),
    approvedCtas: extractBullets(ctas, 8),
    restrictions: extractBullets(restricoes, 10),
    products: extractBullets(oferta, 8),
    gaps: extractBullets(lacunas, 8),
  };
}
