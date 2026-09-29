import type { CampaignBrief } from './schema.js';

/**
 * LOCKED FACTS (§5).
 *
 * O problema real: um modelo de linguagem trata "R$ 375" como texto, e texto
 * ele reescreve — vira "R$ 379", "R$ 350", "R$ 3.750". Num anúncio, isso não é
 * variação de redação: é preço errado publicado no perfil de um cliente.
 *
 * A defesa tem três camadas, porque nenhuma sozinha basta:
 *   1. o valor vai pro prompt num bloco separado, marcado como imutável;
 *   2. o revisor visual recebe a lista e confere quadro a quadro;
 *   3. o CÓDIGO GERADO é varrido aqui, programaticamente, atrás de qualquer
 *      valor comercial que não tenha vindo do briefing.
 *
 * A camada 3 é a que não depende de o modelo cooperar, e é a única que pega o
 * caso em que ele "arredondou pra ficar melhor".
 */

export type LockedFactKind = 'money' | 'percent' | 'text' | 'date' | 'phone' | 'url';

export interface LockedFact {
  /** Rótulo humano: "Preço", "CTA", "Parcelas". */
  label: string;
  /** Como a pessoa escreveu. É isto que precisa aparecer na tela. */
  value: string;
  kind: LockedFactKind;
  /** Valor comparável (centavos, número, texto dobrado). */
  normalized: string;
}

/**
 * Dinheiro SEMPRE com o marcador `R$`.
 *
 * Um número sozinho ("375") é ambíguo demais no meio de código: pode ser
 * frame, pixel ou duração. O `R$` é o que separa preço de coordenada, e num
 * anúncio brasileiro o preço vem com ele.
 */
const MONEY_TOKEN = /R\$\s*\d[\d.,]*/g;
const PERCENT_TOKEN = /\b\d{1,3}(?:[.,]\d+)?\s*%/g;

/** "R$ 1.250,90" e "1250.90" e "375" caem todos no mesmo número comparável. */
export function normalizeMoney(raw: string): string | null {
  const digits = raw.replace(/[^\d.,]/g, '').trim();
  if (digits === '') return null;

  let value: number;
  if (/,\d{1,2}$/.test(digits)) {
    // Padrão brasileiro: ponto é milhar, vírgula é decimal.
    value = Number.parseFloat(digits.replace(/\./g, '').replace(',', '.'));
  } else if (/\.\d{1,2}$/.test(digits) && !/\.\d{3}(?:\D|$)/.test(digits)) {
    value = Number.parseFloat(digits.replace(/,/g, ''));
  } else {
    value = Number.parseFloat(digits.replace(/[.,]/g, ''));
  }

  if (!Number.isFinite(value)) return null;
  // Em centavos: 375 e 375,00 viram o mesmo, 375 e 3750 não.
  return String(Math.round(value * 100));
}

export function normalizePercent(raw: string): string | null {
  const value = Number.parseFloat(raw.replace(/[^\d.,]/g, '').replace(',', '.'));
  return Number.isFinite(value) ? String(Math.round(value * 100)) : null;
}

function foldText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(label: string, value: string | undefined): LockedFact | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = normalizeMoney(raw);
  if (!normalized) return null;
  return { label, value: raw, kind: 'money', normalized };
}

/**
 * Extrai os fatos do briefing. Só entra aqui o que a PESSOA escreveu — nada
 * derivado, nada calculado. Calcular "12x de R$ 29,70" a partir de R$ 356,40
 * seria inventar um fato comercial com cara de dado.
 */
export function extractLockedFacts(brief: CampaignBrief | null | undefined): LockedFact[] {
  if (!brief) return [];
  const facts: LockedFact[] = [];
  const offer = brief.offer;

  const candidates = [
    money('Preço', offer?.price),
    money('Preço original', offer?.originalPrice),
    money('Valor da parcela', offer?.installmentValue),
  ];
  for (const fact of candidates) if (fact) facts.push(fact);

  if (offer?.discount?.trim()) {
    const raw = offer.discount.trim();
    const isPercent = raw.includes('%');
    const normalized = isPercent ? normalizePercent(raw) : normalizeMoney(raw);
    if (normalized) facts.push({ label: 'Desconto', value: raw, kind: isPercent ? 'percent' : 'money', normalized });
  }

  for (const [label, value] of [
    ['Parcelamento', offer?.installments],
    ['Nome da oferta', offer?.name],
    ['Condição', offer?.condition],
    ['CTA', brief.cta],
    ['Campanha', brief.campaignName],
  ] as const) {
    const raw = value?.trim();
    if (raw) facts.push({ label, value: raw, kind: 'text', normalized: foldText(raw) });
  }

  return facts;
}

