import type { MotionAsset } from './types.js';

/**
 * RELEVÂNCIA DE ASSET (§8).
 *
 * Achado real (24/09/2026, acervo de produção): o cliente "John Deere" tem 25
 * imagens, das quais 13 são trator/colheitadeira/concessionária e 10 são
 * retratos executivos e famílias — gerações de teste de outro briefing
 * gravadas sob esse cliente. A seleção por RECÊNCIA pegava as 8 mais novas e
 * trazia 6 erradas. Quem barrou foi o julgamento do modelo ao abrir as
 * imagens, não o sistema.
 *
 * Ordenar por relevância ao invés de por data resolve isso antes de gastar
 * contexto: "A real John Deere tractor driving down a dusty rural road" casa
 * com o cliente; "An ultra high end professional executive portrait" não casa
 * com nada do briefing.
 */

/** Palavras que aparecem em tudo e não distinguem nada. */
const STOPWORDS = new Set([
  'a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas','um','uma','para','por','com','sem','the','of','and','in','on','at','to','for','with','real','photograph','photo','image','imagem','foto','crie','cria','criar','uma','que','ao','lado','usando','high','end','ultra','professional','premium','campanha','campaign',
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

export interface RelevanceTerms {
  /** Nome e marca do cliente. Peso alto: é o que identifica o dono do material. */
  brand: string[];
  /** Termos do briefing da campanha e do pedido. */
  campaign: string[];
}

export function buildRelevanceTerms(input: {
  clientName: string;
  products?: readonly string[];
  briefText?: string | null;
  userMessage?: string | null;
}): RelevanceTerms {
  const brand = new Set(tokenize(input.clientName));
  for (const product of input.products ?? []) for (const token of tokenize(product)) brand.add(token);
  const campaign = new Set<string>();
  for (const text of [input.briefText, input.userMessage]) {
    if (!text) continue;
    for (const token of tokenize(text)) campaign.add(token);
  }
  return { brand: [...brand], campaign: [...campaign] };
}

/** Texto pesquisável do asset: o prompt que o gerou diz mais que o nome do arquivo. */
export function assetText(asset: MotionAsset): string {
  return `${asset.prompt ?? ''} ${asset.filename}`;
}

/**
 * Casar marca vale 3, casar briefing vale 1.
 *
 * A assimetria é o ponto: uma foto do cliente errado pode citar a campanha
 * ("trator", "família") e ainda assim não ser do cliente. Marca é quem manda.
 */
export function scoreAsset(asset: MotionAsset, terms: RelevanceTerms): number {
  const tokens = new Set(tokenize(assetText(asset)));
  let score = 0;
  for (const term of terms.brand) if (tokens.has(term)) score += 3;
  for (const term of terms.campaign) if (tokens.has(term)) score += 1;
  return score;
}

export interface RankedAsset {
  asset: MotionAsset;
  score: number;
}

/**
 * Ordena por relevância e diz onde cortar.
 *
 * `cutoff` só existe quando HÁ material relevante: num cliente cujo acervo
 * inteiro pontua zero (marca sem nome distintivo, prompts em branco), cortar
 * por score deixaria a peça sem foto nenhuma. Nesse caso a ordem volta a ser
 * a de antes e o corte é só o orçamento.
 */
export function rankAssets(assets: readonly MotionAsset[], terms: RelevanceTerms): { ranked: RankedAsset[]; hasSignal: boolean } {
  const ranked = assets
    .map((asset) => ({ asset, score: scoreAsset(asset, terms) }))
    .sort((a, b) => b.score - a.score);
  const hasSignal = ranked.some((item) => item.score > 0);
  return { ranked, hasSignal };
}
