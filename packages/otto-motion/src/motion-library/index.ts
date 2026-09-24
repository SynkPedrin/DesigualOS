/**
 * §21 — BIBLIOTECA DE COMPONENTES.
 *
 * Ferramenta, não prisão criativa. O agente escreve código livre; quando um
 * componente sai realmente bom, ele é PROMOVIDO pra cá e passa a ser oferecido
 * — nunca imposto. O prompt do sistema não manda usar a biblioteca, e isso é
 * deliberado: forçar reuso mataria justamente a variedade que faz uma peça não
 * parecer template.
 *
 * Como promover um componente:
 *   1. copie o arquivo do workspace do job pra pasta da categoria;
 *   2. tire tudo que era específico daquele cliente (cor, texto, asset) e
 *      transforme em prop;
 *   3. exporte daqui;
 *   4. cite o componente no prompt de criação, como opção.
 *
 * Categorias (as pastas existem vazias de propósito, pra o primeiro que
 * promover não ter que decidir a taxonomia sozinho):
 *
 *   typography/   kinetic headline, split reveal, contador de texto
 *   transitions/  wipes, máscaras, cortes com intenção
 *   cards/        glass reveal, card de produto, card de preço
 *   counters/     número que sobe, preço, porcentagem
 *   logos/        entrada de logo, assinatura, lockup
 *   effects/      grão, blur progressivo, luz, ruído
 *   layouts/      grades, safe areas por formato, composição em terços
 *   cameras/      push-in, parallax, camera shake contido
 *
 * Vazio hoje. É o estado honesto: a primeira peça real acabou de sair, e
 * promover componente antes de ter repertório produziria abstração inventada
 * em vez de destilada.
 */

/** Safe areas por formato (§20). O único item que já nasce com uso certo:
 * é medida de plataforma, não escolha de estilo, e errar aqui corta o CTA
 * atrás da UI do Instagram. */
export const SAFE_AREAS = {
  '9:16': { top: 0.12, bottom: 0.14, sides: 0.08 },
  '4:5': { top: 0.08, bottom: 0.08, sides: 0.08 },
  '1:1': { top: 0.08, bottom: 0.08, sides: 0.08 },
  '16:9': { top: 0.08, bottom: 0.08, sides: 0.08 },
} as const;

export type SafeAreaFormat = keyof typeof SAFE_AREAS;

/** Margem em pixels para um formato e uma dimensão dados. */
export function safeInsets(format: SafeAreaFormat, width: number, height: number): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const area = SAFE_AREAS[format];
  return {
    top: Math.round(height * area.top),
    bottom: Math.round(height * area.bottom),
    left: Math.round(width * area.sides),
    right: Math.round(width * area.sides),
  };
}