/** O bloco que vai pro prompt do worker (§6). */
export function renderLockedFactsBlock(facts: readonly LockedFact[]): string {
  if (facts.length === 0) {
    return [
      '# LOCKED FACTS',
      '',
      'Nenhum valor comercial foi informado para esta peça.',
      '',
      '**Não invente nenhum.** Sem preço, sem parcela, sem porcentagem, sem data, sem telefone.',
      'A peça se resolve sem número: é legítima assim.',
    ].join('\n');
  }
  return [
    '# LOCKED FACTS',
    '',
    'Estes valores são FATO. Eles aparecem na tela exatamente como estão escritos aqui.',
    '',
    ...facts.map((fact) => `- **${fact.label}:** \`${fact.value}\``),
    '',
    'Regras que não se negociam:',
    '- Não arredonde, não "melhore", não reformate, não traduza, não abrevie.',
    '- `R$ 375` não vira `R$ 379`, nem `R$ 350`, nem `R$ 3.750`, nem `375 reais`.',
    '- Não crie valor que não esteja nesta lista: nenhum outro preço, parcela, porcentagem, data, telefone ou URL.',
    '- Se um valor não couber na composição, mude a composição — nunca o valor.',
    '- Você pode escolher NÃO mostrar um destes fatos. O que não pode é mostrá-lo diferente.',
  ].join('\n');
}

export interface LockedFactViolation {
  kind: 'valor_inventado' | 'valor_alterado' | 'cta_ausente';
  detail: string;
}

/**
 * Marcas de que um pedaço de texto é CSS, não copy.
 *
 * Sem este filtro, `hsl(220, 10%, 50%)` viraria "duas porcentagens
 * inventadas" e `rgba(0,0,0,0.5)` viraria preço. QA que acusa defeito onde não
 * há é QA que se aprende a ignorar — e aí ele não serve pra nada quando o
 * defeito é real.
 */
const CSS_MARKERS =
  /\b(?:px|rem|em|vh|vw|deg|ms|fr|calc|rgba?|hsla?|linear-gradient|radial-gradient|url|blur|translate|scale|rotate|cubic-bezier|inset|solid|dashed|transparent|currentColor)\b|#[0-9a-f]{3,8}\b/i;

/**
 * O texto que de fato chega à tela.
 *
 * Duas fontes, porque copy de motion vive nas duas: o texto solto dentro do
 * JSX (`<div>Saiba mais</div>`) e as constantes de string usadas como copy.
 * Número em propriedade de estilo (`fontSize: 3750`) fica de fora dos dois, e
 * é assim que se evita confundir tamanho de fonte com preço.
 */
export function extractScreenText(sources: readonly { path: string; content: string }[]): string {
  const pieces: string[] = [];
  for (const source of sources) {
    // 1. texto entre tags JSX.
    //
    // As expressões `{...}` saem do meio, mas o que está EM VOLTA delas fica:
    // copy de motion quase sempre mistura os dois
    // (`<div>{PRECO} · 12x de {PARCELA} · Agende agora</div>`), e descartar a
    // linha inteira por causa de uma chave perderia justamente o CTA.
    for (const match of source.content.matchAll(/>([^<>]{2,400})</g)) {
      const value = match[1]?.replace(/\{[^}]*\}/g, ' ').trim();
      if (value && /[\p{L}\d]/u.test(value)) pieces.push(value);
    }
    // 2. literais de string que não são CSS
    for (const match of source.content.matchAll(/'([^'\\\n]{1,200})'|"([^"\\\n]{1,200})"|`([^`\\]{1,400})`/g)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (!value || CSS_MARKERS.test(value)) continue;
      pieces.push(value);
    }
  }
  return pieces.join('\n');
}

/**
 * Varre o que vai pra tela atrás de violação (§16).
 *
 * Dinheiro só conta com o marcador `R$`: é como preço aparece num anúncio
 * brasileiro, e nenhum valor de CSS o contém. Porcentagem só é acusada quando
 * o briefing travou uma — sem fato travado, quem pega desconto inventado é a
 * revisão visual, que lê o quadro em vez de adivinhar pelo código.
 */
export function findLockedFactViolations(
  sources: readonly { path: string; content: string }[],
  facts: readonly LockedFact[],
): LockedFactViolation[] {
  const allowedMoney = new Set(facts.filter((f) => f.kind === 'money').map((f) => f.normalized));
  const allowedPercent = new Set(facts.filter((f) => f.kind === 'percent').map((f) => f.normalized));
  const violations: LockedFactViolation[] = [];
  const seen = new Set<string>();

  const text = extractScreenText(sources);
  const travados = facts
    .filter((f) => f.kind === 'money')
    .map((f) => `${f.label} = ${f.value}`)
    .join(', ');

  for (const token of text.match(MONEY_TOKEN) ?? []) {
    const normalized = normalizeMoney(token);
    if (!normalized || allowedMoney.has(normalized)) continue;
    const key = `money:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      kind: allowedMoney.size === 0 ? 'valor_inventado' : 'valor_alterado',
      detail:
        allowedMoney.size === 0
          ? `a peça mostra o valor "${token}", que não veio do briefing`
          : `a peça mostra "${token}"; o briefing travou ${travados}`,
    });
  }

  if (allowedPercent.size > 0) {
    for (const token of text.match(PERCENT_TOKEN) ?? []) {
      const normalized = normalizePercent(token);
      if (!normalized || allowedPercent.has(normalized)) continue;
      const key = `percent:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ kind: 'valor_alterado', detail: `a peça mostra a porcentagem "${token}", que não é a travada` });
    }
  }

  const cta = facts.find((fact) => fact.label === 'CTA');
  if (cta && !foldText(text).includes(cta.normalized)) {
    violations.push({ kind: 'cta_ausente', detail: `o CTA travado "${cta.value}" não aparece na peça` });
  }

  return violations;
}
