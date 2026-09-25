/**
 * §10 — o que o Motion Engine precisa saber sobre a marca antes de desenhar
 * qualquer coisa.
 *
 * Todo campo textual é `string | null`, e null significa EXATAMENTE "não
 * existe na fonte". Isto não é detalhe de tipagem: o CLAUDE.md do projeto
 * proíbe inventar dado de cliente, e os BRAIN.md marcam lacuna com `[FALTA]`
 * de propósito. Um resolver que preenchesse "tom de voz: moderno e
 * descontraído" por dedução destruiria justamente a disciplina que esses
 * arquivos existem pra manter.
 */
export interface BrandIdentity {
  name: string;
  slug: string;
  /** O que vende, em uma frase. */
  positioning: string | null;
  audience: string | null;
  toneOfVoice: string | null;
  /** Hex. Vazio = a marca não tem paleta registrada, e o motion precisa lidar com isso. */
  colors: string[];
  fonts: string[];
  /** CTAs aprovados. Usar um fora da lista é inventar promessa. */
  approvedCtas: string[];
  /** §10 "restrições" — o que a marca não pode dizer/mostrar. */
  restrictions: string[];
  products: string[];
  /** Lacunas declaradas no brain, repassadas cruas pro prompt. */
  gaps: string[];
}

export type MotionAssetKind = 'logo' | 'image' | 'video' | 'font' | 'reference' | 'document';

export interface MotionAsset {
  kind: MotionAssetKind;
  /** URL de origem (Supabase Storage). É a FONTE — nunca escrita. */
  sourceUrl: string;
  filename: string;
  contentType: string;
  /** De onde veio: client_brand_kits, studio_assets, project_files, anexo do turno. */
  origin: string;
  /**
   * O prompt que gerou o asset, quando existe. É o melhor descritor que o
   * acervo tem: diz o que a imagem MOSTRA, enquanto o nome do arquivo
   * ("STU-MTUZW37633E81A-2.png") não diz nada. A seleção por relevância (§8)
   * depende dele.
   */
  prompt?: string | null | undefined;
  width?: number | undefined;
  height?: number | undefined;
  sizeBytes?: number | undefined;
  /** Preenchido depois da cópia pro workspace (§11). */
  localPath?: string | undefined;
  /** Caminho relativo ao projeto, que é o que o código do motion referencia. */
  projectPath?: string | undefined;
}

export interface ClientMotionContext {
  /** `null` no modo AD_HOC (adendo chat-first): motion sem cliente selecionado, só com anexos do turno. */
  clientId: string | null;
  brand: BrandIdentity;
  assets: MotionAsset[];
  /** Texto do brain/dossiê, cru. O Opus lê melhor do que qualquer resumo meu. */
  briefing: string | null;
  /** Fontes consultadas, pro log e pra explicar no chat de onde veio o material. */
  sources: string[];
  /** O que faltou. Vira `[CONFIRMAR]`/`[FALTA]` no prompt, nunca dedução. */
  missing: string[];
}
