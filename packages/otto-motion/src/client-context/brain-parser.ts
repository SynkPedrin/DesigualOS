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
  if (!raw || isPlaceholder(raw)) return null;
  return cleanInline(raw);
}

function cleanInline(value: string): string {
  return value
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hex de 3 ou 6 dígitos, normalizado em maiúsculas e sem repetição. */
export function extractColors(body: string | null): string[] {
  if (!body) return [];
  const found = body.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) ?? [];
  return [...new Set(found.map((color) => color.toUpperCase()))];
}

/**
 * Tipografias declaradas. O brain escreve como prosa
 * ("Big Shoulders Display (display) e Work Sans (texto)"), então a quebra é
 * por " e " / vírgula, com o parêntese explicativo removido.
 */
export function extractFonts(body: string | null): string[] {
  const line = labeledValue(body, 'Tipografias') ?? labeledValue(body, 'Tipografia') ?? labeledValue(body, 'Fontes');
  if (!line) return [];
  return line
    .split(/\s+e\s+|,|;|\//)
    .map((part) => part.replace(/\([^)]*\)/g, '').trim())
    .filter((part) => part.length > 1 && !isPlaceholder(part));
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
    const cleaned = cleanInline(block.replace(/^[-*]\s+/gm, ''));
    if (cleaned.length > 20 && !isPlaceholder(cleaned) && !cleaned.startsWith('|')) return cleaned.slice(0, 600);
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
