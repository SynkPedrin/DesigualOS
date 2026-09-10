/**
 * ECharts (canvas/SVG) e Lightweight Charts (sempre canvas) não entendem
 * `var(--x)` como cor - só o CSS de verdade resolve isso no momento do
 * paint. Os dois precisam do valor concreto (ex: "#9333ea") já resolvido
 * antes de montar as opções do gráfico, então lemos direto do
 * :root/[data-theme] (ver tokens.css) via getComputedStyle.
 *
 * Chamar de novo quando o tema mudar (useTheme().resolvedTheme como dep de
 * efeito/memo) é o que faz o gráfico re-pintar com as cores certas depois
 * de um toggle claro/escuro.
 */
export function resolveColorVar(varName: string, fallback = '#9333ea'): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

/** Sufixo de alpha em hex (2 dígitos, "00"-"ff") numa cor "#rrggbb" resolvida
 * acima. Não tenta lidar com rgb()/hsl() - os tokens do app são todos hex. */
export function withAlpha(hex: string, alphaHex: string): string {
  return hex.startsWith('#') && hex.length === 7 ? `${hex}${alphaHex}` : hex;
}
